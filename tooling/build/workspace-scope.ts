import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface WorkspaceManifest {
  readonly name: string;
  readonly directory: string;
  readonly build: boolean;
  readonly dependencies: readonly string[];
}

export interface BuildScope {
  readonly all: boolean;
  readonly base: string;
  readonly buildRegistry: boolean;
  readonly workspaceNames: ReadonlySet<string>;
}

const workspaceRoots = ["packages", "apps", "examples"] as const;

async function discoverWorkspaces(
  workspace: string,
): Promise<readonly WorkspaceManifest[]> {
  const manifests: WorkspaceManifest[] = [];
  for (const root of workspaceRoots) {
    const rootDirectory = join(workspace, root);
    for (const entry of await readdir(rootDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(rootDirectory, entry.name);
      const file = Bun.file(join(directory, "package.json"));
      if (!(await file.exists())) continue;
      const manifest = (await file.json()) as {
        readonly name: string;
        readonly scripts?: Readonly<Record<string, string>>;
        readonly dependencies?: Readonly<Record<string, string>>;
        readonly peerDependencies?: Readonly<Record<string, string>>;
        readonly optionalDependencies?: Readonly<Record<string, string>>;
      };
      manifests.push({
        name: manifest.name,
        directory: relative(workspace, directory),
        build: Boolean(manifest.scripts?.["build"]),
        dependencies: Object.freeze([
          ...new Set([
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.peerDependencies ?? {}),
            ...Object.keys(manifest.optionalDependencies ?? {}),
          ]),
        ]),
      });
    }
  }
  return Object.freeze(manifests);
}

function transitiveClosure(
  seeds: ReadonlySet<string>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const selected = new Set(seeds);
  const pending = [...seeds];
  while (pending.length > 0) {
    const name = pending.pop() as string;
    for (const related of edges.get(name) ?? []) {
      if (selected.has(related)) continue;
      selected.add(related);
      pending.push(related);
    }
  }
  return selected;
}

export function selectImpactedWorkspaces(
  manifests: readonly WorkspaceManifest[],
  changedFiles: readonly string[],
  all = false,
): ReadonlySet<string> {
  const buildable = manifests.filter((manifest) => manifest.build);
  if (all) return new Set(buildable.map((manifest) => manifest.name));

  const globalBuildChange = changedFiles.some(isGlobalBuildFile);
  const deletedWorkspaceManifest = changedFiles.some(
    (path) =>
      /^(?:packages|apps|examples)\/[^/]+\/package\.json$/.test(path) &&
      !manifests.some(
        (manifest) => `${manifest.directory}/package.json` === path,
      ),
  );
  if (globalBuildChange || deletedWorkspaceManifest) {
    return new Set(buildable.map((manifest) => manifest.name));
  }

  const byName = new Map(
    manifests.map((manifest) => [manifest.name, manifest]),
  );
  const direct = directlyChangedWorkspaces(buildable, changedFiles);

  const dependencies = new Map<string, ReadonlySet<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const manifest of buildable) {
    const localDependencies = new Set(
      manifest.dependencies.filter(
        (dependency) => byName.get(dependency)?.build,
      ),
    );
    dependencies.set(manifest.name, localDependencies);
    for (const dependency of localDependencies) {
      const consumers = dependents.get(dependency) ?? new Set<string>();
      consumers.add(manifest.name);
      dependents.set(dependency, consumers);
    }
  }

  const impacted = transitiveClosure(direct, dependents);
  return transitiveClosure(impacted, dependencies);
}

function isGlobalBuildFile(path: string): boolean {
  return (
    path === "package.json" ||
    path === "bun.lock" ||
    path === "LICENSE" ||
    path === "README.md" ||
    path.startsWith("tooling/build/") ||
    /^tsconfig(?:\..+)?\.json$/.test(path)
  );
}

function directlyChangedWorkspaces(
  buildable: readonly WorkspaceManifest[],
  changedFiles: readonly string[],
): Set<string> {
  const direct = new Set(
    buildable
      .filter((manifest) =>
        changedFiles.some((path) => path.startsWith(`${manifest.directory}/`)),
      )
      .map((manifest) => manifest.name),
  );
  if (changedFiles.some((path) => path.startsWith("skills/"))) {
    direct.add("@mwillbanks/tuil");
    direct.add("@mwillbanks/tuil-cli");
  }
  const sharedExampleChanged = changedFiles.some(
    (path) =>
      path === "examples/_shared.tsx" || path.startsWith("examples/assets/"),
  );
  if (sharedExampleChanged) {
    for (const manifest of buildable) {
      if (manifest.directory.startsWith("examples/")) direct.add(manifest.name);
    }
  }
  const registryChanged = changedFiles.some(
    (path) =>
      path.startsWith("registry/") || path.startsWith("tooling/registry/"),
  );
  if (registryChanged) direct.add("@mwillbanks/tuil-cli");
  return direct;
}

async function gitLines(
  workspace: string,
  command: readonly string[],
): Promise<readonly string[]> {
  const child = Bun.spawn([...command], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to resolve changed workspaces: ${stderr.trim()}`);
  }
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function changedFiles(
  workspace: string,
  base: string,
): Promise<readonly string[]> {
  const range = base === "HEAD" ? "HEAD" : `${base}...HEAD`;
  const [tracked, untracked] = await Promise.all([
    gitLines(workspace, [
      "git",
      "diff",
      "--name-only",
      "--diff-filter=ACMRD",
      range,
    ]),
    gitLines(workspace, ["git", "ls-files", "--others", "--exclude-standard"]),
  ]);
  return Object.freeze([...new Set([...tracked, ...untracked])].sort());
}

export async function resolveBuildScope(
  workspace = resolve(import.meta.dir, "../.."),
  args = process.argv.slice(2),
): Promise<BuildScope> {
  const all =
    args.includes("--all") || process.env["TUIL_BUILD_ALL"] === "true";
  const baseIndex = args.indexOf("--base");
  let base = process.env["TUIL_BUILD_BASE"] ?? "HEAD";
  if (baseIndex >= 0) {
    const baseArgument = args[baseIndex + 1];
    if (!baseArgument || baseArgument.startsWith("--")) {
      throw new Error("--base requires a Git reference");
    }
    base = baseArgument;
  }
  if (!base || base.startsWith("--")) {
    throw new Error("--base requires a Git reference");
  }
  const files = all ? [] : await changedFiles(workspace, base);
  const manifests = await discoverWorkspaces(workspace);
  return Object.freeze({
    all,
    base,
    buildRegistry:
      all ||
      files.some(
        (path) =>
          path.startsWith("registry/") ||
          path.startsWith("tooling/registry/") ||
          path === "package.json" ||
          path === "bun.lock",
      ),
    workspaceNames: selectImpactedWorkspaces(manifests, files, all),
  });
}
