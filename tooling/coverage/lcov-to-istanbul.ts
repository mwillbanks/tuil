import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Node, Project } from "ts-morph";

interface Position {
  readonly line: number;
  readonly column: number;
}

interface Location {
  readonly start: Position;
  readonly end: Position;
}

interface IstanbulFileCoverage {
  readonly path: string;
  readonly statementMap: Readonly<Record<string, Location>>;
  readonly s: Readonly<Record<string, number>>;
  readonly fnMap: Readonly<
    Record<
      string,
      {
        readonly name: string;
        readonly decl: Location;
        readonly loc: Location;
        readonly line: number;
      }
    >
  >;
  readonly f: Readonly<Record<string, number>>;
  readonly branchMap: Readonly<
    Record<
      string,
      {
        readonly line: number;
        readonly type: "branch";
        readonly locations: readonly Location[];
      }
    >
  >;
  readonly b: Readonly<Record<string, readonly number[]>>;
}

interface MutableIstanbulFileCoverage {
  path: string;
  statementMap: Record<string, Location>;
  s: Record<string, number>;
  fnMap: Record<
    string,
    { name: string; decl: Location; loc: Location; line: number }
  >;
  f: Record<string, number>;
  branchMap: Record<
    string,
    { line: number; type: "branch"; locations: readonly Location[] }
  >;
  b: Record<string, readonly number[]>;
}

interface V8ScriptCoverage {
  readonly scriptId: string;
  readonly url: string;
  readonly functions: readonly {
    readonly functionName: string;
    readonly ranges: readonly {
      readonly startOffset: number;
      readonly endOffset: number;
      readonly count: number;
    }[];
    readonly isBlockCoverage: true;
  }[];
}

const location = (line: number): Location => ({
  start: { line, column: 0 },
  end: { line, column: 0 },
});

export function lcovToIstanbul(
  source: string,
  workspace: string,
): Readonly<Record<string, IstanbulFileCoverage>> {
  const coverage: Record<string, IstanbulFileCoverage> = {};
  for (const record of source.split(/^end_of_record\r?$/m)) {
    const lines = record.split(/\r?\n/).filter(Boolean);
    const sourcePath = lines.find((line) => line.startsWith("SF:"))?.slice(3);
    if (!sourcePath) continue;
    const path = isAbsolute(sourcePath)
      ? sourcePath
      : resolve(workspace, sourcePath);
    const statementMap: Record<string, Location> = {};
    const statements: Record<string, number> = {};
    let statementId = 0;
    for (const line of lines.filter((entry) => entry.startsWith("DA:"))) {
      const [lineNumber, count] = line.slice(3).split(",");
      const id = String(statementId++);
      statementMap[id] = location(Number(lineNumber));
      statements[id] = Number(count);
    }

    const functionsByName = new Map<string, { line: number; count: number }>();
    for (const line of lines.filter((entry) => entry.startsWith("FN:"))) {
      const separator = line.indexOf(",", 3);
      if (separator < 0) continue;
      functionsByName.set(line.slice(separator + 1), {
        line: Number(line.slice(3, separator)),
        count: 0,
      });
    }
    for (const line of lines.filter((entry) => entry.startsWith("FNDA:"))) {
      const separator = line.indexOf(",", 5);
      if (separator < 0) continue;
      const name = line.slice(separator + 1);
      const existing = functionsByName.get(name);
      if (existing) existing.count = Number(line.slice(5, separator));
    }
    const fnMap: Record<
      string,
      { name: string; decl: Location; loc: Location; line: number }
    > = {};
    const functions: Record<string, number> = {};
    let functionId = 0;
    for (const [name, entry] of functionsByName) {
      const id = String(functionId++);
      fnMap[id] = {
        name,
        decl: location(entry.line),
        loc: location(entry.line),
        line: entry.line,
      };
      functions[id] = entry.count;
    }

    const branchesByBlock = new Map<
      string,
      Array<{ line: number; count: number }>
    >();
    for (const line of lines.filter((entry) => entry.startsWith("BRDA:"))) {
      const [lineNumber, block, , taken] = line.slice(5).split(",");
      const key = `${lineNumber}:${block}`;
      const branches = branchesByBlock.get(key) ?? [];
      branches.push({
        line: Number(lineNumber),
        count: taken === "-" ? 0 : Number(taken),
      });
      branchesByBlock.set(key, branches);
    }
    const branchMap: Record<
      string,
      { line: number; type: "branch"; locations: readonly Location[] }
    > = {};
    const branches: Record<string, readonly number[]> = {};
    let branchId = 0;
    for (const entries of branchesByBlock.values()) {
      const id = String(branchId++);
      branchMap[id] = {
        line: entries[0]?.line ?? 0,
        type: "branch",
        locations: entries.map((entry) => location(entry.line)),
      };
      branches[id] = entries.map((entry) => entry.count);
    }

    coverage[path] = {
      path,
      statementMap,
      s: statements,
      fnMap,
      f: functions,
      branchMap,
      b: branches,
    };
  }
  return coverage;
}

function functionName(node: Node): string {
  const named = node as Node & { getName?: () => string };
  const name = named.getName?.();
  if (name) return name;
  const parent = node.getParent();
  return (
    (parent && Node.isVariableDeclaration(parent)
      ? parent.getName()
      : undefined) ??
    (parent && Node.isPropertyAssignment(parent)
      ? parent.getName()
      : undefined) ??
    (Node.isArrowFunction(node) ? "<arrow>" : "<anonymous>")
  );
}

async function addSourceFunctions(
  coverage: Record<string, MutableIstanbulFileCoverage>,
): Promise<readonly V8ScriptCoverage[]> {
  const scripts = await Promise.all(
    Object.values(coverage).map(
      async (fileCoverage): Promise<V8ScriptCoverage | undefined> => {
        if (!(await Bun.file(fileCoverage.path).exists())) return undefined;
        const sourceText = await readFile(fileCoverage.path, "utf8");
        const project = new Project({ useInMemoryFileSystem: true });
        const source = project.createSourceFile(fileCoverage.path, sourceText);
        const countsByLine = new Map<number, number>();
        for (const [id, statement] of Object.entries(
          fileCoverage.statementMap,
        )) {
          countsByLine.set(statement.start.line, fileCoverage.s[id] ?? 0);
        }
        const enrichIstanbul = Object.keys(fileCoverage.fnMap).length === 0;
        const v8Functions: V8ScriptCoverage["functions"][number][] = [];
        for (const node of source.getDescendants()) {
          if (!Node.isFunctionLikeDeclaration(node)) continue;
          const callable = node as unknown as Node & {
            getBody: () => Node | undefined;
          };
          const body = callable.getBody();
          if (body) {
            const firstStatement = Node.isBlock(body)
              ? body.getStatements()[0]
              : undefined;
            const countLine = (firstStatement ?? body).getStartLineNumber();
            // Bun omits LCOV FN/FNDA records. The first executable line is the
            // closest available function execution count for V8-style coverage.
            const count = countsByLine.get(countLine) ?? 0;
            const bodyLocation: Location = {
              start: { line: node.getStartLineNumber(), column: 0 },
              end: { line: body.getEndLineNumber(), column: 0 },
            };
            if (enrichIstanbul) {
              const id = String(Object.keys(fileCoverage.fnMap).length);
              fileCoverage.fnMap[id] = {
                name: functionName(node),
                decl: {
                  start: { line: node.getStartLineNumber(), column: 0 },
                  end: { line: node.getStartLineNumber(), column: 0 },
                },
                loc: bodyLocation,
                line: node.getStartLineNumber(),
              };
              fileCoverage.f[id] = count;
            }
            v8Functions.push({
              functionName: functionName(node),
              ranges: [
                {
                  startOffset: node.getStart(),
                  endOffset: node.getEnd(),
                  count,
                },
              ],
              isBlockCoverage: true,
            });
          }
        }
        const scriptCount = Math.max(0, ...Object.values(fileCoverage.s));
        return {
          scriptId: String(
            Object.keys(coverage).indexOf(fileCoverage.path) + 1,
          ),
          url: pathToFileURL(fileCoverage.path).href,
          functions: [
            {
              functionName: "",
              ranges: [
                {
                  startOffset: 0,
                  endOffset: sourceText.length,
                  count: scriptCount,
                },
              ],
              isBlockCoverage: true,
            },
            ...v8Functions,
          ],
        };
      },
    ),
  );
  return scripts.filter(
    (script): script is V8ScriptCoverage => script !== undefined,
  );
}

export async function writeIstanbulCoverage(
  input: string,
  output: string,
  workspace: string,
  runtimeOutput?: string,
): Promise<void> {
  const coverage = lcovToIstanbul(
    await readFile(input, "utf8"),
    workspace,
  ) as Record<string, MutableIstanbulFileCoverage>;
  const runtimeCoverage = await addSourceFunctions(coverage);
  await Bun.write(output, `${JSON.stringify(coverage)}\n`);
  if (runtimeOutput) {
    await Bun.write(
      runtimeOutput,
      `${JSON.stringify({ result: runtimeCoverage, timestamp: Date.now() })}\n`,
    );
  }
}

const workspace = resolve(import.meta.dir, "../..");
await (import.meta.main
  ? writeIstanbulCoverage(
      resolve(workspace, "coverage/lcov.info"),
      resolve(workspace, "coverage/coverage-final.json"),
      workspace,
      resolve(workspace, "coverage/runtime-coverage.json"),
    )
  : undefined);
