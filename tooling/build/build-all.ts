import { readdir } from "node:fs/promises";
import { join } from "node:path";

const packagesDirectory = join(import.meta.dir, "../../packages");
const packages = (await readdir(packagesDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const packageName of packages) {
  const directory = join(packagesDirectory, packageName);
  const process = Bun.spawn(["bun", "run", "build"], {
    cwd: directory,
    stdout: "inherit",
    stderr: "inherit",
  });

  if ((await process.exited) !== 0) {
    throw new Error(`Build failed for @mwillbanks/tuil-${packageName}`);
  }
}
