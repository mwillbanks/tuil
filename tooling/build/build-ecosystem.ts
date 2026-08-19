import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type BuildSpawn, spawnBuild } from "./build-all.ts";

const workspace = resolve(import.meta.dir, "../..");
const roots = ["apps", "examples"] as const;

async function buildRoot(
  root: (typeof roots)[number],
  spawn: BuildSpawn,
  include?: ReadonlySet<string>,
): Promise<void> {
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
    if (
      !manifest.scripts?.["build"] ||
      (include && !include.has(manifest.name))
    ) {
      continue;
    }
    if ((await spawn(["bun", "run", "build"], packageDirectory)) !== 0) {
      throw new Error(`Build failed for ${manifest.name}`);
    }
  }
}

export async function buildEcosystem(
  options: Readonly<{
    spawn?: BuildSpawn;
    include?: ReadonlySet<string>;
  }> = {},
): Promise<void> {
  const spawn = options.spawn ?? spawnBuild;
  for (const root of roots) {
    await buildRoot(root, spawn, options.include);
  }
}

await (import.meta.main ? buildEcosystem() : undefined);
