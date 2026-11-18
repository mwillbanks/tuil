import { expect, test } from "bun:test";
import {
  compileLogQuery,
  openTelemetryLogParser,
} from "../../packages/logging/src/index.ts";

test("log query comparisons retain nanosecond precision", () => {
  const [record] = openTelemetryLogParser.parse(
    '{"timeUnixNano":"1700000000000000001","body":{"stringValue":"ready"}}',
  );
  if (!record) throw new Error("Expected one OpenTelemetry record");
  expect(
    compileLogQuery("timestamp = 1700000000000000001").predicate(record),
  ).toBe(true);
  expect(
    compileLogQuery("timestamp < 1700000000000000002").predicate(record),
  ).toBe(true);
  expect(
    compileLogQuery("timestamp >= 1700000000000000002").predicate(record),
  ).toBe(false);
});
