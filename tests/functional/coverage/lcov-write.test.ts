import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileCoverageData } from "istanbul-lib-coverage";
import {
  coverageEvidence,
  writeCoverageReports,
} from "../../../tooling/coverage/report.ts";

const location = {
  start: { line: 1, column: 0 },
  end: { line: 1, column: 10 },
};

function fixture(path: string, counts: [number, number]): FileCoverageData {
  return {
    path,
    statementMap: {
      "0": location,
      "1": { start: { line: 1, column: 10 }, end: { line: 1, column: 18 } },
    },
    s: { "0": counts[0], "1": counts[1] },
    fnMap: { "0": { name: "target", decl: location, loc: location, line: 1 } },
    f: { "0": counts[0] },
    branchMap: {
      "0": { loc: location, line: 1, type: "if", locations: [location] },
    },
    b: { "0": [counts[1]] },
  };
}

test("merges process and browser hits and rejects missing and uncovered sources", () => {
  const path = "/workspace/pkg.ts";
  const extra = "/workspace/test.ts";
  const partial = { [path]: fixture(path, [1, 0]) };
  const { summary, failures } = coverageEvidence([partial], [path, extra]);
  expect(summary).toContain("lines 100.00%");
  expect(failures).toEqual([
    "Coverage report omits in-scope implementation files:\n- " + extra,
    "statements 50.00% (1/2) is below 95%",
  ]);
  const browser = {
    [path]: fixture(path, [0, 1]),
    [extra]: fixture(extra, [0, 0]),
  };
  const merged = coverageEvidence([partial, browser], [path]);
  expect(merged.failures).toEqual([]);
  expect(merged.coverage.files()).toEqual([path]);
});

test("writes original source locations and genuine hits to downstream reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "tuil-coverage-report-"));
  try {
    const path = join(root, "packages/example/src/main.ts");
    const output = join(root, "coverage");
    await Bun.write(path, "function target() {}");
    const report = fixture(path, [7, 2]);
    const summary = await writeCoverageReports([{ [path]: report }], {
      root,
      output,
    });
    expect(summary).toContain("statements 100.00%");
    expect(await Bun.file(join(output, "coverage-final.json")).json()).toEqual({
      [path]: report,
    });
    const lcov = await Bun.file(join(output, "lcov.info")).text();
    expect(lcov).toContain("FNDA:7,target#0\n");
    expect(lcov).toContain("BRDA:1,0,0,2\n");
    await expect(
      writeCoverageReports([{ [path]: fixture(path, [0, 0]) }], {
        root,
        output,
      }),
    ).rejects.toThrow("lines 0.00%");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
