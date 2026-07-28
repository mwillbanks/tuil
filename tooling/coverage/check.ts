import { relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const coverageFile = resolve(repositoryRoot, "coverage/lcov.info");

// Generated mirrors are byte-validated by the registry gate. Tests and
// declarative story definitions are not implementation coverage targets. The
// Tree-sitter worker runs in a separate isolate and is exercised through public
// CodeDocument integration tests, outside Bun's parent-process LCOV.
const sourcePatterns = [
  "apps/playground/src/**/*.{ts,tsx}",
  "apps/showcase/src/**/*.{ts,tsx}",
  "examples/**/*.{ts,tsx}",
  "packages/*/src/**/*.{ts,tsx}",
  "registry/**/*.{ts,tsx}",
  "tooling/**/*.{ts,tsx}",
] as const;
const excludedPatterns = [
  "**/*.test.{ts,tsx}",
  "**/*.stories.tsx",
  "packages/cli/src/generated-registry.ts",
  "packages/cli/src/generated-ui/**",
  "packages/code/src/worker.ts",
] as const;

export async function coverageSources(
  root = repositoryRoot,
): Promise<readonly string[]> {
  const excluded = excludedPatterns.map((pattern) => new Bun.Glob(pattern));
  const sources = new Set<string>();
  for (const pattern of sourcePatterns) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({
      cwd: root,
      absolute: false,
      onlyFiles: true,
    })) {
      if (!excluded.some((candidate) => candidate.match(path))) {
        sources.add(path);
      }
    }
  }
  return [...sources].sort();
}

export async function missingCoverageSources(
  report: string,
  root = repositoryRoot,
): Promise<readonly string[]> {
  const covered = new Set(
    [...report.matchAll(/^SF:(.+)$/gm)].map((match) =>
      relative(root, resolve(root, match[1] ?? "")),
    ),
  );
  return (await coverageSources(root)).filter((path) => !covered.has(path));
}

export async function checkCoverageCompleteness(
  report: string,
  root = repositoryRoot,
): Promise<void> {
  const missing = await missingCoverageSources(report, root);
  if (missing.length > 0) {
    throw new Error(
      `Coverage report omits in-scope implementation files:\n${missing
        .map((path) => `- ${path}`)
        .join("\n")}`,
    );
  }
}

export async function checkCoverageFile(
  path = coverageFile,
  root = repositoryRoot,
): Promise<void> {
  if (!(await Bun.file(path).exists())) {
    throw new Error("Coverage report is missing: run the full Bun test suite");
  }
  await checkCoverageCompleteness(await Bun.file(path).text(), root);
}

if (import.meta.main) {
  await checkCoverageFile();
}
