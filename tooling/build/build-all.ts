import { join } from "node:path";

const packagesDirectory = join(import.meta.dir, "../../packages");
const packages = [
  "core",
  "events",
  "focus",
  "hotkeys",
  "plugin",
  "theme",
  "registry",
  "tuil",
  "ink",
  "testing",
  "testing-ink",
  "cli",
] as const;

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
