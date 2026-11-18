import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { checkUnitTiming } from "./test-policy.ts";

export type TestSuite = "unit" | "functional" | "regression";
export interface TestInventory {
  readonly unit: readonly string[];
  readonly functional: readonly string[];
  readonly regression: readonly string[];
}
export const repositoryRoot = resolve(import.meta.dir, "../..");
const excludedDirectories = new Set(["node_modules", "dist", "out"]);
const testFile = new Bun.Glob("*.{test,spec}.{ts,tsx,js,jsx}");

export function isExcludedTest(path: string): boolean {
  return (
    path === "coverage" ||
    path.startsWith("coverage/") ||
    path
      .split("/")
      .some(
        (segment) =>
          segment.startsWith(".") || excludedDirectories.has(segment),
      )
  );
}

export function classifyTest(path: string): TestSuite {
  if (path.startsWith("tests/functional/")) return "functional";
  if (path.startsWith("tests/regression/")) return "regression";
  if (
    path.startsWith("tests/") ||
    !/^(?:packages\/[^/]+\/src\/|apps\/[^/]+\/src\/|tooling\/)/.test(path)
  ) {
    throw new Error(
      "Test requires an owning unit directory or root harness suite: " + path,
    );
  }
  return "unit";
}

export async function discoverTestSuites(
  root = repositoryRoot,
): Promise<TestInventory> {
  const inventory: Record<TestSuite, string[]> = {
    unit: [],
    functional: [],
    regression: [],
  };
  async function discover(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(join(root, directory), { withFileTypes: true });
    } catch (error) {
      if (directory && (error as NodeJS.ErrnoException).code === "ENOENT")
        return;
      throw error;
    }
    for (const entry of entries) {
      const path = directory ? directory + "/" + entry.name : entry.name;
      if (isExcludedTest(path)) continue;
      if (entry.isDirectory()) await discover(path);
      else if (entry.isFile() && testFile.match(entry.name))
        inventory[classifyTest(path)].push(path);
    }
  }
  await discover("");
  for (const suite of Object.values(inventory)) suite.sort();
  return inventory;
}

export async function executeSuite(
  suite: TestSuite | "all",
  options: {
    readonly coverage?: boolean;
    readonly paths?: readonly string[];
    readonly instrument?: { readonly scope: string; readonly report: string };
  } = {},
): Promise<void> {
  if (suite === "all" && (!options.instrument || options.paths?.length)) {
    throw new Error(
      "Full qualification requires instrumented coverage of every suite",
    );
  }
  const inventory = await discoverTestSuites();
  const suites =
    suite === "all" ? Object.values(inventory).flat() : inventory[suite];
  const requested = options.paths?.map((path) =>
    relative(repositoryRoot, resolve(path)),
  );
  const tests = requested?.length
    ? suites.filter((path) =>
        requested.some(
          (scope) => path === scope || path.startsWith(scope + "/"),
        ),
      )
    : suites;
  if (tests.length === 0) throw new Error("No tests discovered for " + suite);
  if (suite === "unit" || suite === "all")
    await checkUnitTiming(inventory.unit);
  const instrument = options.instrument;
  const argv = [
    process.execPath,
    "--config=tooling/bunfig.changed.toml",
    "test",
    "--check",
    "--no-orphans",
    "--bail",
    "--max-concurrency=1",
    ...(instrument ? ["--preload", "./tests/helpers/coverage-preload.ts"] : []),
    ...(options.coverage
      ? ["--coverage", "--coverage-reporter=lcov", "--coverage-reporter=text"]
      : []),
    ...tests.map((path) => "./" + path),
  ];
  const child = Bun.spawn(argv, {
    cwd: repositoryRoot,
    env: instrument
      ? {
          ...process.env,
          TUIL_COVERAGE_SCOPE_FILE: instrument.scope,
          TUIL_RUNTIME_COVERAGE_FILE: instrument.report,
        }
      : process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await child.exited;
  if (result !== 0)
    throw new Error(suite + " suite failed with exit " + result);
}

if (import.meta.main) {
  const [command = "unit", ...args] = process.argv
    .slice(2)
    .filter((arg) => arg !== "--");
  const inventory = await discoverTestSuites();
  if (command === "inventory") {
    console.log(JSON.stringify(inventory, null, 2));
  } else if (command === "policy") {
    await checkUnitTiming(inventory.unit);
  } else if (["unit", "functional", "regression"].includes(command)) {
    await executeSuite(command as TestSuite, {
      coverage: args.includes("--coverage"),
      paths: args.filter((arg) => arg !== "--coverage"),
    });
  } else {
    throw new Error(
      "Usage: bun tooling/checks/suites.ts unit|functional|regression|inventory|policy [paths...]",
    );
  }
}
