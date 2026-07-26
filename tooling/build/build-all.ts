import { readdir } from "node:fs/promises";
import { join } from "node:path";

const packagesDirectory = join(import.meta.dir, "../../packages");
const packageDirectories = (
  await readdir(packagesDirectory, { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

interface PackageManifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
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

const manifests = new Map<string, PackageManifest>();
const directoriesByName = new Map<string, string>();
for (const directory of packageDirectories) {
  const manifest = (await Bun.file(
    join(packagesDirectory, directory, "package.json"),
  ).json()) as PackageManifest;
  manifests.set(manifest.name, manifest);
  directoriesByName.set(manifest.name, directory);
}

const packages = orderWorkspacePackages(manifests, directoriesByName);

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
