import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "../..");
const roots = ["apps", "examples"] as const;

export async function buildEcosystem(
  options: Readonly<{
    spawn?: (command: readonly string[], cwd: string) => Promise<number>;
  }> = {},
): Promise<void> {
  const spawn =
    options.spawn ??
    (async (command: readonly string[], cwd: string): Promise<number> => {
      const process = Bun.spawn([...command], {
        cwd,
        stdout: "inherit",
        stderr: "inherit",
      });
      return process.exited;
    });
  for (const root of roots) {
    const directory = join(workspace, root);
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const packageDirectory = join(directory, entry.name);
      const manifestFile = Bun.file(join(packageDirectory, "package.json"));
      if (!(await manifestFile.exists())) continue;
      const manifest = (await manifestFile.json()) as {
        readonly name: string;
        readonly scripts?: Readonly<Record<string, string>>;
      };
      if (!manifest.scripts?.["build"]) continue;
      if ((await spawn(["bun", "run", "build"], packageDirectory)) !== 0) {
        throw new Error(`Build failed for ${manifest.name}`);
      }
    }
  }
}

await (import.meta.main ? buildEcosystem() : undefined);
