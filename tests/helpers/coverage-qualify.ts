import type { CoverageMapData } from "istanbul-lib-coverage";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { executeSuite, repositoryRoot } from "../../tooling/checks/suites.ts";
import { coverageSources } from "../../tooling/coverage/check.ts";
import { writeCoverageReports } from "../../tooling/coverage/report.ts";

async function run(
  args: string[],
  prefix = "/tuil",
  cwd = repositoryRoot,
): Promise<void> {
  const command = Bun.spawn([process.execPath, ...args], {
    cwd,
    env: { ...process.env, TUIL_DOCS_BASE_PATH: prefix },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await command.exited;
  if (code !== 0)
    throw new Error(
      "Qualification command failed (" + code + "): bun " + args.join(" "),
    );
}

export async function qualifyCoverage(): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), "tuil-coverage-"));
  const scope = join(staging, "scope.json");
  const report = join(staging, "runtime.json");
  const pages = join(staging, "pages.json");
  const root = join(staging, "root.json");
  try {
    await Bun.write(scope, JSON.stringify(await coverageSources()));
    await run(["run", "--cwd", "packages/tuil", "build"]);
    await run(["run", "docs:check"]);
    await executeSuite("all", { instrument: { scope, report } });
    await run(["tooling/browser/acceptance.ts", "--coverage", pages]);
    await run(
      ["../../tooling/docs/export.tsx"],
      "/",
      resolve(repositoryRoot, "apps/docs"),
    );
    await run(["tooling/docs/validate-static.ts"], "/");
    await run(["tooling/browser/acceptance.ts", "--coverage", root], "/");
    const reports: CoverageMapData[] = await Promise.all(
      [report, pages, root].map((path) => Bun.file(path).json()),
    );
    console.log(
      "Coverage passed: " +
        (await writeCoverageReports(reports, {
          root: repositoryRoot,
          output: resolve(repositoryRoot, "coverage"),
        })),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) await qualifyCoverage();
