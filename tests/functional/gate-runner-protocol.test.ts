import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runGateRunner,
  type GateRunnerOptions,
} from "../../tooling/checks/runner.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "tuil-gate-protocol-"));
  roots.push(root);
  for (const directory of [
    "apps",
    "examples",
    "packages/demo/src",
    "registry",
    "tooling",
    "tests/helpers",
    "node_modules/.bin",
    "packages/demo/dist",
  ])
    await mkdir(join(root, directory), { recursive: true });
  await writeFile(
    join(root, "packages/demo/src/demo.test.ts"),
    'import { test } from "bun:test"; test("fixture", () => {});',
  );
  await writeFile(
    join(root, "packages/demo/src/value.ts"),
    "export const value = 1;",
  );
  await writeFile(join(root, "packages/demo/dist/ignored.ts"), "ignored");
  await writeFile(join(root, "packages/demo/src/ignored.md"), "ignored");
  await writeFile(join(root, "node_modules/.bin/oxlint"), "");
  const databasePath = join(root, "checks.sqlite");
  const events: unknown[] = [];
  let diagnoses = 0;
  let closes = 0;
  const options: GateRunnerOptions = {
    root,
    databasePath,
    once: true,
    emit: (event) => events.push(event),
    runCommand: async (argv) => {
      const reportDirectory = argv
        .find((arg) => arg.startsWith("--coverage-dir="))!
        .slice("--coverage-dir=".length);
      await mkdir(reportDirectory, { recursive: true });
      await writeFile(
        join(reportDirectory, "lcov.info"),
        "SF:fixture.ts\nend_of_record\n",
      );
      return { command: argv.join(" "), code: 0, output: "passed" };
    },
    createLintClient: () => ({
      diagnose: async () => {
        diagnoses++;
        return [];
      },
      close: async () => {
        closes++;
      },
    }),
  };
  function state() {
    const db = new Database(databasePath, { readonly: true });
    try {
      return {
        owner: db.query("SELECT * FROM owner").get(),
        cycle: db
          .query("SELECT * FROM cycles ORDER BY id DESC LIMIT 1")
          .get() as {
          state: string;
          inputs: string;
          tests: string;
          test_result: string;
          lint_result: string;
        } | null,
      };
    } finally {
      db.close();
    }
  }
  return {
    root,
    options,
    events,
    state,
    diagnoses: () => diagnoses,
    closes: () => closes,
  };
}
test("finite gate owns isolated SQLite, records exact scope and coverage evidence, and releases signals", async () => {
  const f = await fixture();
  const before = process.listenerCount("SIGTERM");
  await runGateRunner(["watch", join(f.root, "packages/demo")], f.options);
  const state = f.state();
  expect(state.owner).toBeNull();
  expect(state.cycle!.state).toBe("passed");
  expect(JSON.parse(state.cycle!.tests)).toEqual([
    "packages/demo/src/demo.test.ts",
  ]);
  expect(JSON.parse(state.cycle!.inputs)).not.toContain(
    "packages/demo/dist/ignored.ts",
  );
  expect(JSON.parse(state.cycle!.test_result).coverage).toMatchObject({
    sources: 1,
  });
  expect(f.diagnoses()).toBe(2);
  expect(f.closes()).toBe(1);
  expect(process.listenerCount("SIGTERM")).toBe(before);
  await runGateRunner(["status"], f.options);
  expect(f.events.at(-1)).toMatchObject({
    databasePath: f.options.databasePath,
    owner: null,
  });
});
test("refuses a second live owner without deleting its lease", async () => {
  const f = await fixture();
  await runGateRunner(["watch", "missing"], f.options);
  const db = new Database(f.options.databasePath!);
  db.query("INSERT INTO owner VALUES (1, ?, '[]')").run(process.pid);
  db.close();
  await expect(runGateRunner(["watch", "."], f.options)).rejects.toThrow(
    "live owner",
  );
  expect(f.state().owner).toMatchObject({ pid: process.pid });
});
test("reclaims dead owner and reports absent tests and lint scope", async () => {
  const f = await fixture();
  await runGateRunner(["watch", "missing"], f.options);
  const db = new Database(f.options.databasePath!);
  db.query("INSERT INTO owner VALUES (1, ?, '[]')").run(2147483647);
  db.close();
  await runGateRunner(["watch", "missing"], f.options);
  const state = f.state();
  expect(state.owner).toBeNull();
  expect(state.cycle!.state).toBe("failed");
  expect(JSON.parse(state.cycle!.test_result).output).toContain(
    "No unit tests",
  );
  expect(JSON.parse(state.cycle!.lint_result).code).toBe(-1);
});
test("records lint diagnostics and invalidates cycles whose inputs change", async () => {
  const f = await fixture();
  f.options.createLintClient = () => ({
    diagnose: async () => {
      await writeFile(
        join(f.root, "packages/demo/src/value.ts"),
        "export const value = 2;",
      );
      return [
        {
          severity: 1,
          message: "fixture error",
          range: { start: { line: 2, character: 3 } },
        },
      ];
    },
    close: async () => {},
  });
  await runGateRunner(["watch", "packages"], f.options);
  expect(f.state().cycle!.state).toBe("stale");
  expect(JSON.parse(f.state().cycle!.lint_result)).toMatchObject({ code: 1 });
  expect(JSON.parse(f.state().cycle!.lint_result).output).toContain(
    ":3:4: fixture error",
  );
});
test("records timing-policy and lint-transport failures without leaving ownership", async () => {
  const f = await fixture();
  await writeFile(
    join(f.root, "packages/demo/src/demo.test.ts"),
    "setTimeout(() => {}, 10);",
  );
  f.options.createLintClient = () => ({
    diagnose: async () => {
      throw new Error("disconnected");
    },
    close: async () => {},
  });
  await runGateRunner(["watch", "."], f.options);
  const state = f.state();
  expect(state.owner).toBeNull();
  expect(state.cycle!.state).toBe("failed");
  expect(JSON.parse(state.cycle!.test_result).output).toContain(
    "controlled clock",
  );
  expect(JSON.parse(state.cycle!.lint_result).output).toContain("disconnected");
});
test("rejects missing scopes, workspace escapes, and unknown commands", async () => {
  const f = await fixture();
  await expect(runGateRunner(["watch"], f.options)).rejects.toThrow(
    "owning paths",
  );
  await expect(runGateRunner(["watch", ".."], f.options)).rejects.toThrow(
    "leaves the workspace",
  );
  await expect(runGateRunner(["unknown"], f.options)).rejects.toThrow("Usage:");
});

test("reuses unchanged diagnostics and restarts persistent lint after configuration changes", async () => {
  const f = await fixture();
  f.options.once = false;
  f.options.cycleLimit = 3;
  let pauses = 0;
  f.options.pause = async () => {
    pauses++;
    if (pauses === 1) await writeFile(join(f.root, ".oxlintrc.json"), "{}");
    else
      await writeFile(
        join(f.root, "packages/demo/src/value.ts"),
        "export const value = 3;",
      );
  };
  await runGateRunner(["watch", "packages"], f.options);
  expect(pauses).toBe(2);
  expect(f.diagnoses()).toBe(5);
  expect(f.closes()).toBe(2);
  expect(f.state().cycle!.state).toBe("passed");
  expect(f.state().owner).toBeNull();
});
test("stops on an explicit signal and runs native bounded command capture", async () => {
  const f = await fixture();
  f.options.once = false;
  f.options.runCommand = undefined;
  f.options.pause = async () => {
    process.emit("SIGINT");
  };
  await runGateRunner(["watch", "."], f.options);
  expect(f.state().owner).toBeNull();
  expect(JSON.parse(f.state().cycle!.test_result).command).toContain(
    "--no-orphans",
  );
  expect(f.closes()).toBe(1);
});

test("uses the real persistent Oxlint process in an isolated workspace", async () => {
  const f = await fixture();
  await rm(join(f.root, "node_modules/.bin/oxlint"));
  await symlink(
    new URL("../../node_modules/.bin/oxlint", import.meta.url).pathname,
    join(f.root, "node_modules/.bin/oxlint"),
  );
  f.options.createLintClient = undefined;
  await runGateRunner(["watch", "packages"], f.options);
  expect(f.state().cycle!.state).toBe("passed");
  expect(JSON.parse(f.state().cycle!.lint_result).code).toBe(0);
  expect(f.state().owner).toBeNull();
});
test("reports Git path errors and emits default JSON status", async () => {
  const f = await fixture();
  await expect(runGateRunner(["status"], { root: f.root })).rejects.toThrow();
  await runGateRunner(["watch", "missing"], f.options);
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    await runGateRunner(["status"], {
      root: f.root,
      databasePath: f.options.databasePath,
    });
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      owner: null,
    });
  } finally {
    log.mockRestore();
  }
});
