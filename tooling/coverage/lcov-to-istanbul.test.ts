import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lcovToIstanbul, writeIstanbulCoverage } from "./lcov-to-istanbul.ts";

test("converts LCOV statements, functions, and branches to Istanbul JSON", () => {
  const result = lcovToIstanbul(
    [
      "SF:packages/core/src/index.ts",
      "FN:3,example",
      "FNDA:7,example",
      "DA:3,7",
      "DA:4,0",
      "BRDA:4,0,0,3",
      "BRDA:4,0,1,-",
      "end_of_record",
    ].join("\n"),
    "/workspace",
  );
  expect(result["/workspace/packages/core/src/index.ts"]).toEqual({
    path: "/workspace/packages/core/src/index.ts",
    statementMap: {
      "0": { start: { line: 3, column: 0 }, end: { line: 3, column: 0 } },
      "1": { start: { line: 4, column: 0 }, end: { line: 4, column: 0 } },
    },
    s: { "0": 7, "1": 0 },
    fnMap: {
      "0": {
        name: "example",
        decl: { start: { line: 3, column: 0 }, end: { line: 3, column: 0 } },
        loc: { start: { line: 3, column: 0 }, end: { line: 3, column: 0 } },
        line: 3,
      },
    },
    f: { "0": 7 },
    branchMap: {
      "0": {
        line: 4,
        type: "branch",
        locations: [
          { start: { line: 4, column: 0 }, end: { line: 4, column: 0 } },
          { start: { line: 4, column: 0 }, end: { line: 4, column: 0 } },
        ],
      },
    },
    b: { "0": [3, 0] },
  });
});

test("preserves end_of_record in source filenames", () => {
  const result = lcovToIstanbul(
    ["SF:packages/core/src/end_of_record.ts", "DA:1,1", "end_of_record"].join(
      "\n",
    ),
    "/workspace",
  );

  expect(result["/workspace/packages/core/src/end_of_record.ts"]?.path).toBe(
    "/workspace/packages/core/src/end_of_record.ts",
  );
});

test("writes Istanbul and V8 JSON from Bun line coverage", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "tuil-coverage-"));
  try {
    const sourcePath = join(workspace, "source.ts");
    const lcovPath = join(workspace, "lcov.info");
    const istanbulPath = join(workspace, "coverage-final.json");
    const istanbulOnlyPath = join(workspace, "coverage-istanbul-only.json");
    const runtimePath = join(workspace, "runtime-coverage.json");
    await writeFile(
      sourcePath,
      [
        "export function example() {",
        "  return 1;",
        "}",
        "export const arrow = () => 2;",
        "export const object = { property: () => 3 };",
        "export default function () { return 4; }",
        "[() => 5];",
        "declare function signature(): void;",
        "",
      ].join("\n"),
    );
    await writeFile(
      lcovPath,
      [
        "SF:source.ts",
        "DA:1,1",
        "DA:2,3",
        "DA:4,2",
        "DA:5,1",
        "DA:6,1",
        "DA:7,1",
        "end_of_record",
        "SF:deleted.ts",
        "DA:1,1",
        "end_of_record",
      ].join("\n"),
    );
    await writeIstanbulCoverage(lcovPath, istanbulPath, workspace, runtimePath);
    await writeIstanbulCoverage(lcovPath, istanbulOnlyPath, workspace);
    const istanbul = JSON.parse(await readFile(istanbulPath, "utf8")) as Record<
      string,
      { readonly fnMap: Readonly<Record<string, { readonly name: string }>> }
    >;
    expect(Object.values(istanbul[sourcePath]?.fnMap ?? {})[0]?.name).toBe(
      "example",
    );
    const runtime = JSON.parse(await readFile(runtimePath, "utf8")) as {
      readonly result: readonly {
        readonly url: string;
        readonly functions: readonly {
          readonly functionName: string;
          readonly ranges: readonly { readonly count: number }[];
        }[];
      }[];
    };
    expect(runtime.result).toHaveLength(1);
    expect(runtime.result[0]?.functions[1]).toMatchObject({
      functionName: "example",
      ranges: [{ count: 3 }],
    });
    expect(
      runtime.result[0]?.functions.map((entry) => entry.functionName),
    ).toEqual(["", "example", "arrow", "property", "<anonymous>", "<arrow>"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
