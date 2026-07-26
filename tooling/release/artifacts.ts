import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface PublishArtifact {
  readonly sourceDirectory: string;
  readonly artifactDirectory: string;
  readonly name: string;
  readonly version: string;
  readonly workspaceDependencies: readonly string[];
}

export function orderPublishArtifacts(
  artifacts: readonly PublishArtifact[],
): readonly PublishArtifact[] {
  const byName = new Map(
    artifacts.map((artifact) => [artifact.name, artifact]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: PublishArtifact[] = [];
  const visit = (artifact: PublishArtifact): void => {
    if (visited.has(artifact.name)) return;
    if (visiting.has(artifact.name)) {
      throw new Error(`Publication dependency cycle includes ${artifact.name}`);
    }
    visiting.add(artifact.name);
    for (const dependency of [...artifact.workspaceDependencies].sort()) {
      const local = byName.get(dependency);
      if (local) visit(local);
    }
    visiting.delete(artifact.name);
    visited.add(artifact.name);
    ordered.push(artifact);
  };
  for (const artifact of [...artifacts].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    visit(artifact);
  }
  return Object.freeze(ordered);
}

export async function discoverPublishArtifacts(
  workspace: string,
): Promise<readonly PublishArtifact[]> {
  const packageRoot = join(workspace, "packages");
  const artifacts: PublishArtifact[] = [];
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourceDirectory = join(packageRoot, entry.name);
    const sourceFile = Bun.file(join(sourceDirectory, "package.json"));
    if (!(await sourceFile.exists())) continue;
    const source = (await sourceFile.json()) as {
      readonly name: string;
      readonly version: string;
      readonly private?: boolean;
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly optionalDependencies?: Readonly<Record<string, string>>;
    };
    if (source.private) continue;
    const artifactDirectory = join(sourceDirectory, "dist");
    const artifactFile = Bun.file(join(artifactDirectory, "package.json"));
    if (!(await artifactFile.exists())) {
      throw new Error(`Missing publication artifact for ${source.name}`);
    }
    const artifact = (await artifactFile.json()) as {
      readonly name: string;
      readonly version: string;
    };
    if (artifact.name !== source.name || artifact.version !== source.version) {
      throw new Error(
        `Publication artifact identity mismatch for ${source.name}`,
      );
    }
    artifacts.push({
      sourceDirectory,
      artifactDirectory,
      name: source.name,
      version: source.version,
      workspaceDependencies: Object.freeze([
        ...new Set([
          ...Object.keys(source.dependencies ?? {}),
          ...Object.keys(source.optionalDependencies ?? {}),
        ]),
      ]),
    });
  }
  return orderPublishArtifacts(artifacts);
}

export const npmPackArguments = (destination: string): readonly string[] => [
  "npm",
  "pack",
  "--pack-destination",
  destination,
  "--ignore-scripts",
];

export const npmPublishArguments = (tag = "latest"): readonly string[] => [
  "npm",
  "publish",
  "--access",
  "public",
  "--provenance",
  "--tag",
  tag,
];
