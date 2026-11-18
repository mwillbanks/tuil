import { expect, test } from "bun:test";
import {
  BoundedBackpressureController,
  StreamingPipeline,
  builtInDocumentTransformers,
  builtInFormatParsers,
  type FormatParser,
  type PartialDocument,
} from "./index.ts";

function parser(id: string) {
  return builtInFormatParsers.find((value) => value.id === id)!;
}
function textDocument(source: string, complete: boolean): PartialDocument {
  return {
    format: "custom",
    source,
    complete,
    root: { type: "text", value: source },
    diagnostics: [],
  };
}
test("structured and telemetry parsers surface final errors and retain mixed valid scopes", () => {
  for (const id of ["jsonld", "otel"]) {
    const result = parser(id).parse("{", true);
    expect(result.complete).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      recoverable: false,
    });
  }
  const result = parser("otel").parse(
    JSON.stringify({
      resourceLogs: [
        null,
        { scopeLogs: [null, { logRecords: [{ body: "ready" }] }] },
      ],
    }),
    true,
  );
  expect(result.root.children).toMatchObject([
    { type: "otel-log-record", value: { body: "ready" } },
  ]);
  expect(parser("otel").parse("{}", true).root.children).toMatchObject([
    { type: "otel-log-record", value: {} },
  ]);
});
test("syslog structured data respects escaped quotes, multiple elements, and absent messages", () => {
  const prefix = "<34>1 2026-11-18T12:00:00Z host app 1 event ";
  for (const tail of [
    "-",
    '[one x="a\\\"b"][two y="]"] message',
    "[unfinished",
    "[one]",
  ]) {
    const result = parser("syslog").parse(prefix + tail, true);
    expect(result.root.children?.[0]?.type).toBe("rfc5424");
    expect(result.root.children?.[0]?.value).toMatchObject({
      structuredData: tail.includes(" message") ? tail.slice(0, -8) : tail,
      message: tail.includes(" message") ? "message" : "",
    });
  }
  expect(
    parser("syslog").parse("unstructured log", true).root.children?.[0]?.type,
  ).toBe("parse-error");
});
test("JSON path projection traverses arrays and preserves scalar null leaves", async () => {
  const pipeline = new StreamingPipeline({ format: "json" });
  const document = await pipeline.write('{"list":[1,null,{"enabled":false}]}');
  expect(await pipeline.project("json-path", document)).toEqual([
    { path: "$.list[0]", value: 1 },
    { path: "$.list[1]", value: null },
    { path: "$.list[2].enabled", value: false },
  ]);
  await expect(pipeline.project("absent", document)).rejects.toThrow(
    "not registered",
  );
  for (const transformer of [
    builtInDocumentTransformers.jsonLdToRelationships,
    builtInDocumentTransformers.structuredToSettings,
    builtInDocumentTransformers.logsToTimeline,
  ])
    expect(transformer.transform(document)).toBe(document);
});
test("custom parsers preserve bounded legacy input, callbacks, unregister, and reset", async () => {
  const calls: string[] = [];
  const custom: FormatParser = {
    id: "custom",
    mediaTypes: [],
    detect: () => 1,
    parse(source, complete) {
      calls.push(source);
      return textDocument(source, complete);
    },
  };
  const pipeline = new StreamingPipeline({
    format: "custom",
    parsers: [custom],
    maxSourceLength: 4,
    projections: [
      {
        id: "signal",
        project(document, context) {
          expect(context.signal.aborted).toBe(false);
          return document.source;
        },
      },
    ],
  });
  await pipeline.write("abc");
  const current = await pipeline.write("def");
  expect(current.source).toBe("cdef");
  expect(await pipeline.project("signal", current)).toBe("cdef");
  expect((await pipeline.end()).complete).toBe(true);
  pipeline.reset();
  expect((await pipeline.write("z")).source).toBe("z");
  expect(calls).toEqual(["abc", "cdef", "cdef", "z"]);
  const remove = pipeline.registerParser({ ...custom, id: "temporary" });
  remove();
  expect(() =>
    pipeline.registerParser({ ...custom, id: "temporary" }),
  ).not.toThrow();
  expect(() => pipeline.registerParser(custom)).toThrow("already registered");
});
test("pipeline cancellation preserves backpressure and skips later transformers", async () => {
  const pressure = new BoundedBackpressureController(1);
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let later = 0;
  const pipeline = new StreamingPipeline({
    format: "text",
    backpressure: pressure,
    transformers: [
      {
        id: "deferred",
        async transform(document, context) {
          expect(context.signal).toBe(controller.signal);
          entered.resolve();
          await release.promise;
          return document;
        },
      },
      {
        id: "later",
        transform(document) {
          later++;
          return document;
        },
      },
    ],
  });
  const pending = pipeline
    .write("ready", controller.signal)
    .catch((error: unknown) => error);
  await entered.promise;
  expect(pressure.desiredSize).toBe(0);
  controller.abort(new Error("cancelled"));
  release.resolve();
  expect(String(await pending)).toContain("cancelled");
  expect(later).toBe(0);
  expect(pressure.desiredSize).toBe(1);
  expect(pipeline.events()).toEqual([]);
  await expect(pressure.wait(controller.signal)).rejects.toThrow("cancelled");
  await expect(pipeline.write("later", controller.signal)).rejects.toThrow(
    "cancelled",
  );
});
test("line sessions reset diagnostics, trim history, and normalize CRLF boundaries", async () => {
  const pipeline = new StreamingPipeline({
    format: "jsonl",
    maxSourceLength: 4096,
  });
  const result = await pipeline.write(
    Array.from({ length: 260 }, () => "invalid\n").join(""),
  );
  expect(result.diagnostics).toHaveLength(256);
  pipeline.reset();
  expect(pipeline.events()).toEqual([]);
  await pipeline.write('{"ready":true}\r');
  const next = await pipeline.write("\n");
  expect(next.root.children?.[0]).toMatchObject({
    raw: '{"ready":true}',
    span: { start: 0, end: 14 },
  });
  expect(next.diagnostics).toEqual([]);
});
test("completion and JSON sessions restart without leaking prior document state", async () => {
  for (const format of ["xml", "yaml", "toml", "markdown"]) {
    const pipeline = new StreamingPipeline({ format });
    await pipeline.write(format === "xml" ? "<a>old</a>" : "value=1");
    await pipeline.end();
    pipeline.reset();
    expect((await pipeline.write("")).source).toBe("");
  }
  const json = new StreamingPipeline({ format: "json" });
  await json.write('{"message":"escaped \\');
  await json.write('" quote","list":[1,');
  const result = await json.write("2]}");
  expect(result.root.value).toEqual({
    message: 'escaped " quote',
    list: [1, 2],
  });
  json.reset();
  await json.write('{"fresh":true}');
  expect((await json.end()).root.value).toEqual({ fresh: true });
});

test("backpressure validates capacity and format detectors reject incomplete records", () => {
  for (const capacity of [0, -1, 1.5, Infinity])
    expect(() => new BoundedBackpressureController(capacity)).toThrow(
      "positive",
    );
  expect(parser("jsonl").detect('{"valid":true}\nnot-json')).toBe(0);
});
test("decoder completion can select a format and reset clears buffered state", async () => {
  let resets = 0;
  const pipeline = new StreamingPipeline({
    decoder: {
      id: "completion-fixture",
      write: () => "",
      flush: () => '{"ready":true}',
      reset() {
        resets++;
      },
    },
  });
  expect((await pipeline.end()).root.value).toEqual({ ready: true });
  expect(pipeline.events().at(-1)?.type).toBe("end");
  pipeline.reset();
  expect(resets).toBe(1);
  expect(pipeline.events()).toEqual([]);
});
