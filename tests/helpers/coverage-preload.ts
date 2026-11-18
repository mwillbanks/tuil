import { plugin } from "bun";
import { afterAll } from "bun:test";
import { writeFileSync } from "node:fs";
import {
  coverageVariable,
  createCoveragePlugin,
} from "./coverage-instrument.ts";

const scopeFile = process.env["TUIL_COVERAGE_SCOPE_FILE"];
const reportFile = process.env["TUIL_RUNTIME_COVERAGE_FILE"];
if (!scopeFile || !reportFile)
  throw new Error("Coverage preload requires a scope and report path");

const paths: string[] = await Bun.file(scopeFile).json();
plugin(await createCoveragePlugin(undefined, paths));
afterAll(() => {
  const coverage = Reflect.get(globalThis, coverageVariable);
  writeFileSync(reportFile, JSON.stringify(coverage ?? {}));
});
