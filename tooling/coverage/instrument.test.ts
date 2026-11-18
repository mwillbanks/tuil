import { expect, test } from "bun:test";
import { createCoverageMap } from "istanbul-lib-coverage";
import {
  coverageVariable,
  instrumentCoverageSource,
} from "../../tests/helpers/coverage-instrument.ts";

test("counts distinct executable statements on the same TypeScript line", () => {
  const path = "/tuil-coverage-probe.ts";
  const source =
    "function evaluate(enabled: boolean) { if (enabled) throw new Error(); return true; } evaluate(false);";
  const instrumented = instrumentCoverageSource(path, source);
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(
    instrumented,
  );
  const sandbox: Record<string, unknown> = {};

  new Function("globalThis", javascript)(sandbox);

  const coverage = createCoverageMap(
    sandbox[coverageVariable] as Parameters<typeof createCoverageMap>[0],
  ).fileCoverageFor(path);
  const counts = Object.entries(coverage.statementMap)
    .filter(([, statement]) => statement.start.line === 1)
    .map(([id]) => coverage.s[id]);
  expect(counts).toContain(0);
  expect(counts).toContain(1);
  expect(coverage.toSummary().statements.total).toBeGreaterThan(1);
  expect(coverage.toSummary().lines.total).toBe(1);
});
