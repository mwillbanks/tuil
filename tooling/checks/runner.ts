import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OxlintClient } from "./lint-client.ts";
import { discoverTestSuites } from "./suites.ts";
import { checkUnitTiming } from "./test-policy.ts";

export interface GateRunnerOptions {
  root?: string;
  databasePath?: string;
  once?: boolean;
  cycleLimit?: number;
  pause?: () => Promise<void>;
  runCommand?: (
    argv: string[],
  ) => Promise<{ command: string; code: number; output: string }>;
  createLintClient?: (
    binary: string,
    root: string,
  ) => Pick<OxlintClient, "diagnose" | "close">;
  emit?: (event: unknown) => void;
}

export async function runGateRunner(
  argv: string[],
  options: GateRunnerOptions = {},
) {
  const root =
    options.root ?? fileURLToPath(new URL("../../", import.meta.url));
  const emit =
    options.emit ?? ((event: unknown) => console.log(JSON.stringify(event)));
  const args = argv.filter((arg) => arg !== "--");
  const command = args.shift();
  const gitPath = options.databasePath
    ? undefined
    : Bun.spawnSync(
        [
          "git",
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "tuil-checks.sqlite",
        ],
        { cwd: root },
      );
  if (gitPath && gitPath.exitCode !== 0)
    throw new Error(gitPath.stderr.toString());
  const databasePath =
    options.databasePath ?? gitPath!.stdout.toString().trim();

  function displayStatus() {
    const database = new Database(databasePath, { readonly: true });
    try {
      const owner = database.query("SELECT * FROM owner").get();
      const cycle = database
        .query("SELECT * FROM cycles ORDER BY id DESC LIMIT 1")
        .get();
      emit({ databasePath, owner, cycle });
    } finally {
      database.close();
    }
  }

  const sourceRoots = [
    "apps",
    "examples",
    "packages",
    "registry",
    "tooling",
    "tests/helpers",
  ];
  const configurationFiles = [
    "package.json",
    "bun.lock",
    "bunfig.toml",
    "tooling/bunfig.changed.toml",
    "tsconfig.json",
    ".oxlintrc.json",
  ];
  const ignoredDirectories = new Set([
    ".git",
    ".next",
    ".source",
    "dist",
    "dist-storybook",
    "node_modules",
    "out",
    "generated-ui",
  ]);

  async function collectSources(directory: string): Promise<string[]> {
    const paths: string[] = [];
    let entries;
    try {
      entries = await readdir(resolve(root, directory), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return paths;
      throw error;
    }
    for (const entry of entries) {
      const path = relative(root, resolve(root, directory, entry.name));
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          paths.push(...(await collectSources(path)));
        }
      } else if (
        /\.[cm]?[jt]sx?$|(?:^|\/)(?:package|tsconfig(?:\.\w+)?)\.json$/.test(
          path,
        )
      ) {
        paths.push(path);
      }
    }
    return paths;
  }

  async function snapshot(scopes: readonly string[]) {
    const allPaths = (
      await Promise.all(sourceRoots.map(collectSources))
    ).flat();
    const inputs = [...new Set([...allPaths, ...configurationFiles])].sort();
    const hash = createHash("sha256");
    for (const path of inputs) {
      let bytes: Uint8Array;
      try {
        bytes = await Bun.file(resolve(root, path)).bytes();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      hash.update(path).update("\0");
      hash.update(bytes).update("\0");
    }
    const matches = (path: string) =>
      scopes.some(
        (scope) =>
          scope === "." || path === scope || path.startsWith(scope + "/"),
      );
    const tests = (await discoverTestSuites(root)).unit.filter(matches);
    return { generation: hash.digest("hex"), tests, inputs, matches };
  }

  async function run(argv: string[]) {
    const child = Bun.spawn(argv, {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(120_000),
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { command: argv.join(" "), code, output: out + err };
  }

  type TestResult = {
    command: string;
    code: number;
    output: string;
    coverage?: { report: string; sources: number; sha256: string };
  };
  type LintResult = { command: string; code: number; output: string };
  type LintDiagnostic = Awaited<ReturnType<OxlintClient["diagnose"]>>[number];
  type LintSession = {
    client?: Pick<OxlintClient, "diagnose" | "close">;
    configuration?: string;
    cached: Map<string, { source: string; output: string; failed: boolean }>;
  };

  function claimOwner(database: Database, scopes: readonly string[]) {
    const claim = database.transaction(() => {
      const owner = database.query("SELECT pid FROM owner").get() as {
        pid: number;
      } | null;
      if (owner) {
        let alive = true;
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          alive = false;
        }
        if (alive) throw new Error("Validation already has a live owner");
      }
      database
        .query("INSERT OR REPLACE INTO owner VALUES (1, ?, ?)")
        .run(process.pid, JSON.stringify(scopes));
    });
    claim.immediate();
  }

  async function runUnitTests(
    tests: readonly string[],
    cycleId: number,
    databasePath: string,
  ): Promise<TestResult> {
    if (tests.length === 0) {
      return {
        command: "",
        code: -1,
        output: "No unit tests were discovered in the requested scope.",
      };
    }
    try {
      await checkUnitTiming(tests, root);
      const coverageDirectory = resolve(
        dirname(databasePath),
        "tuil-checks-coverage",
        String(cycleId),
      );
      const result: TestResult = await (options.runCommand ?? run)([
        process.execPath,
        "--config=tooling/bunfig.changed.toml",
        "test",
        "--check",
        "--bail",
        "--no-orphans",
        "--coverage",
        "--coverage-reporter=lcov",
        "--coverage-dir=" + coverageDirectory,
        "--max-concurrency=1",
        ...tests.map((path) => "./" + path),
      ]);
      const report = resolve(coverageDirectory, "lcov.info");
      if (await Bun.file(report).exists()) {
        const evidence = await Bun.file(report).text();
        result.coverage = {
          report,
          sources: evidence.match(/^SF:/gm)?.length ?? 0,
          sha256: createHash("sha256").update(evidence).digest("hex"),
        };
      }
      return result;
    } catch (error) {
      return {
        command: "unit timing and tests",
        code: 1,
        output: String(error),
      };
    }
  }

  async function prepareLintSession(
    session: LintSession,
    configuration: string,
    binary: string,
  ) {
    if (configuration !== session.configuration) {
      await session.client?.close();
      session.client = undefined;
      session.cached.clear();
      session.configuration = configuration;
    }
    session.client ??=
      options.createLintClient?.(binary, root) ??
      new OxlintClient(binary, root);
  }

  async function diagnoseLintFiles(
    session: LintSession,
    paths: readonly string[],
  ) {
    let failures = 0;
    const output: string[] = [];
    for (const path of paths) {
      const filename = resolve(root, path);
      const source = await Bun.file(filename).text();
      let result = session.cached.get(path);
      if (result?.source !== source) {
        const diagnostics = await session.client!.diagnose(filename, source);
        result = {
          source,
          failed: diagnostics.some((entry) => entry.severity === 1),
          output: diagnostics
            .map((entry) => formatLintDiagnostic(path, entry))
            .join("\n"),
        };
        session.cached.set(path, result);
      }
      if (result.failed) failures++;
      if (result.output) output.push(result.output);
    }
    return { failures, output: output.join("\n") };
  }

  function formatLintDiagnostic(path: string, entry: LintDiagnostic) {
    return (
      path +
      ":" +
      (entry.range.start.line + 1) +
      ":" +
      (entry.range.start.character + 1) +
      ": " +
      entry.message
    );
  }

  async function runLintCycle(
    paths: readonly string[],
    session: LintSession,
  ): Promise<LintResult> {
    const fallback = {
      command: "oxlint --lsp",
      code: -1,
      output: "Oxlint or eligible source files are unavailable.",
    };
    const binary = resolve(root, "node_modules/.bin/oxlint");
    if (paths.length === 0 || !(await Bun.file(binary).exists()))
      return fallback;
    try {
      const config = Bun.file(resolve(root, ".oxlintrc.json"));
      const configuration = (await config.exists()) ? await config.text() : "";
      await prepareLintSession(session, configuration, binary);
      const result = await diagnoseLintFiles(session, paths);
      return {
        command: fallback.command,
        code: result.failures > 0 ? 1 : 0,
        output: result.output,
      };
    } catch (error) {
      await session.client?.close();
      session.client = undefined;
      session.cached.clear();
      return { ...fallback, output: String(error) };
    }
  }

  async function validateCycle(
    database: Database,
    scopes: readonly string[],
    current: Awaited<ReturnType<typeof snapshot>>,
    session: LintSession,
  ) {
    const cycle = database
      .query(
        "INSERT INTO cycles (generation, inputs, tests, state) VALUES (?, ?, ?, 'pending') RETURNING id",
      )
      .get(
        current.generation,
        JSON.stringify(current.inputs),
        JSON.stringify(current.tests),
      ) as { id: number };
    const test = await runUnitTests(current.tests, cycle.id, databasePath);
    const lintFiles = current.inputs.filter(
      (path) => /\.[cm]?[jt]sx?$/.test(path) && current.matches(path),
    );
    const lint = await runLintCycle(lintFiles, session);
    const unchanged =
      current.generation === (await snapshot(scopes)).generation;
    const state: "passed" | "failed" | "stale" = unchanged
      ? test.code === 0 && lint.code === 0
        ? "passed"
        : "failed"
      : "stale";
    database
      .query(
        "UPDATE cycles SET state=?, test_result=?, lint_result=? WHERE id=? AND state='pending'",
      )
      .run(state, JSON.stringify(test), JSON.stringify(lint), cycle.id);
    return {
      id: cycle.id,
      generation: current.generation,
      unchanged,
      state,
      test: test.code,
      lint: lint.code,
    };
  }

  async function watch(scopes: readonly string[]) {
    if (scopes.length === 0) throw new Error("Supply one or more owning paths");
    await mkdir(dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    database.exec(
      "CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, scope TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS cycles (id INTEGER PRIMARY KEY, generation TEXT NOT NULL, inputs TEXT NOT NULL, tests TEXT NOT NULL, state TEXT NOT NULL, test_result TEXT, lint_result TEXT);",
    );
    try {
      claimOwner(database, scopes);
    } catch (error) {
      database.close();
      throw error;
    }

    let stopping = false;
    const stop = () => {
      stopping = true;
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    emit({ owner: process.pid, databasePath, scopes });

    const lintSession: LintSession = { cached: new Map() };
    try {
      let settledGeneration: string | undefined;
      let completedCycles = 0;
      do {
        const current = await snapshot(scopes);
        if (current.generation !== settledGeneration) {
          const result = await validateCycle(
            database,
            scopes,
            current,
            lintSession,
          );
          completedCycles++;
          if (result.unchanged) settledGeneration = result.generation;
          emit({
            cycle: result.id,
            state: result.state,
            test: result.test,
            lint: result.lint,
          });
        }
        if (
          options.once ||
          (options.cycleLimit !== undefined &&
            completedCycles >= options.cycleLimit)
        )
          stopping = true;
        if (!stopping) await (options.pause?.() ?? Bun.sleep(1500));
      } while (!stopping);
    } finally {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
      await lintSession.client?.close();
      database.query("DELETE FROM owner WHERE pid=?").run(process.pid);
      database.close();
    }
  }

  if (command === "status") {
    displayStatus();
  } else if (command === "watch") {
    await watch(
      args.map((scope) => {
        const path = isAbsolute(scope)
          ? relative(root, scope)
          : relative(root, resolve(root, scope));
        if (path === ".." || path.startsWith("../"))
          throw new Error("Scope leaves the workspace");
        return path || ".";
      }),
    );
  } else {
    throw new Error(
      "Usage: bun tooling/checks/runner.ts watch <scopes...> | status",
    );
  }
}

if (import.meta.main) await runGateRunner(process.argv.slice(2));
