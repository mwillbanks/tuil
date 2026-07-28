import { expect, test } from "bun:test";
import {
  builtInLogParsers,
  commonLogParser,
  compileLogQuery,
  containerLogParser,
  createFieldRedactor,
  journaldParser,
  jsonLogParser,
  LogPipeline,
  LogRingBuffer,
  normalizeSeverity,
  openTelemetryLogParser,
  processLogParser,
  syslogParser,
} from "./index.ts";

test("severity normalization rejects non-numeric strings and clamps numbers", () => {
  expect(normalizeSeverity("unknown")).toEqual({
    number: undefined,
    text: "UNKNOWN",
  });
  expect(normalizeSeverity("100")).toEqual({ number: 24, text: "100" });
  expect(normalizeSeverity(-1)).toEqual({ number: 1 });
  expect(normalizeSeverity(undefined)).toEqual({});
});

test("RFC 5424 and RFC 3164 preserve severity, source, body, and raw payload", () => {
  const modern = syslogParser.parse(
    "<34>1 2003-10-11T22:14:15Z host app 1 ID47 - message",
  )[0];
  const legacy = syslogParser.parse("<34>Oct 11 22:14:15 host legacy")[0];
  expect(modern).toMatchObject({
    source: "syslog",
    body: "message",
  });
  expect(modern?.attributes["hostname"]).toBe("host");
  expect(legacy).toMatchObject({
    source: "syslog",
    body: "legacy",
  });
});

test("RFC 5424 accepts multiple escaped structured-data elements and BOM messages", () => {
  const record = syslogParser.parse(
    '<165>1 2003-10-11T22:14:15.003Z host app 8710 ID47 [exampleSDID@32473 iut="3" eventSource="Application"][meta key="escaped\\] quote\\" slash\\\\"] \uFEFFmessage',
  )[0];
  expect(record?.attributes["structuredData"]).toBe(
    '[exampleSDID@32473 iut="3" eventSource="Application"][meta key="escaped\\] quote\\" slash\\\\"]',
  );
  expect(record?.body).toBe("message");
  expect(
    syslogParser.parse(
      '<34>1 2003-10-11T22:14:15Z host app 1 ID47 [broken key="value"]tail',
    )[0]?.diagnostics,
  ).not.toHaveLength(0);
});

test("OTEL JSON preserves timestamps, severity, resource, scope, trace, and span", () => {
  const parsed = jsonLogParser.parse(
    JSON.stringify({
      timeUnixNano: "1000",
      observedTimeUnixNano: "1100",
      severityNumber: 17,
      severityText: "ERROR",
      body: "failure",
      resource: { "service.name": "api" },
      scope: { name: "worker", version: "1" },
      traceId: "abc",
      spanId: "def",
      flags: 1,
    }),
  )[0];
  expect(parsed).toMatchObject({
    source: "otel",
    timestamp: 1000n,
    observedTimestamp: 1100n,
    severityNumber: 17,
    traceId: "abc",
    spanId: "def",
  });
  expect(parsed?.resource["service.name"]).toBe("api");
});

test("OTLP envelopes and process output flatten into normalized records", () => {
  const records = openTelemetryLogParser.parse(
    JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "api" } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: "worker", version: "1" },
              logRecords: [
                {
                  timeUnixNano: "1000",
                  severityNumber: 17,
                  body: { stringValue: "failed" },
                  attributes: [{ key: "attempt", value: { intValue: "2" } }],
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  expect(records[0]).toMatchObject({
    body: "failed",
    source: "otel",
    scope: { name: "worker", version: "1" },
  });
  expect(records[0]?.resource["service.name"]).toBe("api");
  expect(records[0]?.attributes["attempt"]).toBe("2");
  expect(processLogParser.parse("stderr[42]: failed")[0]).toMatchObject({
    source: "process",
    severityText: "ERROR",
    body: "failed",
  });
  expect(
    commonLogParser.parse("2026-01-01T00:00:00Z WARN degraded")[0],
  ).toMatchObject({ severityText: "WARN", body: "degraded" });
  expect(commonLogParser.parse("malformed")[0]?.diagnostics).toHaveLength(1);
});

test("malformed records remain visible across JSON, syslog, journald, and container adapters", () => {
  expect(jsonLogParser.parse("{bad")[0]?.diagnostics).toHaveLength(1);
  expect(syslogParser.parse("bad")[0]?.body).toBe("bad");
  expect(
    journaldParser.parse(
      "__REALTIME_TIMESTAMP=1000\nMESSAGE=hello\nPRIORITY=3\n",
    )[0]?.body,
  ).toBe("hello");
  expect(
    containerLogParser.parse("2026-01-01T00:00:00Z stderr F failed")[0],
  ).toMatchObject({ source: "kubernetes", body: "failed" });
  for (const parser of builtInLogParsers) {
    expect(parser.detect('{"message":"ready"}')).toBeGreaterThanOrEqual(0);
  }
});

test("redaction precedes buffering, querying, copying, and export", () => {
  const pipeline = new LogPipeline({
    redactors: [createFieldRedactor(["password", "token"])],
  });
  const [item] = pipeline.ingest(
    '{"severity":"warn","body":{"password":"secret","ok":true},"attributes":{"token":"abc"}}',
    "json",
  );
  expect(item?.body).toEqual({
    password: "[REDACTED]",
    ok: true,
  });
  expect(pipeline.export()).not.toContain("secret");
  expect(pipeline.export()).not.toContain('"abc"');
  const nested = new LogPipeline({
    redactors: [createFieldRedactor(["secret"])],
  });
  expect(
    nested.ingest(
      '{"body":[{"secret":"hidden"},{"safe":true}],"attributes":{}}',
      "json",
    )[0]?.body,
  ).toEqual([{ secret: "[REDACTED]" }, { safe: true }]);

  const replayed = jsonLogParser.parse(
    '{"body":"password=restored","attributes":{"token":"restored"}}',
  );
  pipeline.replay(replayed);
  expect(pipeline.export()).not.toContain("restored");
});

test("typed queries support severity, fields, regex, fuzzy contains, saved searches, and history", () => {
  const pipeline = new LogPipeline();
  pipeline.ingest(
    [
      '{"severity":"info","body":"ready","resource":{"service.name":"web"}}',
      '{"severity":"error","body":"timeout","resource":{"service.name":"api"},"attributes":{"user_id":42}}',
    ].join("\n"),
    "json",
  );
  expect(
    pipeline.query(
      'severity >= warn and service = api and body contains "time"',
    ),
  ).toHaveLength(1);
  expect(pipeline.query("attributes.user_id = 42")).toHaveLength(1);
  expect(pipeline.query("body matches ^time")).toHaveLength(1);
  expect(pipeline.query("service = web or service = api")).toHaveLength(2);
  expect(pipeline.query("body ~ tmt")).toHaveLength(1);
  pipeline.saveSearch("errors", "severity >= error");
  expect(pipeline.savedSearches()).toEqual({
    errors: "severity >= error",
  });
  expect(pipeline.history()).toHaveLength(5);
  expect(pipeline.query("body matches (a+)+$")).toHaveLength(0);
  expect(pipeline.query(`body matches ${"a".repeat(257)}`)).toHaveLength(0);
  expect(compileLogQuery("invalid clause").diagnostics).toHaveLength(1);
  expect(pipeline.query("severity < error")).toHaveLength(1);
  expect(pipeline.query("severity <= info")).toHaveLength(1);
  expect(pipeline.query("severity > warn")).toHaveLength(1);
  expect(pipeline.query("source = jsonl")).toHaveLength(2);
  expect(pipeline.query("timestamp > now-15m")).toEqual([]);
});

test("deduplication, rate limits, sampling, and replay remain visible", () => {
  let now = 1_000;
  const pipeline = new LogPipeline({
    deduplicate: true,
    maxPerSecond: 1,
    now: () => now,
  });
  pipeline.ingest('{"message":"same"}', "json");
  const duplicate = pipeline.ingest('{"message":"same"}', "json")[0];
  expect(duplicate?.duplicateCount).toBe(2);
  expect(duplicate?.rateLimited).toBeUndefined();
  const limited = pipeline.ingest('{"message":"limited"}', "json")[0];
  expect(limited?.rateLimited).toBeTrue();
  expect(pipeline.buffer.records()).toHaveLength(1);
  expect(pipeline.buffer.statistics().rateLimited).toBe(1);
  now = 2_000;
  const next = pipeline.ingest('{"message":"next"}', "json")[0];
  expect(next?.rateLimited).not.toBe(true);
  if (next) pipeline.replay([next]);
  expect(pipeline.buffer.records()).toHaveLength(3);

  const sampled = new LogPipeline({ sampleEvery: 2 });
  expect(sampled.ingest("first", "text")[0]?.sampled).toBeTrue();
  expect(sampled.ingest("second", "text")[0]?.sampled).not.toBe(true);
  expect(sampled.buffer.records()).toHaveLength(1);
  expect(sampled.buffer.statistics().sampled).toBe(1);
});

test("pause preserves ingress for historical replay while exposing operational state", () => {
  const pipeline = new LogPipeline({ capacity: 2 });
  pipeline.ingest("before", "text");
  pipeline.buffer.pause();
  pipeline.ingest("during-one", "text");
  pipeline.ingest("during-two", "text");
  expect(pipeline.buffer.statistics()).toMatchObject({
    paused: true,
    size: 2,
    dropped: 1,
  });
  expect(pipeline.buffer.records().map((item) => item.body)).toEqual([
    "during-one",
    "during-two",
  ]);
  pipeline.buffer.resume();
  expect(pipeline.buffer.statistics().paused).toBeFalse();
});

test("sampling and rate options require positive safe integers", () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => new LogPipeline({ sampleEvery: value })).toThrow(
      "sampleEvery must be a positive integer",
    );
    expect(() => new LogPipeline({ maxPerSecond: value })).toThrow(
      "maxPerSecond must be a positive integer",
    );
    expect(() => new LogPipeline({ queryHistoryLimit: value })).toThrow(
      "queryHistoryLimit must be a positive integer",
    );
  }
});

test("filtering does not inflate bounded search history and clear resets live policies", () => {
  let now = 1_000;
  const pipeline = new LogPipeline({
    sampleEvery: 2,
    maxPerSecond: 1,
    queryHistoryLimit: 2,
    now: () => now,
  });
  pipeline.ingest("sampled", "text");
  pipeline.ingest("retained", "text");
  expect(pipeline.query('body contains "retained"')).toHaveLength(1);
  expect(pipeline.filter('body contains "retained"')).toHaveLength(1);
  pipeline.query("source = text");
  pipeline.query("severity >= error");
  expect(pipeline.history()).toEqual(["source = text", "severity >= error"]);

  pipeline.clear();
  expect(pipeline.buffer.statistics()).toMatchObject({
    size: 0,
    sampled: 0,
    rateLimited: 0,
  });
  expect(pipeline.ingest("first after clear", "text")[0]?.sampled).toBeTrue();
  now = 2_000;
  expect(pipeline.ingest("second after clear", "text")[0]?.rateLimited).toBe(
    undefined,
  );
});

test("log buffer observers are isolated from ingestion", () => {
  const pipeline = new LogPipeline();
  let healthyNotifications = 0;
  pipeline.buffer.subscribe(() => {
    throw new Error("observer failed");
  });
  pipeline.buffer.subscribe(() => {
    healthyNotifications += 1;
  });

  pipeline.ingest("ready", "text");

  expect(healthyNotifications).toBe(1);
  expect(pipeline.buffer.records()).toHaveLength(1);
});

test("100,000 records remain searchable and ring retention reports drops without silent loss", () => {
  const buffer = new LogRingBuffer(100_000);
  const pipeline = new LogPipeline({ capacity: 100_000 });
  const started = performance.now();
  const input = Array.from(
    { length: 100_000 },
    (_, index) =>
      `{"severity":"${index % 100 === 0 ? "error" : "info"}","body":"record ${index}","attributes":{"index":${index}}}`,
  ).join("\n");
  pipeline.ingest(input, "json");
  expect(pipeline.query("severity >= error")).toHaveLength(1_000);
  expect(performance.now() - started).toBeLessThan(2_500);
  const item = pipeline.buffer.records()[0];
  if (item) {
    for (let index = 0; index < 100_001; index += 1) {
      buffer.push(item);
    }
  }
  expect(buffer.statistics()).toMatchObject({
    size: 100_000,
    dropped: 1,
  });
  const empty = new LogRingBuffer(1);
  const first = pipeline.buffer.records()[0];
  if (first) {
    empty.replaceLast(first);
    empty.push(first);
  }
  empty.clear();
  expect(empty.statistics()).toMatchObject({ size: 0, dropped: 0 });
});

test("field redaction removes secrets from syslog, raw text, and exports", () => {
  const pipeline = new LogPipeline({
    redactors: [createFieldRedactor(["password", "token"])],
  });
  pipeline.ingest(
    '<34>1 2003-10-11T22:14:15.003Z host app 1 ID47 [auth password="supersecret" token=abc] ready',
    "syslog",
  );
  pipeline.ingest("password=hunter2 token: bearer", "text");
  const exported = pipeline.export();
  expect(exported).not.toContain("supersecret");
  expect(exported).not.toContain("hunter2");
  expect(exported).not.toContain("token=abc");
  expect(exported).toContain("[REDACTED]");
});
