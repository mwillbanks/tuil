import { readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const generatedPatterns = [
  "apps/registry/public/**/*.json",
  "packages/cli/src/generated-registry.ts",
  "packages/cli/src/generated-ui/**/*.tsx",
  "registry/blocks/init-wizard.tsx",
  "registry/components/button.tsx",
  "registry/feedback/overlays.tsx",
  "registry/forms/controls.tsx",
  "registry/navigation/navigation.tsx",
  "registry/workflows/workflow.tsx",
] as const;

async function generatedFiles(): Promise<readonly string[]> {
  const files = new Set<string>();
  for (const pattern of generatedPatterns) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({
      cwd: repositoryRoot,
      absolute: true,
      onlyFiles: true,
    })) {
      files.add(path);
    }
  }
  return [...files].sort();
}

async function snapshot(
  paths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  return new Map(
    await Promise.all(
      paths.map(async (path) => [path, await readFile(path, "utf8")] as const),
    ),
  );
}

export async function checkRegistryArtifacts(): Promise<void> {
  const paths = await generatedFiles();
  const before = await snapshot(paths);
  let afterPaths: readonly string[] = [];
  try {
    const build = Bun.spawn([process.execPath, "tooling/registry/build.ts"], {
      cwd: repositoryRoot,
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
    afterPaths = await generatedFiles();
    const after = await snapshot(afterPaths);
    const changed = [...new Set([...paths, ...afterPaths])].filter(
      (path) => before.get(path) !== after.get(path),
    );
    if (changed.length > 0) {
      throw new Error(
        `Registry artifacts are stale:\n${changed
          .map((path) => `- ${relative(repositoryRoot, path)}`)
          .join("\n")}\nRun "bun run registry:build" and commit the results.`,
      );
    }
  } finally {
    afterPaths = afterPaths.length > 0 ? afterPaths : await generatedFiles();
    for (const path of new Set([...paths, ...afterPaths])) {
      const content = before.get(path);
      if (content === undefined) {
        await rm(path, { force: true });
      } else if (
        !(await Bun.file(path).exists()) ||
        (await Bun.file(path).text()) !== content
      ) {
        await writeFile(path, content, "utf8");
      }
    }
  }
}

await (import.meta.main ? checkRegistryArtifacts() : undefined);
