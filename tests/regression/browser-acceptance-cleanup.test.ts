import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "../..");

for (const failure of ["showcase", "launch", "context"] as const) {
  test(
    "browser acceptance " +
      failure +
      " failure survives cleanup errors and does not publish coverage",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "tuil-browser-cleanup-"));
      const report = join(root, "coverage.json");
      const script = `
import { mock } from "bun:test";
const failure = ${JSON.stringify(failure)};
const primary = new Error("Primary " + failure + " failure");
const cleanup = [];
let servers = 0;
Bun.serve = () => {
  const name = servers++ === 0 ? "docs" : "showcase";
  if (name === "showcase" && failure === name) throw primary;
  return {
    port: 1234,
    stop() {
      cleanup.push(name);
      if (name === "docs") throw new Error("Secondary server cleanup failure");
    },
  };
};
mock.module(${JSON.stringify(resolve(workspace, "apps/showcase/src/build-browser.ts"))}, () => ({
  buildBrowserShowcase: async () => {},
}));
mock.module("playwright", () => ({
  chromium: {
    async launch() {
      if (failure === "launch") throw primary;
      return {
        async newContext() { throw primary; },
        async close() {
          cleanup.push("browser");
          throw new Error("Secondary browser cleanup failure");
        },
      };
    },
  },
}));
process.argv.push("--coverage", ${JSON.stringify(report)});
try {
  await import(${JSON.stringify(resolve(workspace, "tooling/browser/acceptance.ts"))});
  throw new Error("Expected acceptance failure");
} catch (error) {
  console.log(JSON.stringify({ sameError: error === primary, message: error.message, cleanup }));
}
`;
      try {
        const child = Bun.spawn([process.execPath, "--eval", script], {
          cwd: workspace,
          env: {
            ...process.env,
            TUIL_BROWSER_ARTIFACTS: join(root, "artifacts"),
          },
          stdout: "pipe",
          stderr: "pipe",
          timeout: 5_000,
        });
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(exit, stderr).toBe(0);
        expect(JSON.parse(stdout)).toEqual({
          sameError: true,
          message: "Primary " + failure + " failure",
          cleanup:
            failure === "showcase"
              ? ["docs"]
              : failure === "launch"
                ? ["docs", "showcase"]
                : ["browser", "docs", "showcase"],
        });
        expect(await Bun.file(report).exists()).toBeFalse();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
