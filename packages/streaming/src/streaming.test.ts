import { expect, test } from "bun:test";
import {
  BoundedBackpressureController,
  builtInDocumentTransformers,
  builtInFormatParsers,
  builtInRenderProjections,
  StreamingPipeline,
  Utf8StreamDecoder,
} from "./index.ts";

function builtInParser(id: string) {
  const parser = builtInFormatParsers.find((candidate) => candidate.id === id);
  if (!parser) throw new Error(`Missing built-in parser ${id}`);
  return parser;
}

test("UTF-8 decoding and streaming markdown recover across arbitrary chunk boundaries", async () => {
  const pipeline = new StreamingPipeline({ format: "markdown" });
  await pipeline.write("# heading\n```t");
  const partial = await pipeline.write("s\nconst x = 1");
  expect(partial.complete).toBe(false);
  const complete = await pipeline.end();
  expect(complete.diagnostics[0]?.message).toContain("Incomplete");
  expect(pipeline.replay().some((event) => event.type === "diagnostic")).toBe(
    true,
  );
});

test("built-in parsers cover JSONL, JSON-LD, and OpenTelemetry", () => {
  expect(
    builtInParser("jsonld").parse(
      '{"@context":{},"@graph":[{"@id":"service"}]}',
      true,
    ).root.children?.[0]?.attributes?.["id"],
  ).toBe("service");
  expect(
    builtInParser("otel").parse(
      '{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"body":"ready"}]}]}]}',
      true,
    ).root.children,
  ).toHaveLength(1);
  expect(
    builtInParser("jsonl").parse('{"x":1}\nmalformed', true).diagnostics,
  ).toHaveLength(1);
});

test("built-in parsers normalize XML, TOML, and YAML", () => {
  const xml = builtInParser("xml").parse(
    '<root><x id="one">value</x></root>',
    true,
  );
  expect(xml.complete).toBe(true);
  expect(xml.root.children?.[0]).toMatchObject({
    type: "element",
    attributes: { name: "root" },
  });
  expect(
    builtInParser("toml").parse("port = 3000", true).root.children?.[0]?.type,
  ).toBe("property");
  expect(
    builtInParser("yaml").parse("port: 3000", true).root.children?.[0]?.type,
  ).toBe("property");
});

test("built-in parsers normalize syslog, diff, and Markdown", () => {
  const rfc5424 = builtInParser("syslog").parse(
    '<34>1 2003-10-11T22:14:15Z host app 1 ID47 [meta key="value"] message',
    true,
  ).root.children?.[0];
  expect(rfc5424?.type).toBe("rfc5424");
  expect(rfc5424?.value).toMatchObject({
    facility: 4,
    severity: 2,
    structuredData: '[meta key="value"]',
    message: "message",
  });
  expect(
    builtInParser("syslog").parse("<34>Oct 11 22:14:15 host message", true).root
      .children?.[0]?.type,
  ).toBe("rfc3164");
  expect(
    builtInParser("diff").parse("@@ -1 +1 @@\n-old\n+new", true).root
      .children?.[0]?.type,
  ).toBe("hunk");
  const markdown = builtInParser("markdown").parse(
    "| Name |\n| --- |\n| TUIL |\n\n[Docs](https://example.test)",
    true,
  );
  expect(markdown?.root.children?.[0]?.type).toBe("table");
  expect(markdown?.root.children?.[1]?.children?.[0]?.attributes?.["url"]).toBe(
    "https://example.test",
  );
});

test("built-in parser detection and recovery remain deterministic", () => {
  for (const parser of builtInFormatParsers) {
    expect(parser.detect('{"message":"ready"}')).toBeGreaterThanOrEqual(0);
    expect(parser.parse("", false).complete).toBeFalse();
  }
  expect(builtInParser("jsonl").detect('{"a":1}\n{"b":2}')).toBeGreaterThan(
    0.9,
  );
  expect(builtInParser("json").parse("{", false).diagnostics).toHaveLength(1);
  expect(builtInParser("xml").parse("<root>", false).complete).toBeFalse();
  expect(
    builtInParser("toml").parse("invalid", true).diagnostics,
  ).not.toHaveLength(0);
  expect(builtInParser("yaml").parse("invalid", true).root.value).toBe(
    "invalid",
  );
  expect(
    builtInParser("diff").parse(" plain", true).root.children,
  ).toHaveLength(1);
  expect(builtInParser("text").parse("plain", true).root.value).toBe("plain");
});

test("transformers, projections, cancellation, bounded memory, and replay compose", async () => {
  const pipeline = new StreamingPipeline({
    format: "json",
    maxSourceLength: 32,
    transformers: [
      {
        id: "table",
        transform(document) {
          return { ...document, root: { ...document.root, type: "table" } };
        },
      },
    ],
    projections: [
      {
        id: "type",
        project: (document) => document.root.type,
      },
    ],
  });
  const document = await pipeline.write('{"x":1}');
  expect(document.root.type).toBe("table");
  expect(await pipeline.project<string>("type", document)).toBe("table");
  await pipeline.end();
  expect(pipeline.events().at(-1)?.type).toBe("end");
  const retained = await new StreamingPipeline({
    maxSourceLength: 2,
    format: "text",
  }).write("long\n");
  expect(retained.source.length).toBeLessThanOrEqual(2);
});

test("stream retention limits require positive safe integers", () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => new StreamingPipeline({ maxSourceLength: value })).toThrow(
      "maxSourceLength must be a positive integer",
    );
    expect(() => new StreamingPipeline({ maxEvents: value })).toThrow(
      "maxEvents must be a positive integer",
    );
  }
  expect(
    () => new StreamingPipeline({ maxSourceLength: 1, maxEvents: 1 }),
  ).not.toThrow();
});

test("built-in transformers and simultaneous projections cover content views", async () => {
  const markdown = new StreamingPipeline({
    format: "markdown",
    transformers: [builtInDocumentTransformers.headingsToOutline],
  });
  const outline = await markdown.write("# One\n## Two");
  expect(outline.format).toBe("outline");

  const json = new StreamingPipeline({ format: "json" });
  const document = await json.write('{"service":{"ready":true}}');
  expect(await json.project<string>("raw", document)).toContain("service");
  expect(await json.project("tree", document)).toMatchObject({ type: "json" });
  expect(
    await json.project<readonly { path: string; value: unknown }[]>(
      "json-path",
      document,
    ),
  ).toEqual([{ path: "$.service.ready", value: true }]);
  for (const projection of builtInRenderProjections) {
    expect(await projection.project(document)).toBeDefined();
  }
  expect(
    builtInDocumentTransformers.diffToSummary.transform({
      ...document,
      format: "diff",
    }).format,
  ).toBe("diff-summary");
  expect(
    builtInDocumentTransformers.recordsToTable.transform(document).format,
  ).toBe("table");
  const relationships =
    builtInDocumentTransformers.jsonLdToRelationships.transform(
      builtInParser("jsonld").parse(
        '{"@graph":[{"@id":"service","dependsOn":{"@id":"database"}}]}',
        true,
      ),
    );
  expect(relationships.root.children?.[0]?.value).toEqual({
    from: "service",
    relation: "dependsOn",
    to: "database",
  });
  expect(
    builtInDocumentTransformers.structuredToSettings.transform(
      builtInParser("yaml").parse("port: 3000", true),
    ).format,
  ).toBe("settings");
  expect(
    builtInDocumentTransformers.logsToTimeline.transform(
      builtInParser("syslog").parse("<34>Oct 11 22:14:15 host ready", true),
    ).root.children?.[0],
  ).toMatchObject({ type: "event", value: { sequence: 0 } });
  expect(
    builtInDocumentTransformers.headingsToOutline.transform(document),
  ).toBe(document);
  expect(builtInDocumentTransformers.diffToSummary.transform(document)).toBe(
    document,
  );
  expect(builtInRenderProjections.map((projection) => projection.id)).toEqual([
    "raw",
    "syntax",
    "markdown-blocks",
    "tree",
    "key-value",
    "table",
    "virtualized-table",
    "timeline",
    "log-rows",
    "graph",
    "diff",
    "json-path",
  ]);
});

test("backpressure and decoder expose deterministic lifecycle", async () => {
  const pressure = new BoundedBackpressureController(1);
  await pressure.wait();
  const waiting = pressure.wait();
  pressure.release();
  await waiting;
  pressure.release();
  expect(pressure.desiredSize).toBe(1);
  const decoder = new Utf8StreamDecoder();
  expect(decoder.write(new TextEncoder().encode("界")) + decoder.flush()).toBe(
    "界",
  );
  decoder.reset();
  const blocked = new BoundedBackpressureController(1);
  await blocked.wait();
  const controller = new AbortController();
  const aborted = blocked.wait(controller.signal);
  controller.abort(new Error("cancelled"));
  await expect(aborted).rejects.toThrow("cancelled");
  blocked.release(2);
  const pipeline = new StreamingPipeline();
  await pipeline.write('{"ready":true}');
  expect(pipeline.replay()).not.toEqual([]);
  pipeline.reset();
  expect(pipeline.replay()).toEqual([]);
  await expect(
    new StreamingPipeline({ format: "missing" }).write("x"),
  ).rejects.toThrow("not registered");
});

test("incremental parser sessions retain records without reparsing prior chunks", async () => {
  let legacyParses = 0;
  let sessionWrites = 0;
  const pipeline = new StreamingPipeline({
    format: "incremental",
    parsers: [
      {
        id: "incremental",
        mediaTypes: ["text/x-incremental"],
        detect: () => 1,
        parse: () => {
          legacyParses += 1;
          throw new Error("legacy parser should not run");
        },
        createSession() {
          let source = "";
          return {
            write(chunk, complete) {
              sessionWrites += 1;
              source += chunk;
              return {
                format: "incremental",
                source,
                complete,
                root: { type: "text", value: source },
                diagnostics: [],
              };
            },
            reset() {
              source = "";
            },
          };
        },
      },
    ],
  });
  await pipeline.write("one");
  const document = await pipeline.write("-two");
  expect(document.source).toBe("one-two");
  expect(sessionWrites).toBe(2);
  expect(legacyParses).toBe(0);
  expect(
    pipeline.events().filter((event) => event.type === "document"),
  ).toHaveLength(2);
});

test("JSONL sessions recover records split across arbitrary chunks", async () => {
  const pipeline = new StreamingPipeline({ format: "jsonl" });
  await pipeline.write('{"one":');
  await pipeline.write("1}\n");
  const partial = await pipeline.write('{"two":');
  expect(partial.root.children).toHaveLength(1);
  const complete = await pipeline.write("2}\n");
  expect(complete.root.children).toHaveLength(2);
  expect(complete.diagnostics).toEqual([]);
});

test("line sessions preserve absolute source spans across chunks and retained-source trimming", async () => {
  const jsonl = new StreamingPipeline({
    format: "jsonl",
    maxSourceLength: 24,
  });
  await jsonl.write('{"one":1}\n{"tw');
  const jsonlDocument = await jsonl.write('o":2}\n{"three":3}\n');
  expect(
    jsonlDocument.root.children?.map((node) => ({
      raw: node.raw,
      span: node.span,
    })),
  ).toEqual([
    { raw: '{"one":1}', span: { start: 0, end: 9 } },
    { raw: '{"two":2}', span: { start: 10, end: 19 } },
    { raw: '{"three":3}', span: { start: 20, end: 31 } },
  ]);
  expect(jsonlDocument.source).toHaveLength(24);
  expect(jsonlDocument.source).toEndWith('{"three":3}\n');

  const syslog = new StreamingPipeline({
    format: "syslog",
    maxSourceLength: 80,
  });
  const first = "<34>Oct 11 22:14:15 host first";
  const second = "<34>Oct 11 22:14:16 host second";
  await syslog.write(`${first}\n${second.slice(0, 12)}`);
  const syslogDocument = await syslog.write(`${second.slice(12)}\n`);
  expect(
    syslogDocument.root.children?.map((node) => ({
      raw: node.raw,
      span: node.span,
    })),
  ).toEqual([
    { raw: first, span: { start: 0, end: first.length } },
    {
      raw: second,
      span: {
        start: first.length + 1,
        end: first.length + 1 + second.length,
      },
    },
  ]);
});

test("replay retains a bounded sequence of document revisions", async () => {
  const pipeline = new StreamingPipeline({
    format: "jsonl",
    maxEvents: 3,
  });
  await pipeline.write('{"revision":1}\n');
  await pipeline.write('{"revision":2}\n');
  await pipeline.write('{"revision":3}\n');
  await pipeline.write('{"revision":4}\n');
  const replay = pipeline.replay();
  expect(replay).toHaveLength(3);
  expect(replay.map((event) => event.sequence)).toEqual([2, 3, 4]);
  expect(
    replay.map((event) =>
      event.type === "document"
        ? event.document.root.children?.at(-1)?.value
        : undefined,
    ),
  ).toEqual([{ revision: 2 }, { revision: 3 }, { revision: 4 }]);
});

test("line sessions quarantine overflow until the next delimiter", async () => {
  const pipeline = new StreamingPipeline({
    format: "jsonl",
    maxSourceLength: 16,
  });
  const overflow = await pipeline.write(
    `${"x".repeat(64)}{"mustNot":"parse"}\n`,
  );
  expect(overflow.root.children).toEqual([]);
  expect(overflow.diagnostics[0]?.message).toContain("bounded retention");

  await pipeline.write('{"safe":true');
  const recovered = await pipeline.write("}\n");
  expect(recovered.root.children).toEqual([
    expect.objectContaining({ value: { safe: true } }),
  ]);
  expect(
    recovered.root.children?.some(
      (node) =>
        (node.value as { mustNot?: string } | undefined)?.mustNot === "parse",
    ),
  ).toBeFalse();
});

test("every streamable format survives arbitrary chunks with bounded retention", async () => {
  const fixtures = [
    ["markdown", "# Title\n\n| A |\n| - |\n| B |\n"],
    ["xml", '<root><item id="1">value</item></root>'],
    ["yaml", "service:\n  name: api\n  ports:\n    - 3000\n"],
    ["toml", '[service]\nname = "api"\nports = [3000]\n'],
    ["diff", "@@ -1 +1 @@\n-old\n+new\n"],
    ["text", "one\ntwo\n"],
  ] as const;
  for (const [format, source] of fixtures) {
    const pipeline = new StreamingPipeline({
      format,
      maxSourceLength: 256,
    });
    for (let offset = 0; offset < source.length; offset += 3) {
      await pipeline.write(source.slice(offset, offset + 3));
    }
    const result = await pipeline.end();
    expect(result.format).toBe(format);
    expect(result.complete).toBeTrue();
    expect(result.source.length).toBeLessThanOrEqual(256);
  }
  const longRunning = new StreamingPipeline({
    format: "jsonl",
    maxSourceLength: 64,
  });
  for (let index = 0; index < 1_000; index += 1) {
    await longRunning.write(`{"index":${index}}\n`);
  }
  const retained = await longRunning.end();
  expect(retained.source.length).toBeLessThanOrEqual(64);
  expect(retained.root.children?.at(-1)?.value).toEqual({ index: 999 });
});

test("incomplete JSON-family and Markdown streams stay bounded with diagnostics", async () => {
  for (const format of ["json", "jsonld", "otel"] as const) {
    const pipeline = new StreamingPipeline({ format, maxSourceLength: 32 });
    for (let index = 0; index < 100; index += 1)
      await pipeline.write(`{"value":"${index}`);
    const result = await pipeline.end();
    expect(result.source.length).toBeLessThanOrEqual(32);
    expect(result.diagnostics.map((item) => item.message).join(" ")).toContain(
      "bounded retention",
    );
  }
  const markdown = new StreamingPipeline({
    format: "markdown",
    maxSourceLength: 32,
  });
  await markdown.write(`\`\`\`text\n${"x".repeat(2_000)}`);
  const result = await markdown.end();
  expect(result.source.length).toBeLessThanOrEqual(32);
  expect(result.diagnostics.map((item) => item.message).join(" ")).toContain(
    "bounded retention",
  );

  const jsonl = new StreamingPipeline({
    format: "jsonl",
    maxSourceLength: 32,
  });
  await jsonl.write(`{"message":"${"x".repeat(2_000)}"}`);
  const lineResult = await jsonl.end();
  expect(lineResult.source.length).toBeLessThanOrEqual(32);
  expect(
    lineResult.diagnostics.map((item) => item.message).join(" "),
  ).toContain("bounded retention");

  const yaml = new StreamingPipeline({
    format: "yaml",
    maxSourceLength: 32,
  });
  await yaml.write(`value: ${"x".repeat(2_000)}`);
  const yamlResult = await yaml.end();
  expect(yamlResult.complete).toBeFalse();
  expect(yamlResult.source.length).toBeLessThanOrEqual(32);
  expect(
    yamlResult.diagnostics.map((item) => item.message).join(" "),
  ).toContain("bounded retention");
});
