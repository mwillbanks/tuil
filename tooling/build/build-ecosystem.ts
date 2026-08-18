import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type BuildSpawn, spawnBuild } from "./build-all.ts";

const workspace = resolve(import.meta.dir, "../..");
const roots = ["apps", "examples"] as const;

export async function buildEcosystem(
  options: Readonly<{
    spawn?: BuildSpawn;
  }> = {},
): Promise<void> {
  const spawn = options.spawn ?? spawnBuild;
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
