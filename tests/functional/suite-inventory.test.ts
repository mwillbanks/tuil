import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyTest,
  discoverTestSuites,
  executeSuite,
  isExcludedTest,
  repositoryRoot,
} from "../../tooling/checks/suites.ts";

test("discovers exactly one owner for source, functional, and regression tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "tuil-suites-"));
  try {
    const unit = "packages/ui/src/widget.test.tsx";
    const functional = "tests/functional/widget.spec.ts";
    const regression = "tests/regression/compatibility.test.js";
    const ignored = "packages/ui/dist/widget.spec.ts";
    await Promise.all(
      [unit, functional, regression, ignored].map((path) =>
        Bun.write(join(root, path), ""),
      ),
    );
    expect(isExcludedTest(ignored)).toBe(true);
    expect(classifyTest(unit)).toBe("unit");
    expect(await discoverTestSuites(root)).toEqual({
      unit: [unit],
      functional: [functional],
      regression: [regression],
    });
    await Bun.write(join(root, "tests/unassigned.test.ts"), "");
    await expect(discoverTestSuites(root)).rejects.toThrow(
      "owning unit directory",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses incomplete qualification and scopes finite unit runs by owner", async () => {
  await expect(
    executeSuite("all", { paths: ["packages/core/src"] }),
  ).rejects.toThrow("requires instrumented coverage");
  await expect(
    executeSuite("unit", { paths: ["registry/does-not-exist"] }),
  ).rejects.toThrow("No tests discovered");
  await executeSuite("unit", {
    paths: [join(repositoryRoot, "tooling/coverage/instrument.test.ts")],
  });
});

test("CLI inventory reports populated suites and refuses unrecognized commands", async () => {
  const invoke = (command: string) =>
    Bun.spawnSync([process.execPath, "tooling/checks/suites.ts", command], {
      cwd: repositoryRoot,
    });
  const inventory = invoke("inventory");
  expect(inventory.exitCode).toBe(0);
  const tests = JSON.parse(new TextDecoder().decode(inventory.stdout));
  expect(tests.unit).toContain("tooling/coverage/instrument.test.ts");
  expect(tests.functional).toContain(
    "tests/functional/suite-inventory.test.ts",
  );
  expect(tests.regression).toContain(
    "tests/regression/layout-projection.test.ts",
  );
  const invalid = invoke("unrecognized");
  expect(invalid.exitCode).not.toBe(0);
  expect(new TextDecoder().decode(invalid.stderr)).toContain("Usage:");
});
