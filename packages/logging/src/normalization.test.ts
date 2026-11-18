import { expect, test } from "bun:test";
import { useTestClock } from "../../../tests/helpers/clock.ts";
import {
  compileLogQuery,
  createFieldRedactor,
  LogPipeline,
  LogRingBuffer,
  openTelemetryLogParser,
} from "./index.ts";

const clock = useTestClock();

test("normalizes nested OpenTelemetry body and resource attributes", () => {
  const [record] = openTelemetryLogParser.parse(
    JSON.stringify({
      resourceLogs: [
        null,
        {
          resource: { attributes: { "service.name": "console" } },
          scopeLogs: [
            null,
            {
              logRecords: [
                null,
                {
                  timeUnixNano: "2024-01-01T00:00:00.000Z",
                  severityNumber: 50,
                  body: {
                    kvlistValue: {
                      values: [
                        {
                          key: "values",
                          value: {
                            arrayValue: {
                              values: [{ intValue: "7" }, { boolValue: false }],
                            },
                          },
                        },
                        { key: "empty", value: { arrayValue: {} } },
                        { key: "literal", value: "unchanged" },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  expect(record?.body).toEqual({
    values: ["7", false],
    empty: [],
    literal: "unchanged",
  });
  expect(record?.resource).toEqual({ "service.name": "console" });
  expect(record?.severityNumber).toBe(24);
  expect(record?.scope).toBeUndefined();
  expect(record?.timestamp).toBe(1704067200000000000n);
  expect(openTelemetryLogParser.parse("{")[0]?.diagnostics[0]?.severity).toBe(
    "error",
  );
});

test("replay preserves normalized records and applies enrichers and recursive redactors", () => {
  const pipeline = new LogPipeline({
    enrichers: [
      {
        id: "sample",
        enrich: (record) => ({
          ...record,
          body: [{ token: "abc" }, "next token=def"],
        }),
      },
    ],
    redactors: [createFieldRedactor(["token"], "hidden")],
    queryHistoryLimit: 2,
    now: clock.now,
  });
  const [record] = openTelemetryLogParser.parse(
    JSON.stringify({
      timeUnixNano: String(BigInt(clock.now()) * 1_000_000n),
      severityText: "info",
      attributes: { attempts: 2 },
    }),
  );
  if (!record) throw new Error("Expected a log record");
  pipeline.replay([record]);
  expect(pipeline.buffer.last()?.body).toEqual([
    { token: "hidden" },
    'next token="hidden"',
  ]);
  expect(pipeline.query("timestamp >= now-1s")).toHaveLength(1);
  expect(pipeline.query("attributes.attempts <= 2")).toHaveLength(1);
  expect(pipeline.query("attributes.missing > 0")).toHaveLength(0);
  expect(pipeline.history()).toEqual([
    "attributes.attempts <= 2",
    "attributes.missing > 0",
  ]);
  expect(pipeline.export(undefined, "text")).toContain("next token");
  expect(pipeline.export()).toContain(String(BigInt(clock.now()) * 1_000_000n));
  expect(() => pipeline.ingest("line", "unknown")).toThrow("unavailable");
  expect(() => new LogRingBuffer(0)).toThrow("positive");
  pipeline.clear();
  expect(pipeline.buffer.last()).toBeUndefined();
  pipeline.buffer.replaceLast(record);
  expect(pipeline.buffer.records()).toEqual([]);
  expect(compileLogQuery("timestamp >= invalid").predicate(record)).toBe(false);
});
