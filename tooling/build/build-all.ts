import { readdir } from "node:fs/promises";
import { join } from "node:path";

interface PackageManifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export type BuildSpawn = (
  command: readonly string[],
  cwd: string,
) => Promise<number>;

export async function spawnBuild(
  command: readonly string[],
  cwd: string,
): Promise<number> {
  const process = Bun.spawn([...command], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return process.exited;
}

export function orderWorkspacePackages(
  manifests: ReadonlyMap<string, PackageManifest>,
  directoriesByName: ReadonlyMap<string, string>,
): readonly string[] {
  const remaining = new Set(manifests.keys());
  const built = new Set<string>();
  const packages: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((name) => {
        const manifest = manifests.get(name);
        const dependencies = {
          ...manifest?.dependencies,
          ...manifest?.peerDependencies,
        };
        return Object.keys(dependencies).every(
          (dependency) => !remaining.has(dependency) || built.has(dependency),
        );
      })
      .sort();
    if (ready.length === 0) {
      throw new Error(
        `Workspace package dependency cycle: ${[...remaining].sort().join(", ")}`,
      );
    }
    for (const name of ready) {
      remaining.delete(name);
      built.add(name);
      packages.push(directoriesByName.get(name) as string);
    }
  }
  return Object.freeze(packages);
}

export async function buildAll(
  options: Readonly<{
    spawn?: BuildSpawn;
    include?: ReadonlySet<string>;
  }> = {},
): Promise<void> {
  const packagesDirectory = join(import.meta.dir, "../../packages");
  const packageDirectories = (
    await readdir(packagesDirectory, { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const manifests = new Map<string, PackageManifest>();
  const directoriesByName = new Map<string, string>();
  const namesByDirectory = new Map<string, string>();
  for (const directory of packageDirectories) {
    const manifest = (await Bun.file(
      join(packagesDirectory, directory, "package.json"),
    ).json()) as PackageManifest;
    manifests.set(manifest.name, manifest);
    directoriesByName.set(manifest.name, directory);
    namesByDirectory.set(directory, manifest.name);
  }

  const packages = orderWorkspacePackages(manifests, directoriesByName);
  const spawn = options.spawn ?? spawnBuild;
  for (const packageName of packages) {
    const directory = join(packagesDirectory, packageName);
    const name = namesByDirectory.get(packageName);
    if (options.include && (!name || !options.include.has(name))) {
      continue;
    }
    if ((await spawn(["bun", "run", "build"], directory)) !== 0) {
      throw new Error(`Build failed for @mwillbanks/tuil-${packageName}`);
    }
  }
}

await (import.meta.main ? buildAll() : undefined);
