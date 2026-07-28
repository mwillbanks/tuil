export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface ParserDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly span?: SourceSpan;
  readonly recoverable: boolean;
}

export interface DocumentNode {
  readonly type: string;
  readonly value?: unknown;
  readonly raw?: string;
  readonly span?: SourceSpan;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly children?: readonly DocumentNode[];
}

export interface PartialDocument {
  readonly format: string;
  readonly complete: boolean;
  readonly root: DocumentNode;
  readonly diagnostics: readonly ParserDiagnostic[];
  readonly source: string;
}

export type StreamEvent =
  | {
      readonly type: "document";
      readonly document: PartialDocument;
      readonly sequence: number;
    }
  | {
      readonly type: "diagnostic";
      readonly diagnostic: ParserDiagnostic;
      readonly sequence: number;
    }
  | { readonly type: "end"; readonly sequence: number };

export interface StreamDecoder {
  readonly id: string;
  write(chunk: Uint8Array | string): string;
  flush(): string;
  reset(): void;
}

export class Utf8StreamDecoder implements StreamDecoder {
  readonly id = "utf8";
  readonly #decoder = new TextDecoder("utf-8", { fatal: false });

  write(chunk: Uint8Array | string): string {
    return typeof chunk === "string"
      ? chunk
      : this.#decoder.decode(chunk, { stream: true });
  }

  flush(): string {
    return this.#decoder.decode();
  }

  reset(): void {
    // TextDecoder has no reset primitive; flushing establishes a new stream.
    this.#decoder.decode();
  }
}

export interface FormatParser {
  readonly id: string;
  readonly mediaTypes: readonly string[];
  readonly extensions?: readonly string[];
  detect(source: string): number;
  parse(source: string, complete: boolean): PartialDocument;
  createSession?(): FormatParserSession;
}

export interface FormatParserSession {
  write(chunk: string, complete: boolean): PartialDocument;
  reset(): void;
}

export interface DocumentTransformer {
  readonly id: string;
  transform(
    document: PartialDocument,
    context: { readonly signal: AbortSignal },
  ): PartialDocument | Promise<PartialDocument>;
}

export interface RenderProjection<T = unknown> {
  readonly id: string;
  project(
    document: PartialDocument,
    context: { readonly signal: AbortSignal },
  ): T | Promise<T>;
}

export interface StreamRenderer<T = unknown> extends RenderProjection<T> {
  render(projected: T): string | readonly string[];
}

export interface BackpressureController {
  readonly desiredSize: number;
  wait(signal?: AbortSignal): Promise<void>;
  release(count?: number): void;
}

interface BackpressureWaiter {
  readonly admit: () => void;
  readonly abort: () => void;
}

export class BoundedBackpressureController implements BackpressureController {
  readonly #highWaterMark: number;
  readonly #waiters: BackpressureWaiter[] = [];
  #size = 0;

  constructor(highWaterMark = 64) {
    if (!Number.isSafeInteger(highWaterMark) || highWaterMark < 1) {
      throw new Error("Backpressure highWaterMark must be positive");
    }
    this.#highWaterMark = highWaterMark;
  }

  get desiredSize(): number {
    return this.#highWaterMark - this.#size;
  }

  async wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    if (this.#size < this.#highWaterMark) {
      this.#size += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let waiter: BackpressureWaiter;
      const admit = () => {
        signal?.removeEventListener("abort", waiter.abort);
        this.#size += 1;
        resolve();
      };
      const abort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(signal?.reason);
      };
      waiter = { admit, abort };
      this.#waiters.push(waiter);
      signal?.addEventListener("abort", waiter.abort, { once: true });
    });
  }

  release(count = 1): void {
    this.#size = Math.max(0, this.#size - Math.max(1, count));
    while (this.#size < this.#highWaterMark && this.#waiters.length > 0) {
      this.#waiters.shift()?.admit();
    }
  }
}

function diagnostic(
  message: string,
  recoverable = true,
  span?: SourceSpan,
): ParserDiagnostic {
  return Object.freeze({
    severity: recoverable ? "warning" : "error",
    message,
    span,
    recoverable,
  });
}

function document(
  format: string,
  source: string,
  complete: boolean,
  root: DocumentNode,
  diagnostics: readonly ParserDiagnostic[] = [],
): PartialDocument {
  return Object.freeze({
    format,
    complete,
    root: Object.freeze(root),
    diagnostics: Object.freeze([...diagnostics]),
    source,
  });
}

function plainNode(source: string): DocumentNode {
  return {
    type: "text",
    value: source,
    raw: source,
    span: { start: 0, end: source.length },
  };
}

const plainParser: FormatParser = {
  id: "text",
  mediaTypes: ["text/plain"],
  detect: () => 0.01,
  parse: (source, complete) =>
    document("text", source, complete, plainNode(source)),
};

const jsonParser: FormatParser = {
  id: "json",
  mediaTypes: ["application/json"],
  extensions: [".json"],
  detect(source) {
    const trimmed = source.trimStart();
    return trimmed.startsWith("{") || trimmed.startsWith("[") ? 0.9 : 0;
  },
  parse(source, complete) {
    try {
      const value = JSON.parse(source);
      return document("json", source, complete, {
        type: "json",
        value,
        raw: source,
        span: { start: 0, end: source.length },
      });
    } catch (error) {
      return document("json", source, false, plainNode(source), [
        diagnostic(
          error instanceof Error ? error.message : String(error),
          !complete,
        ),
      ]);
    }
  },
};

const jsonLdParser: FormatParser = {
  id: "jsonld",
  mediaTypes: ["application/ld+json"],
  extensions: [".jsonld"],
  detect(source) {
    return /"@(?:context|graph|id|type)"\s*:/.test(source) ? 0.98 : 0;
  },
  parse(source, complete) {
    try {
      const value = JSON.parse(source) as Record<string, unknown>;
      const graph = Array.isArray(value["@graph"]) ? value["@graph"] : [value];
      return document("jsonld", source, complete, {
        type: "graph",
        value,
        raw: source,
        span: { start: 0, end: source.length },
        children: graph.map((item) => ({
          type: "entity",
          value: item,
          attributes:
            item && typeof item === "object"
              ? {
                  id: (item as Record<string, unknown>)["@id"],
                  entityType: (item as Record<string, unknown>)["@type"],
                }
              : undefined,
        })),
      });
    } catch (error) {
      return document("jsonld", source, false, plainNode(source), [
        diagnostic(
          error instanceof Error ? error.message : String(error),
          !complete,
        ),
      ]);
    }
  },
};

const openTelemetryParser: FormatParser = {
  id: "otel",
  mediaTypes: ["application/json;profile=opentelemetry"],
  extensions: [".otel.json"],
  detect(source) {
    return /"(?:resourceLogs|scopeLogs|logRecords|timeUnixNano)"\s*:/.test(
      source,
    )
      ? 0.99
      : 0;
  },
  parse(source, complete) {
    try {
      const value = JSON.parse(source) as Record<string, unknown>;
      const records = openTelemetryNodes(value);
      if (records.length === 0) {
        records.push({ type: "otel-log-record", value });
      }
      return document("otel", source, complete, {
        type: "records",
        raw: source,
        span: { start: 0, end: source.length },
        children: records,
      });
    } catch (error) {
      return document("otel", source, false, plainNode(source), [
        diagnostic(
          error instanceof Error ? error.message : String(error),
          !complete,
        ),
      ]);
    }
  },
};

function openTelemetryNodes(value: Record<string, unknown>): DocumentNode[] {
  const records: DocumentNode[] = [];
  const resources = Array.isArray(value["resourceLogs"])
    ? value["resourceLogs"]
    : [];
  for (const resource of resources) {
    const resourceValue =
      resource && typeof resource === "object"
        ? (resource as Record<string, unknown>)
        : undefined;
    if (!resourceValue) continue;
    records.push(...openTelemetryScopeNodes(resourceValue));
  }
  return records;
}

function openTelemetryScopeNodes(
  resource: Record<string, unknown>,
): DocumentNode[] {
  const records: DocumentNode[] = [];
  const scopes = Array.isArray(resource["scopeLogs"])
    ? resource["scopeLogs"]
    : [];
  for (const scope of scopes) {
    const scopeValue =
      scope && typeof scope === "object"
        ? (scope as Record<string, unknown>)
        : undefined;
    if (!scopeValue) continue;
    for (const logRecord of Array.isArray(scopeValue["logRecords"])
      ? scopeValue["logRecords"]
      : []) {
      records.push({
        type: "otel-log-record",
        value: logRecord,
        attributes: {
          resource: resource["resource"],
          scope: scopeValue["scope"],
        },
      });
    }
  }
  return records;
}

const jsonLinesParser: FormatParser = {
  id: "jsonl",
  mediaTypes: ["application/x-ndjson"],
  extensions: [".jsonl", ".ndjson"],
  detect(source) {
    const lines = source.trim().split("\n");
    if (lines.length < 2) return 0;
    return lines.every((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    })
      ? 0.95
      : 0;
  },
  parse(source, complete) {
    const children: DocumentNode[] = [];
    const diagnostics: ParserDiagnostic[] = [];
    for (const { line, span } of sourceLines(source)) {
      try {
        children.push({
          type: "record",
          value: JSON.parse(line),
          raw: line,
          span,
        });
      } catch (error) {
        diagnostics.push(
          diagnostic(
            `JSONL record: ${error instanceof Error ? error.message : String(error)}`,
            !complete || span.end === source.length,
            span,
          ),
        );
        children.push({
          type: "parse-error",
          raw: line,
          value: line,
          span,
        });
      }
    }
    return document(
      "jsonl",
      source,
      complete,
      { type: "records", children },
      diagnostics,
    );
  },
};

function sourceLines(
  source: string,
): readonly { readonly line: string; readonly span: SourceSpan }[] {
  const lines: { line: string; span: SourceSpan }[] = [];
  let start = 0;
  for (;;) {
    const delimiter = source.indexOf("\n", start);
    const end = delimiter < 0 ? source.length : delimiter;
    if (start < source.length || delimiter >= 0) {
      const raw = source.slice(start, end);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      lines.push({ line, span: { start, end: start + line.length } });
    }
    if (delimiter < 0) return Object.freeze(lines);
    start = delimiter + 1;
  }
}

interface SyntaxTreeNode {
  readonly type: string;
  readonly value?: unknown;
  readonly url?: string;
  readonly lang?: string;
  readonly depth?: number;
  readonly checked?: boolean | null;
  readonly children?: readonly SyntaxTreeNode[];
  readonly position?: {
    readonly start?: { readonly offset?: number };
    readonly end?: { readonly offset?: number };
  };
}

function syntaxDocumentNode(node: SyntaxTreeNode): DocumentNode {
  const attributes = Object.fromEntries(
    Object.entries({
      url: node.url,
      language: node.lang,
      depth: node.depth,
      checked: node.checked,
    }).filter((entry) => entry[1] !== undefined),
  );
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return {
    type: node.type,
    value: node.value,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    span: start !== undefined && end !== undefined ? { start, end } : undefined,
    children: node.children?.map(syntaxDocumentNode),
  };
}

const markdownParser: FormatParser = {
  id: "markdown",
  mediaTypes: ["text/markdown"],
  extensions: [".md", ".mdx"],
  detect(source) {
    return /^(#{1,6} |```|[-*] |\d+\. )/m.test(source) ? 0.8 : 0.1;
  },
  parse(source, complete) {
    const tree = fromMarkdown(source, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as SyntaxTreeNode;
    const fence = (source.match(/^```/gm)?.length ?? 0) % 2 !== 0;
    return document(
      "markdown",
      source,
      complete && !fence,
      { ...syntaxDocumentNode(tree), type: "markdown" },
      fence ? [diagnostic("Incomplete fenced code block")] : [],
    );
  },
};

const xmlParser: FormatParser = {
  id: "xml",
  mediaTypes: ["application/xml", "text/xml"],
  extensions: [".xml"],
  detect: (source) => (/^\s*<[\w:?-]+/.test(source) ? 0.85 : 0),
  parse(source, complete) {
    const diagnostics: ParserDiagnostic[] = [];
    const validation = XMLValidator.validate(source);
    if (validation !== true) {
      diagnostics.push(
        diagnostic(
          validation.err.msg,
          !complete || /unclosed|unexpected end/i.test(validation.err.msg),
        ),
      );
    }
    let value: unknown = source;
    try {
      value = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        processEntities: true,
      }).parse(source);
    } catch {
      // The recoverable diagnostic above retains incomplete source.
    }
    return document(
      "xml",
      source,
      complete && validation === true,
      {
        type: "xml",
        raw: source,
        value,
        children: xmlDocumentNodes(value),
      },
      diagnostics,
    );
  },
};

function xmlDocumentNodes(value: unknown): readonly DocumentNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: DocumentNode[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    for (const [name, content] of Object.entries(entry)) {
      if (name === ":@") continue;
      nodes.push({
        type: "element",
        attributes: { name, ...xmlAttributes(entry) },
        children: xmlDocumentNodes(content),
        value: xmlTextValue(content),
      });
    }
  }
  return Object.freeze(nodes);
}

function xmlAttributes(value: object): Readonly<Record<string, unknown>> {
  const attributes = (value as Record<string, unknown>)[":@"];
  return attributes && typeof attributes === "object"
    ? (attributes as Readonly<Record<string, unknown>>)
    : {};
}

function xmlTextValue(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 1) return undefined;
  const item = value[0];
  return item && typeof item === "object"
    ? (item as Readonly<Record<string, unknown>>)["#text"]
    : undefined;
}

function structuredNode(value: unknown, type = "value"): DocumentNode {
  if (Array.isArray(value)) {
    return {
      type: "array",
      children: value.map((entry) => structuredNode(entry, "item")),
    };
  }
  if (value && typeof value === "object") {
    return {
      type: "object",
      children: Object.entries(value).map(([key, entry]) => ({
        ...structuredNode(entry, "property"),
        attributes: { key },
      })),
    };
  }
  return { type, value };
}

function structuredParser(
  id: "toml" | "yaml",
  parse: (source: string) => unknown,
  separator: RegExp,
): FormatParser {
  return {
    id,
    mediaTypes: [`application/${id}`],
    extensions: [
      `.${id === "yaml" ? "yaml" : id}`,
      ...(id === "yaml" ? [".yml"] : []),
    ],
    detect: (source) => (separator.test(source) ? 0.65 : 0),
    parse(source, complete) {
      try {
        return document(id, source, complete, structuredNode(parse(source)));
      } catch (error) {
        return document(id, source, false, plainNode(source), [
          diagnostic(
            `${id.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
            !complete,
          ),
        ]);
      }
    },
  };
}

const tomlParser = structuredParser(
  "toml",
  parseToml,
  /^([\w.-]+)\s*=\s*(.+)$/m,
);
const yamlParser = structuredParser(
  "yaml",
  parseYaml,
  /^\s*([\w.-]+)\s*:\s*(.*)$/m,
);

const diffParser: FormatParser = {
  id: "diff",
  mediaTypes: ["text/x-diff"],
  extensions: [".diff", ".patch"],
  detect: (source) =>
    /^(diff --git|--- |\+\+\+ |@@ )/m.test(source) ? 0.95 : 0,
  parse(source, complete) {
    const children = source.split("\n").map((line, index) => ({
      type: line.startsWith("@@")
        ? "hunk"
        : line.startsWith("+")
          ? "addition"
          : line.startsWith("-")
            ? "deletion"
            : "context",
      raw: line,
      value: line,
      attributes: { line: index + 1 },
    }));
    return document("diff", source, complete, { type: "diff", children });
  },
};

const syslog5424 = /^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/;
const syslog3164 =
  /^<(\d{1,3})>([A-Z][a-z]{2}\s+\d+\s+\d\d:\d\d:\d\d) (\S+) (.+)$/;
const syslogParser: FormatParser = {
  id: "syslog",
  mediaTypes: ["application/syslog"],
  extensions: [".log"],
  detect: (source) => (/^<\d{1,3}>/.test(source) ? 0.9 : 0),
  parse(source, complete) {
    const children: DocumentNode[] = [];
    const diagnostics: ParserDiagnostic[] = [];
    for (const { line, span } of sourceLines(source)) {
      const modern = syslog5424.exec(line);
      const legacy = syslog3164.exec(line);
      if (modern) {
        const tail = splitSyslogTail(modern[7] ?? "");
        const priority = Number(modern[1]);
        children.push({
          type: "rfc5424",
          raw: line,
          span,
          value: {
            priority,
            facility: priority >> 3,
            severity: priority & 7,
            timestamp: modern[2],
            host: modern[3],
            app: modern[4],
            process: modern[5],
            messageId: modern[6],
            structuredData: tail.structuredData,
            message: tail.message,
          },
        });
      } else if (legacy) {
        children.push({
          type: "rfc3164",
          raw: line,
          span,
          value: {
            priority: Number(legacy[1]),
            timestamp: legacy[2],
            host: legacy[3],
            message: legacy[4],
          },
        });
      } else {
        diagnostics.push(
          diagnostic(`Malformed syslog record: ${line}`, true, span),
        );
        children.push({ type: "parse-error", raw: line, value: line, span });
      }
    }
    return document(
      "syslog",
      source,
      complete,
      { type: "records", children },
      diagnostics,
    );
  },
};

function splitSyslogTail(source: string): {
  readonly structuredData: string;
  readonly message: string;
} {
  if (source.startsWith("-"))
    return {
      structuredData: "-",
      message: source.startsWith("- ") ? source.slice(2) : "",
    };
  const boundary = syslogStructuredDataBoundary(source);
  if (boundary < 0) return { structuredData: source, message: "" };
  return {
    structuredData: source.slice(0, boundary + 1),
    message: source[boundary + 1] === " " ? source.slice(boundary + 2) : "",
  };
}

function syslogStructuredDataBoundary(source: string): number {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character !== "]" || quoted) continue;
    if (source[index + 1] !== "[") return index;
  }
  return -1;
}

export const builtInFormatParsers = Object.freeze([
  jsonLinesParser,
  openTelemetryParser,
  jsonLdParser,
  jsonParser,
  markdownParser,
  xmlParser,
  tomlParser,
  yamlParser,
  diffParser,
  syslogParser,
  plainParser,
]);

function documentRows(value: PartialDocument): readonly DocumentNode[] {
  return value.root.children ?? [value.root];
}

export const builtInRenderProjections = Object.freeze([
  {
    id: "raw",
    project: (value: PartialDocument) => value.source,
  },
  {
    id: "syntax",
    project: (value: PartialDocument) =>
      documentRows(value).map((node) => node.raw ?? String(node.value ?? "")),
  },
  {
    id: "markdown-blocks",
    project: (value: PartialDocument) => documentRows(value),
  },
  {
    id: "tree",
    project: (value: PartialDocument) => value.root,
  },
  {
    id: "key-value",
    project: (value: PartialDocument) =>
      documentRows(value).map((node) => node.value),
  },
  {
    id: "table",
    project: (value: PartialDocument) =>
      documentRows(value).map((node, index) => ({
        index,
        type: node.type,
        value: node.value,
      })),
  },
  {
    id: "virtualized-table",
    project: (value: PartialDocument) => ({
      count: documentRows(value).length,
      rows: documentRows(value),
    }),
  },
  {
    id: "timeline",
    project: (value: PartialDocument) =>
      documentRows(value).map((node, index) => ({
        sequence: index,
        timestamp: (node.value as Record<string, unknown> | undefined)?.[
          "timestamp"
        ],
        value: node.value,
      })),
  },
  {
    id: "log-rows",
    project: (value: PartialDocument) => documentRows(value),
  },
  {
    id: "graph",
    project: (value: PartialDocument) =>
      documentRows(value).map((node) => ({
        id: node.attributes?.["id"],
        type: node.attributes?.["entityType"],
        value: node.value,
      })),
  },
  {
    id: "diff",
    project: (value: PartialDocument) => documentRows(value),
  },
  {
    id: "json-path",
    project: (value: PartialDocument) => {
      const paths: { path: string; value: unknown }[] = [];
      const visit = (item: unknown, path: string) => {
        if (Array.isArray(item)) {
          for (const [index, child] of item.entries()) {
            visit(child, `${path}[${index}]`);
          }
        } else if (item && typeof item === "object") {
          for (const [key, child] of Object.entries(item)) {
            visit(child, `${path}.${key}`);
          }
        } else {
          paths.push({ path, value: item });
        }
      };
      visit(value.root.value, "$");
      return paths;
    },
  },
] satisfies readonly RenderProjection[]);

export const builtInDocumentTransformers = Object.freeze({
  headingsToOutline: {
    id: "markdown-headings-to-outline",
    transform(value: PartialDocument) {
      if (value.format !== "markdown") return value;
      return document(
        "outline",
        value.source,
        value.complete,
        {
          type: "outline",
          children: documentRows(value).filter(
            (node) => node.type === "heading",
          ),
        },
        value.diagnostics,
      );
    },
  },
  diffToSummary: {
    id: "diff-to-summary",
    transform(value: PartialDocument) {
      if (value.format !== "diff") return value;
      const items = documentRows(value);
      return document(
        "diff-summary",
        value.source,
        value.complete,
        {
          type: "summary",
          value: {
            additions: items.filter((node) => node.type === "addition").length,
            deletions: items.filter((node) => node.type === "deletion").length,
            hunks: items.filter((node) => node.type === "hunk").length,
          },
        },
        value.diagnostics,
      );
    },
  },
  recordsToTable: {
    id: "records-to-table",
    transform(value: PartialDocument) {
      return document(
        "table",
        value.source,
        value.complete,
        {
          type: "table",
          children: documentRows(value).map((node, index) => ({
            type: "row",
            value: { index, value: node.value },
          })),
        },
        value.diagnostics,
      );
    },
  },
  jsonLdToRelationships: {
    id: "jsonld-to-relationships",
    transform(value: PartialDocument) {
      if (value.format !== "jsonld") return value;
      const entities = documentRows(value);
      return document(
        "graph",
        value.source,
        value.complete,
        {
          type: "graph",
          children: entities.flatMap((node) => {
            const record =
              node.value && typeof node.value === "object"
                ? (node.value as Record<string, unknown>)
                : {};
            return Object.entries(record).flatMap(([relation, target]) =>
              typeof target === "object"
                ? [
                    {
                      type: "relationship",
                      value: {
                        from: record["@id"],
                        relation,
                        to:
                          (target as Record<string, unknown>)["@id"] ?? target,
                      },
                    },
                  ]
                : [],
            );
          }),
        },
        value.diagnostics,
      );
    },
  },
  structuredToSettings: {
    id: "structured-to-settings",
    transform(value: PartialDocument) {
      if (!["toml", "yaml", "xml"].includes(value.format)) return value;
      return document(
        "settings",
        value.source,
        value.complete,
        { type: "settings", children: documentRows(value) },
        value.diagnostics,
      );
    },
  },
  logsToTimeline: {
    id: "logs-to-timeline",
    transform(value: PartialDocument) {
      if (!["syslog", "otel", "jsonl"].includes(value.format)) return value;
      return document(
        "timeline",
        value.source,
        value.complete,
        {
          type: "timeline",
          children: documentRows(value).map((node, sequence) => ({
            type: "event",
            value: { sequence, ...(node.value as object) },
            raw: node.raw,
            span: node.span,
          })),
        },
        value.diagnostics,
      );
    },
  },
} satisfies Readonly<Record<string, DocumentTransformer>>);

abstract class RetainedFormatSession implements FormatParserSession {
  protected source = "";
  protected readonly parser: FormatParser;
  readonly #maxSourceLength: number;

  constructor(parser: FormatParser, maxSourceLength: number) {
    this.parser = parser;
    this.#maxSourceLength = maxSourceLength;
  }

  protected append(chunk: string): string {
    this.source = `${this.source}${chunk}`.slice(-this.#maxSourceLength);
    return this.source;
  }

  protected retainedNodeLimit(): number {
    return Math.max(128, Math.floor(this.#maxSourceLength / 64));
  }

  protected sourceLimit(): number {
    return this.#maxSourceLength;
  }

  protected retainTail(value: string): {
    readonly value: string;
    readonly overflow: boolean;
  } {
    return Object.freeze({
      value: value.slice(-this.#maxSourceLength),
      overflow: value.length > this.#maxSourceLength,
    });
  }

  protected appendPending(
    current: string,
    chunk: string,
  ): { readonly value: string; readonly overflow: boolean } {
    this.append(chunk);
    return this.retainTail(current + chunk);
  }

  protected resetSource(): void {
    this.source = "";
  }

  abstract write(chunk: string, complete: boolean): PartialDocument;
  abstract reset(): void;
}

class LineFormatSession extends RetainedFormatSession {
  #pending = "";
  #children: DocumentNode[] = [];
  #diagnostics: ParserDiagnostic[] = [];
  #overflow = false;
  #quarantined = false;
  #streamOffset = 0;
  #pendingOffset = 0;

  write(chunk: string, complete: boolean): PartialDocument {
    this.append(chunk);
    this.#consume(chunk, complete);
    this.#streamOffset += chunk.length;
    this.#trimRetainedState();
    if (
      this.#overflow &&
      !this.#diagnostics.some((item) =>
        item.message.includes("bounded retention"),
      )
    ) {
      this.#diagnostics.push(
        diagnostic("Line input exceeded bounded retention"),
      );
    }
    return document(
      this.parser.id,
      this.source,
      complete,
      {
        type: this.parser.id === "syslog" ? "logs" : "records",
        children: Object.freeze([...this.#children]),
      },
      this.#diagnostics,
    );
  }

  #consume(chunk: string, complete: boolean): void {
    let offset = 0;
    for (;;) {
      const delimiter = chunk.indexOf("\n", offset);
      if (delimiter < 0) break;
      this.#consumeSegment(
        chunk.slice(offset, delimiter),
        true,
        this.#streamOffset + offset,
      );
      offset = delimiter + 1;
    }
    this.#consumeSegment(
      chunk.slice(offset),
      complete,
      this.#streamOffset + offset,
    );
  }

  #consumeSegment(
    segment: string,
    terminated: boolean,
    segmentOffset: number,
  ): void {
    if (this.#quarantined) {
      if (terminated) this.#quarantined = false;
      return;
    }
    const lineOffset = this.#pending ? this.#pendingOffset : segmentOffset;
    const line = `${this.#pending}${segment}`;
    if (line.length > this.sourceLimit()) {
      this.#pending = "";
      this.#overflow = true;
      this.#quarantined = !terminated;
      return;
    }
    if (!terminated) {
      if (!this.#pending) this.#pendingOffset = segmentOffset;
      this.#pending = line;
      return;
    }
    this.#pending = "";
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    this.#parseLine(normalized, lineOffset);
  }

  #parseLine(line: string, offset: number): void {
    if (!line) return;
    const parsed = this.parser.parse(line, true);
    this.#children.push(
      ...(parsed.root.children ?? [parsed.root]).map((node) =>
        offsetDocumentNode(node, offset),
      ),
    );
    this.#diagnostics.push(
      ...parsed.diagnostics.map((item) => offsetDiagnostic(item, offset)),
    );
  }

  #trimRetainedState(): void {
    const excessNodes = this.#children.length - this.retainedNodeLimit();
    if (excessNodes > 0) this.#children.splice(0, excessNodes);
    const excessDiagnostics = this.#diagnostics.length - 256;
    if (excessDiagnostics > 0) this.#diagnostics.splice(0, excessDiagnostics);
  }

  reset(): void {
    this.resetSource();
    this.#pending = "";
    this.#children = [];
    this.#diagnostics = [];
    this.#overflow = false;
    this.#quarantined = false;
    this.#streamOffset = 0;
    this.#pendingOffset = 0;
  }
}

function offsetSpan(span: SourceSpan | undefined, offset: number) {
  return span
    ? Object.freeze({ start: span.start + offset, end: span.end + offset })
    : undefined;
}

function offsetDocumentNode(node: DocumentNode, offset: number): DocumentNode {
  return Object.freeze({
    ...node,
    span: offsetSpan(node.span, offset),
    children: node.children?.map((child) => offsetDocumentNode(child, offset)),
  });
}

function offsetDiagnostic(
  item: ParserDiagnostic,
  offset: number,
): ParserDiagnostic {
  return Object.freeze({ ...item, span: offsetSpan(item.span, offset) });
}

class JsonFormatSession extends RetainedFormatSession {
  #last?: PartialDocument;
  #state: JsonStructureState = jsonStructureState();
  #overflow = false;
  #seen = false;

  write(chunk: string, complete: boolean): PartialDocument {
    this.#overflow ||= this.source.length + chunk.length > this.sourceLimit();
    this.append(chunk);
    scanJsonChunk(this.#state, chunk);
    this.#seen ||= Boolean(chunk.trim());
    if (complete || jsonStructureComplete(this.#state, this.#seen))
      return this.#completeDocument(complete);
    return this.#partialDocument();
  }

  #partialDocument(): PartialDocument {
    return document(
      this.parser.id,
      this.source,
      false,
      this.#last?.root ?? plainNode(this.source),
      this.#overflow
        ? [diagnostic("JSON input exceeded bounded retention")]
        : [],
    );
  }

  #completeDocument(complete: boolean): PartialDocument {
    this.#last = this.#overflow
      ? document(
          this.parser.id,
          this.source,
          complete,
          plainNode(this.source),
          [diagnostic("JSON input exceeded bounded retention")],
        )
      : this.parser.parse(this.source, complete);
    if (this.#last.complete) this.#resetInput();
    return this.#last;
  }

  reset(): void {
    this.#last = undefined;
    this.#resetInput();
  }

  #resetInput(): void {
    this.resetSource();
    this.#state = jsonStructureState();
    this.#overflow = false;
    this.#seen = false;
  }
}

class MarkdownFormatSession extends RetainedFormatSession {
  #pending = "";
  #children: DocumentNode[] = [];
  #overflow = false;

  write(chunk: string, complete: boolean): PartialDocument {
    const retained = this.appendPending(this.#pending, chunk);
    this.#pending = retained.value;
    this.#overflow ||= retained.overflow;
    const { blocks, fence, consumed } = markdownBlocks(this.#pending, complete);
    this.#pending = this.#pending.slice(consumed);
    if (blocks.length > 0) {
      const parsed = this.parser.parse(blocks.join(""), true);
      this.#children.push(...(parsed.root.children ?? []));
    }
    const maximumNodes = this.retainedNodeLimit();
    this.#children = this.#children.slice(-maximumNodes);
    return document(
      "markdown",
      this.source,
      complete && !fence,
      { type: "markdown", children: Object.freeze([...this.#children]) },
      [
        ...(fence ? [diagnostic("Incomplete fenced code block")] : []),
        ...(this.#overflow
          ? [diagnostic("Markdown block exceeded bounded retention")]
          : []),
      ],
    );
  }

  reset(): void {
    this.resetSource();
    this.#pending = "";
    this.#children = [];
    this.#overflow = false;
  }
}

function markdownBlocks(
  source: string,
  complete: boolean,
): {
  readonly blocks: readonly string[];
  readonly fence: boolean;
  readonly consumed: number;
} {
  const blocks: string[] = [];
  let fence = false;
  let blockStart = 0;
  let scanned = 0;
  for (const line of source.split(/(?<=\n)/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    scanned += line.length;
    if (fence || !/^\s*$/.test(line)) continue;
    blocks.push(source.slice(blockStart, scanned));
    blockStart = scanned;
  }
  if (complete && blockStart < source.length) {
    blocks.push(source.slice(blockStart));
    blockStart = source.length;
  }
  return { blocks, fence, consumed: blockStart };
}

class CompletionFormatSession extends RetainedFormatSession {
  #last?: PartialDocument;
  #overflow = false;

  write(chunk: string, complete: boolean): PartialDocument {
    this.#overflow ||= this.source.length + chunk.length > this.sourceLimit();
    this.append(chunk);
    if (complete) {
      this.#last = this.#overflow
        ? document(this.parser.id, this.source, false, plainNode(this.source), [
            diagnostic("Document input exceeded bounded retention"),
          ])
        : this.parser.parse(this.source, true);
    }
    return (
      this.#last ??
      document(this.parser.id, this.source, false, plainNode(this.source))
    );
  }

  reset(): void {
    this.resetSource();
    this.#last = undefined;
    this.#overflow = false;
  }
}

interface JsonStructureState {
  depth: number;
  string: boolean;
  escaped: boolean;
}

function jsonStructureState(): JsonStructureState {
  return { depth: 0, string: false, escaped: false };
}

function scanJsonChunk(state: JsonStructureState, chunk: string): void {
  for (const character of chunk) scanJsonCharacter(state, character);
}

function jsonStructureComplete(
  state: JsonStructureState,
  seen: boolean,
): boolean {
  return seen && !state.string && state.depth <= 0;
}

function scanJsonCharacter(state: JsonStructureState, character: string): void {
  if (state.string) {
    if (state.escaped) state.escaped = false;
    else if (character === "\\") state.escaped = true;
    else if (character === '"') state.string = false;
    return;
  }
  if (character === '"') state.string = true;
  else if ("{[".includes(character)) state.depth += 1;
  else if ("}]".includes(character)) state.depth -= 1;
}

function createParserSession(
  parser: FormatParser,
  maxSourceLength: number,
): FormatParserSession | undefined {
  if (parser.createSession) return parser.createSession();
  if (parser.id === "markdown") {
    return new MarkdownFormatSession(parser, maxSourceLength);
  }
  if (["xml", "yaml", "toml"].includes(parser.id)) {
    return new CompletionFormatSession(parser, maxSourceLength);
  }
  if (["jsonl", "syslog", "diff", "text"].includes(parser.id)) {
    return new LineFormatSession(parser, maxSourceLength);
  }
  if (parser.id === "json" || parser.id === "jsonld" || parser.id === "otel") {
    return new JsonFormatSession(parser, maxSourceLength);
  }
  return undefined;
}

function registerPipelineParsers(
  pipeline: StreamingPipeline,
  parsers: readonly FormatParser[],
): void {
  for (const parser of parsers) pipeline.registerParser(parser);
}

function registerPipelineProjections(
  target: Map<string, RenderProjection>,
  projections: readonly RenderProjection[],
): void {
  for (const projection of projections) target.set(projection.id, projection);
}

function streamOption<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function positiveIntegerOption(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

export class StreamingPipeline {
  readonly #decoder: StreamDecoder;
  readonly #parsers = new Map<string, FormatParser>();
  readonly #transformers: DocumentTransformer[] = [];
  readonly #projections = new Map<string, RenderProjection>();
  readonly #backpressure: BackpressureController;
  readonly #events: StreamEvent[] = [];
  readonly #maxSourceLength: number;
  readonly #maxEvents: number;
  readonly #configuredFormat?: string;
  #detectionSource = "";
  #legacySource = "";
  #session?: FormatParserSession;
  #sequence = 0;
  #format?: string;

  constructor(
    options: {
      readonly decoder?: StreamDecoder;
      readonly parsers?: readonly FormatParser[];
      readonly transformers?: readonly DocumentTransformer[];
      readonly projections?: readonly RenderProjection[];
      readonly backpressure?: BackpressureController;
      readonly maxSourceLength?: number;
      readonly maxEvents?: number;
      readonly format?: string;
    } = {},
  ) {
    this.#decoder = streamOption(options.decoder, new Utf8StreamDecoder());
    registerPipelineParsers(
      this,
      streamOption(options.parsers, builtInFormatParsers),
    );
    this.#transformers.push(...streamOption(options.transformers, []));
    registerPipelineProjections(
      this.#projections,
      streamOption(options.projections, builtInRenderProjections),
    );
    this.#backpressure = streamOption(
      options.backpressure,
      new BoundedBackpressureController(),
    );
    this.#maxSourceLength = positiveIntegerOption(
      "maxSourceLength",
      streamOption(options.maxSourceLength, 4 * 1024 * 1024),
    );
    this.#maxEvents = positiveIntegerOption(
      "maxEvents",
      streamOption(options.maxEvents, 256),
    );
    this.#configuredFormat = options.format;
    this.#format = options.format;
    const configuredParser = options.format
      ? this.#parsers.get(options.format)
      : undefined;
    if (configuredParser) {
      this.#session = createParserSession(
        configuredParser,
        this.#maxSourceLength,
      );
    }
  }

  registerParser(parser: FormatParser): () => void {
    if (this.#parsers.has(parser.id))
      throw new Error(`Format parser "${parser.id}" is already registered`);
    this.#parsers.set(parser.id, parser);
    return () => this.#parsers.delete(parser.id);
  }

  async write(
    chunk: Uint8Array | string,
    signal?: AbortSignal,
  ): Promise<PartialDocument> {
    if (signal?.aborted) throw signal.reason;
    await this.#backpressure.wait(signal);
    try {
      const decoded = this.#decoder.write(chunk);
      if (!this.#format) {
        this.#detectionSource = `${this.#detectionSource}${decoded}`.slice(
          -65_536,
        );
      }
      return await this.#parse(decoded, false, signal);
    } finally {
      this.#backpressure.release();
    }
  }

  async end(signal?: AbortSignal): Promise<PartialDocument> {
    const decoded = this.#decoder.flush();
    if (!this.#format) this.#detectionSource += decoded;
    const result = await this.#parse(decoded, true, signal);
    this.#events.push(
      Object.freeze({ type: "end", sequence: ++this.#sequence }),
    );
    this.#trimEvents();
    return result;
  }

  async project<T>(
    id: string,
    document: PartialDocument,
    signal?: AbortSignal,
  ): Promise<T> {
    const projection = this.#projections.get(id);
    if (!projection)
      throw new Error(`Render projection "${id}" is not registered`);
    return (await projection.project(document, {
      signal: signal ?? new AbortController().signal,
    })) as T;
  }

  events(): readonly StreamEvent[] {
    return Object.freeze([...this.#events]);
  }

  replay(): readonly StreamEvent[] {
    return this.events();
  }

  reset(): void {
    this.#detectionSource = "";
    this.#legacySource = "";
    this.#sequence = 0;
    this.#events.length = 0;
    this.#format = this.#configuredFormat;
    this.#session?.reset();
    const configuredParser = this.#configuredFormat
      ? this.#parsers.get(this.#configuredFormat)
      : undefined;
    this.#session = configuredParser
      ? createParserSession(configuredParser, this.#maxSourceLength)
      : undefined;
    this.#decoder.reset();
  }

  #parser(): FormatParser {
    if (this.#format) {
      const selected = this.#parsers.get(this.#format);
      if (!selected)
        throw new Error(`Format parser "${this.#format}" is not registered`);
      return selected;
    }
    const selected = [...this.#parsers.values()]
      .map((parser) => ({
        parser,
        confidence: parser.detect(this.#detectionSource),
      }))
      .sort((left, right) => right.confidence - left.confidence)[0];
    if (selected && selected.confidence >= 0.5) {
      this.#format = selected.parser.id;
      this.#session = createParserSession(
        selected.parser,
        this.#maxSourceLength,
      );
    }
    return selected?.parser ?? plainParser;
  }

  async #parse(
    chunk: string,
    complete: boolean,
    signal?: AbortSignal,
  ): Promise<PartialDocument> {
    const formatBeforeDetection = this.#format;
    const parser = this.#parser();
    this.#session ??= createParserSession(parser, this.#maxSourceLength);
    let result = this.#parseChunk(
      parser,
      chunk,
      complete,
      formatBeforeDetection,
    );
    const context = {
      signal: streamOption(signal, new AbortController().signal),
    };
    for (const transformer of this.#transformers) {
      if (context.signal.aborted) throw context.signal.reason;
      result = await transformer.transform(result, context);
    }
    this.#recordDocument(result);
    return result;
  }

  #parseChunk(
    parser: FormatParser,
    chunk: string,
    complete: boolean,
    formatBeforeDetection: string | undefined,
  ): PartialDocument {
    if (this.#session) {
      const sessionChunk =
        !formatBeforeDetection && this.#format
          ? `${this.#legacySource}${chunk}`
          : chunk;
      this.#legacySource = "";
      return this.#session.write(sessionChunk, complete);
    }
    this.#legacySource += chunk;
    if (this.#legacySource.length > this.#maxSourceLength) {
      this.#legacySource = this.#legacySource.slice(-this.#maxSourceLength);
    }
    return parser.parse(this.#legacySource, complete);
  }

  #recordDocument(result: PartialDocument): void {
    const event = Object.freeze({
      type: "document" as const,
      document: result,
      sequence: ++this.#sequence,
    });
    this.#events.push(event);
    for (const item of result.diagnostics) {
      this.#events.push(
        Object.freeze({
          type: "diagnostic",
          diagnostic: item,
          sequence: ++this.#sequence,
        }),
      );
    }
    this.#trimEvents();
  }

  #trimEvents(): void {
    if (this.#events.length > this.#maxEvents) {
      this.#events.splice(0, this.#events.length - this.#maxEvents);
    }
  }
}

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
