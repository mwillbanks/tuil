import {
  createCoverageMap,
  type CoverageMap,
  type CoverageMapData,
  type FileCoverage,
} from "istanbul-lib-coverage";
import { resolve } from "node:path";
import { coverageSources } from "./check.ts";

const minimum = 0.95;
const metrics = ["lines", "functions", "statements"] as const;

export function coverageEvidence(
  reports: readonly CoverageMapData[],
  paths: readonly string[],
): { coverage: CoverageMap; failures: string[]; summary: string } {
  const coverage = createCoverageMap();
  for (const report of reports) coverage.merge(report);
  const expected = new Set(paths);
  coverage.filter((path) => expected.has(path));
  const reported = new Set(coverage.files());
  const missing = paths.filter((path) => !reported.has(path));
  const failures = missing.length
    ? [
        "Coverage report omits in-scope implementation files:\n" +
          missing.map((path) => "- " + path).join("\n"),
      ]
    : [];
  const totals = coverage.getCoverageSummary();
  const summary = metrics
    .map((metric) => {
      const { covered, total } = totals[metric];
      const ratio = total === 0 ? 0 : covered / total;
      const label =
        metric +
        " " +
        (ratio * 100).toFixed(2) +
        "% (" +
        covered +
        "/" +
        total +
        ")";
      if (ratio < minimum) failures.push(label + " is below 95%");
      return label;
    })
    .join(", ");
  return { coverage, failures, summary };
}

function lcovRecord(file: FileCoverage): string {
  const { lines, functions, branches } = file.toSummary();
  const records = ["TN:", "SF:" + file.path];
  for (const [id, fn] of Object.entries(file.fnMap)) {
    const label = fn.name + "#" + id;
    records.push("FN:" + fn.decl.start.line + "," + label);
    records.push("FNDA:" + (file.f[id] ?? 0) + "," + label);
  }
  records.push("FNF:" + functions.total, "FNH:" + functions.covered);
  for (const [line, count] of Object.entries(file.getLineCoverage())) {
    records.push("DA:" + line + "," + count);
  }
  records.push("LF:" + lines.total, "LH:" + lines.covered);
  for (const [id, branch] of Object.entries(file.branchMap)) {
    branch.locations.forEach((location, index) => {
      records.push(
        [
          "BRDA:" + location.start.line,
          id,
          index,
          file.b[id]?.[index] ?? 0,
        ].join(","),
      );
    });
  }
  records.push(
    "BRF:" + branches.total,
    "BRH:" + branches.covered,
    "end_of_record",
  );
  return records.join("\n");
}

export async function writeCoverageReports(
  reports: readonly CoverageMapData[],
  options: { readonly root: string; readonly output: string },
): Promise<string> {
  const paths = (await coverageSources(options.root)).map((path) =>
    resolve(options.root, path),
  );
  const { coverage, failures, summary } = coverageEvidence(reports, paths);
  const files = coverage
    .files()
    .sort()
    .map((path) => coverage.fileCoverageFor(path));
  await Promise.all([
    Bun.write(
      resolve(options.output, "coverage-final.json"),
      JSON.stringify(coverage.toJSON()) + "\n",
    ),
    Bun.write(
      resolve(options.output, "lcov.info"),
      files.map(lcovRecord).join("\n") + "\n",
    ),
  ]);
  if (failures.length) throw new Error(failures.join("\n"));
  return summary;
}
