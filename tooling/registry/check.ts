import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  parseRegistryItem,
  type RegistryItem,
  registryIntegrity,
} from "../../packages/registry/src/index.ts";

const repositoryRoot = resolve(import.meta.dir, "../..");
const generatedPatterns = [
  "apps/registry/public/**/*.json",
  "apps/showcase/src/component-acceptance.stories.tsx",
  "apps/docs/content/docs/reference/components/acceptance-catalog.mdx",
  "packages/cli/src/generated-registry.ts",
  "packages/cli/src/generated-ui/**/*.tsx",
  "registry/blocks/init-wizard.tsx",
  "registry/components/button.tsx",
  "registry/feedback/overlays.tsx",
  "registry/forms/controls.tsx",
  "registry/navigation/navigation.tsx",
  "registry/workflows/workflow.tsx",
] as const;

async function generatedFiles(
  root = repositoryRoot,
): Promise<readonly string[]> {
  const files = new Set<string>();
  for (const pattern of generatedPatterns) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({
      cwd: root,
      absolute: true,
      onlyFiles: true,
    })) {
      files.add(path);
    }
  }
  return [...files].sort();
}

const indexedMetadataFields = [
  "name",
  "type",
  "tier",
  "version",
  "integrity",
  "ownership",
  "packageName",
  "compatibility",
  "deprecated",
  "codemods",
  "title",
  "description",
  "renderer",
  "capabilities",
  "semantics",
  "provenance",
  "dependencies",
  "registryDependencies",
  "slots",
] as const;

function hasCompletePublishedMetadata(item: RegistryItem): boolean {
  const required = [
    item.version,
    item.integrity,
    item.compatibility?.tuil,
    item.compatibility?.renderers?.length,
    item.provenance?.source,
    item.ownership,
  ];
  return required.every(Boolean);
}

function validatePublishedItem(item: RegistryItem): void {
  if (!hasCompletePublishedMetadata(item)) {
    throw new Error(`Registry item "${item.name}" has incomplete metadata`);
  }
  if (item.integrity !== registryIntegrity(item)) {
    throw new Error(`Registry item "${item.name}" has stale integrity`);
  }
  const ownedPackage =
    item.ownership === "package" || item.ownership === "plugin";
  if (ownedPackage && !item.packageName) {
    throw new Error(
      `Registry item "${item.name}" is missing its owned package`,
    );
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateIndexedItem(
  item: RegistryItem,
  indexItem: Readonly<Record<string, unknown>> | undefined,
): void {
  const itemRecord = item as unknown as Readonly<Record<string, unknown>>;
  for (const field of indexedMetadataFields) {
    if (!sameJsonValue(indexItem?.[field], itemRecord[field])) {
      throw new Error(
        `Registry index metadata for "${item.name}" is missing ${field}`,
      );
    }
  }
  const fileDescriptors = item.files.map(({ path, target, source }) => ({
    path,
    target,
    source,
  }));
  if (!sameJsonValue(indexItem?.["files"], fileDescriptors)) {
    throw new Error(
      `Registry index metadata for "${item.name}" is missing files`,
    );
  }
}

async function checkPublishedManifest(
  path: string,
  indexed: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): Promise<void> {
  const item = parseRegistryItem(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  );
  validatePublishedItem(item);
  validateIndexedItem(item, indexed.get(item.name));
}

async function checkPublishedMetadata(publicDirectory: string): Promise<void> {
  const index = JSON.parse(
    await readFile(resolve(publicDirectory, "registry.json"), "utf8"),
  ) as { readonly items?: readonly Record<string, unknown>[] };
  const indexed = new Map(
    (index.items ?? []).map((item) => [String(item["name"]), item]),
  );
  const manifests = new Bun.Glob("*.json");
  for await (const path of manifests.scan({
    cwd: publicDirectory,
    absolute: true,
    onlyFiles: true,
  })) {
    if (path.endsWith("/registry.json")) continue;
    await checkPublishedManifest(path, indexed);
  }
}

export async function checkRegistryArtifacts(): Promise<void> {
  const expectedPaths = await generatedFiles();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "tuil-registry-check-"));
  try {
    await symlink(
      resolve(repositoryRoot, "node_modules"),
      resolve(temporaryRoot, "node_modules"),
      "junction",
    );
    for (const path of [
      "biome.json",
      ".gitignore",
      "package.json",
      "apps/registry/public",
      "packages/registry",
      "packages/tuil/package.json",
      "registry",
      "tooling/registry",
    ]) {
      await cp(resolve(repositoryRoot, path), resolve(temporaryRoot, path), {
        recursive: true,
      });
    }
    await mkdir(resolve(temporaryRoot, "apps/showcase/src"), {
      recursive: true,
    });
    await mkdir(
      resolve(temporaryRoot, "apps/docs/content/docs/reference/components"),
      { recursive: true },
    );
    await mkdir(resolve(temporaryRoot, "packages/cli/src"), {
      recursive: true,
    });
    const build = Bun.spawn([process.execPath, "tooling/registry/build.ts"], {
      cwd: temporaryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Registry generation failed during verification:\n${stdout}${stderr}`,
      );
    }
    await checkPublishedMetadata(
      resolve(temporaryRoot, "apps/registry/public"),
    );
    const generatedPaths = await generatedFiles(temporaryRoot);
    const expectedRelativePaths = expectedPaths.map((path) =>
      relative(repositoryRoot, path),
    );
    const generatedRelativePaths = generatedPaths.map((path) =>
      relative(temporaryRoot, path),
    );
    const changed: string[] = [];
    for (const relativePath of new Set([
      ...expectedRelativePaths,
      ...generatedRelativePaths,
    ])) {
      const expectedFile = Bun.file(resolve(repositoryRoot, relativePath));
      const generatedFile = Bun.file(resolve(temporaryRoot, relativePath));
      if (
        !(await expectedFile.exists()) ||
        !(await generatedFile.exists()) ||
        (await expectedFile.text()) !== (await generatedFile.text())
      ) {
        changed.push(relativePath);
      }
    }
    if (changed.length > 0) {
      throw new Error(
        `Registry artifacts are stale:\n${changed
          .map((path) => `- ${path}`)
          .join("\n")}\nRun "bun run registry:build" and commit the results.`,
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await (import.meta.main ? checkRegistryArtifacts() : undefined);
