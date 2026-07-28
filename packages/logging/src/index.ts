import { isSafeRegularExpressionSource } from "@mwillbanks/tuil-core";

export type LogSource =
  | "otel"
  | "syslog"
  | "jsonl"
  | "journald"
  | "docker"
  | "kubernetes"
  | "process"
  | "text";

export interface LogDiagnostic {
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly raw?: string;
}

export interface LogRecord {
  readonly timestamp?: bigint;
  readonly observedTimestamp?: bigint;
  readonly severityNumber?: number;
  readonly severityText?: string;
  readonly body: unknown;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly resource: Readonly<Record<string, unknown>>;
  readonly scope?: {
    readonly name?: string;
    readonly version?: string;
  };
  readonly traceId?: string;
  readonly spanId?: string;
  readonly flags?: number;
  readonly eventName?: string;
  readonly source: LogSource;
  readonly original: unknown;
  readonly diagnostics: readonly LogDiagnostic[];
  readonly duplicateCount?: number;
  readonly rateLimited?: boolean;
  readonly sampled?: boolean;
}

export interface LogParser {
  readonly id: string;
  detect(input: string): number;
  parse(input: string): readonly LogRecord[];
}

export interface LogBufferStatistics {
  readonly size: number;
  readonly dropped: number;
  readonly sampled: number;
  readonly rateLimited: number;
  readonly paused: boolean;
  readonly following: boolean;
}

const severityNumbers = Object.freeze({
  trace: 1,
  debug: 5,
  info: 9,
  notice: 10,
  warn: 13,
  warning: 13,
  error: 17,
  fatal: 21,
});

export function normalizeSeverity(value: unknown): {
  readonly number?: number;
  readonly text?: string;
} {
  if (typeof value === "number") {
    return { number: Math.max(1, Math.min(24, Math.floor(value))) };
  }
  if (typeof value !== "string") return {};
  const text = value.toLowerCase();
  const numeric = Number(value);
  return {
    number:
      severityNumbers[text as keyof typeof severityNumbers] ??
      (Number.isFinite(numeric)
        ? Math.max(1, Math.min(24, Math.floor(numeric)))
        : undefined),
    text: value.toUpperCase(),
  };
}

function timestamp(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return BigInt(value);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return BigInt(parsed) * 1_000_000n;
  }
  return undefined;
}

function record(
  input: Partial<LogRecord> & Pick<LogRecord, "body" | "source" | "original">,
): LogRecord {
  return Object.freeze({
    ...input,
    attributes: Object.freeze({ ...(input.attributes ?? {}) }),
    resource: Object.freeze({ ...(input.resource ?? {}) }),
    scope: input.scope ? Object.freeze({ ...input.scope }) : undefined,
    diagnostics: Object.freeze([...(input.diagnostics ?? [])]),
  });
}

function malformed(source: LogSource, raw: string, message: string): LogRecord {
  return record({
    source,
    body: raw,
    original: raw,
    diagnostics: [{ severity: "error", message, raw }],
  });
}

function otelAnyValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const item = value as Record<string, unknown>;
  const scalar = firstDefined(item, [
    "stringValue",
    "boolValue",
    "intValue",
    "doubleValue",
    "bytesValue",
  ]);
  if (scalar !== undefined) return scalar;
  const array = objectValue(item["arrayValue"]);
  if (array) {
    const values = array["values"];
    return Array.isArray(values) ? values.map(otelAnyValue) : [];
  }
  const keyValues = objectValue(item["kvlistValue"]);
  if (keyValues) return otelAttributes(keyValues["values"]);
  return value;
}

function otelAttributes(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) {
    return value && typeof value === "object"
      ? { ...(value as Record<string, unknown>) }
      : {};
  }
  return Object.fromEntries(
    value
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
      .map((item) => [String(item["key"] ?? ""), otelAnyValue(item["value"])]),
  );
}

function openTelemetryRecord(
  value: Record<string, unknown>,
  resource: Record<string, unknown> = {},
  scope?: LogRecord["scope"],
  original: unknown = value,
): LogRecord {
  const severity = normalizeSeverity(
    value["severityNumber"] ?? value["severityText"],
  );
  return record({
    source: "otel",
    timestamp: timestamp(value["timeUnixNano"]),
    observedTimestamp: timestamp(value["observedTimeUnixNano"]),
    severityNumber: severity.number,
    severityText:
      typeof value["severityText"] === "string"
        ? value["severityText"]
        : severity.text,
    body: otelAnyValue(value["body"]),
    attributes: otelAttributes(value["attributes"]),
    resource,
    scope,
    traceId: String(value["traceId"] ?? "") || undefined,
    spanId: String(value["spanId"] ?? "") || undefined,
    flags: typeof value["flags"] === "number" ? value["flags"] : undefined,
    eventName:
      typeof value["eventName"] === "string" ? value["eventName"] : undefined,
    original,
  });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function openTelemetryResource(
  resourceLog: Record<string, unknown>,
): Record<string, unknown> {
  const resource = objectValue(resourceLog["resource"]);
  return resource ? otelAttributes(resource["attributes"]) : {};
}

function openTelemetryScope(value: unknown): LogRecord["scope"] {
  const scope = objectValue(value);
  if (!scope) return undefined;
  return {
    name: typeof scope["name"] === "string" ? scope["name"] : undefined,
    version:
      typeof scope["version"] === "string" ? scope["version"] : undefined,
  };
}

function openTelemetryEnvelopeRecords(
  envelope: Record<string, unknown>,
): readonly LogRecord[] {
  const resourceLogs = arrayValue(envelope["resourceLogs"]);
  if (resourceLogs.length === 0) return [openTelemetryRecord(envelope)];
  const records: LogRecord[] = [];
  for (const resourceValue of resourceLogs) {
    const resourceLog = objectValue(resourceValue);
    if (!resourceLog) continue;
    records.push(...openTelemetryResourceRecords(resourceLog, envelope));
  }
  return records;
}

function openTelemetryResourceRecords(
  resourceLog: Record<string, unknown>,
  envelope: Record<string, unknown>,
): readonly LogRecord[] {
  const records: LogRecord[] = [];
  const resource = openTelemetryResource(resourceLog);
  for (const scopeValue of arrayValue(resourceLog["scopeLogs"])) {
    const scopeLog = objectValue(scopeValue);
    if (!scopeLog) continue;
    const scope = openTelemetryScope(scopeLog["scope"]);
    for (const logValue of arrayValue(scopeLog["logRecords"])) {
      const logRecord = objectValue(logValue);
      if (logRecord) {
        records.push(openTelemetryRecord(logRecord, resource, scope, envelope));
      }
    }
  }
  return records;
}

export const openTelemetryLogParser: LogParser = Object.freeze({
  id: "otel",
  detect: (input: string) =>
    /"(?:resourceLogs|scopeLogs|logRecords|timeUnixNano)"\s*:/.test(input)
      ? 0.99
      : 0,
  parse(input: string) {
    try {
      const envelope = JSON.parse(input) as Record<string, unknown>;
      return Object.freeze(openTelemetryEnvelopeRecords(envelope));
    } catch (error) {
      return Object.freeze([
        malformed(
          "otel",
          input,
          `Malformed OpenTelemetry log: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ]);
    }
  },
});

function firstDefined(
  value: Readonly<Record<string, unknown>>,
  names: readonly string[],
): unknown {
  for (const name of names) {
    if (value[name] !== undefined) return value[name];
  }
  return undefined;
}

function jsonLogSource(value: Readonly<Record<string, unknown>>): LogSource {
  const openTelemetryFields = [
    "resourceLogs",
    "scopeLogs",
    "timeUnixNano",
    "observedTimeUnixNano",
    "severityNumber",
    "traceId",
    "spanId",
  ];
  return openTelemetryFields.some((name) => value[name] !== undefined)
    ? "otel"
    : "jsonl";
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "");
  return normalized || undefined;
}

function jsonLogRecord(value: Record<string, unknown>): LogRecord {
  const severity = normalizeSeverity(
    firstDefined(value, [
      "severityNumber",
      "severityText",
      "level",
      "severity",
    ]),
  );
  return record({
    source: jsonLogSource(value),
    timestamp: timestamp(
      firstDefined(value, ["timeUnixNano", "timestamp", "time"]),
    ),
    observedTimestamp: timestamp(value["observedTimeUnixNano"]),
    severityNumber: severity.number,
    severityText: severity.text,
    body: firstDefined(value, ["body", "message", "msg"]) ?? value,
    attributes: objectValue(value["attributes"]) ?? {},
    resource: objectValue(value["resource"]) ?? {},
    scope: value["scope"] as LogRecord["scope"],
    traceId: optionalString(firstDefined(value, ["traceId", "trace_id"])),
    spanId: optionalString(firstDefined(value, ["spanId", "span_id"])),
    flags: typeof value["flags"] === "number" ? value["flags"] : undefined,
    eventName:
      typeof value["eventName"] === "string" ? value["eventName"] : undefined,
    original: value,
  });
}

function parseJsonLogLine(line: string): LogRecord {
  try {
    return jsonLogRecord(JSON.parse(line) as Record<string, unknown>);
  } catch (error) {
    return malformed(
      "jsonl",
      line,
      `Malformed JSON log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export const jsonLogParser: LogParser = Object.freeze({
  id: "json",
  detect: (input: string) => (/^\s*[{[]/.test(input) ? 0.8 : 0),
  parse(input: string) {
    return Object.freeze(
      input.split("\n").filter(Boolean).map(parseJsonLogLine),
    );
  },
});

const rfc5424Header = /^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/s;
const rfc3164 =
  /^<(\d{1,3})>([A-Z][a-z]{2}\s+\d+\s+\d\d:\d\d:\d\d) (\S+) (.+)$/;

const syslogSeverity = [
  { number: 24, text: "EMERGENCY" },
  { number: 23, text: "ALERT" },
  { number: 22, text: "CRITICAL" },
  { number: 17, text: "ERROR" },
  { number: 13, text: "WARNING" },
  { number: 10, text: "NOTICE" },
  { number: 9, text: "INFORMATIONAL" },
  { number: 5, text: "DEBUG" },
] as const;

function syslogLevel(priority: number): (typeof syslogSeverity)[number] {
  return syslogSeverity[priority & 7] ?? syslogSeverity[7];
}

function parseStructuredData(
  input: string,
): { readonly value: string; readonly message: string } | undefined {
  if (input.startsWith("-")) return nilStructuredData(input);
  if (!input.startsWith("[")) return undefined;
  const end = structuredDataEnd(input);
  if (end === undefined) return undefined;
  const remainder = input.slice(end);
  if (remainder && !remainder.startsWith(" ")) return undefined;
  return {
    value: input.slice(0, end),
    message: remainder.startsWith(" ")
      ? remainder.slice(1).replace(/^\uFEFF/, "")
      : "",
  };
}

function nilStructuredData(
  input: string,
): { readonly value: string; readonly message: string } | undefined {
  if (input.length > 1 && !input.startsWith("- ")) return undefined;
  return {
    value: "-",
    message: input.length === 1 ? "" : input.slice(2).replace(/^\uFEFF/, ""),
  };
}

function structuredDataEnd(input: string): number | undefined {
  let escaped = false;
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character !== "]" || quoted) continue;
    const end = index + 1;
    if (input[end] !== "[") return end;
  }
  return undefined;
}

export const syslogParser: LogParser = Object.freeze({
  id: "syslog",
  detect: (input: string) => (/^<\d{1,3}>/.test(input) ? 0.95 : 0),
  parse(input: string) {
    return Object.freeze(
      input
        .split("\n")
        .filter(
          (line, index, lines) => line.length > 0 || index < lines.length - 1,
        )
        .map((line) => {
          const modern = rfc5424Header.exec(line);
          if (modern) {
            const structured = parseStructuredData(modern[7] ?? "");
            if (!structured) {
              return malformed(
                "syslog",
                line,
                "Malformed RFC 5424 structured data",
              );
            }
            const priority = Number(modern[1]);
            if (priority > 191) {
              return malformed("syslog", line, "Invalid RFC 5424 priority");
            }
            const severity = syslogLevel(priority);
            return record({
              source: "syslog",
              timestamp: timestamp(modern[2]),
              severityNumber: severity.number,
              severityText: severity.text,
              body: structured.message,
              attributes: {
                facility: priority >> 3,
                hostname: modern[3],
                appName: modern[4],
                processId: modern[5],
                messageId: modern[6],
                structuredData: structured.value,
              },
              original: line,
            });
          }
          const legacy = rfc3164.exec(line);
          if (legacy) {
            const priority = Number(legacy[1]);
            const severity = syslogLevel(priority);
            return record({
              source: "syslog",
              severityNumber: severity.number,
              severityText: severity.text,
              body: legacy[4] ?? "",
              attributes: {
                facility: priority >> 3,
                timestamp: legacy[2],
                hostname: legacy[3],
              },
              original: line,
            });
          }
          return malformed("syslog", line, "Malformed syslog record");
        }),
    );
  },
});

export const journaldParser: LogParser = Object.freeze({
  id: "journald",
  detect: (input: string) => (/^__[A-Z_]+=|^_[A-Z_]+=/m.test(input) ? 0.9 : 0),
  parse(input: string) {
    const records: LogRecord[] = [];
    let fields: Record<string, unknown> = {};
    const flush = () => {
      if (Object.keys(fields).length === 0) return;
      const severity = normalizeSeverity(fields["PRIORITY"]);
      records.push(
        record({
          source: "journald",
          timestamp: timestamp(fields["__REALTIME_TIMESTAMP"]),
          severityNumber: severity.number,
          severityText: severity.text,
          body: fields["MESSAGE"] ?? "",
          attributes: fields,
          original: fields,
        }),
      );
      fields = {};
    };
    for (const line of input.split("\n")) {
      if (!line) flush();
      else {
        const index = line.indexOf("=");
        if (index > 0) {
          fields[line.slice(0, index)] = line.slice(index + 1);
        }
      }
    }
    flush();
    return Object.freeze(records);
  },
});

export const containerLogParser: LogParser = Object.freeze({
  id: "container",
  detect: (input: string) =>
    /^\d{4}-\d\d-\d\dT\S+ (stdout|stderr) [FP] /.test(input) ? 0.9 : 0,
  parse(input: string) {
    return Object.freeze(
      input
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const match = /^(\S+) (stdout|stderr) ([FP]) (.*)$/.exec(line);
          if (!match) {
            return malformed("kubernetes", line, "Malformed container log");
          }
          return record({
            source: "kubernetes",
            timestamp: timestamp(match[1]),
            severityNumber: match[2] === "stderr" ? 17 : 9,
            severityText: match[2] === "stderr" ? "ERROR" : "INFO",
            body: match[4],
            attributes: {
              stream: match[2],
              partial: match[3] === "P",
            },
            original: line,
          });
        }),
    );
  },
});

export const processLogParser: LogParser = Object.freeze({
  id: "process",
  detect: (input: string) =>
    /^(?:stdout|stderr)(?:\[\d+\])?:\s/m.test(input) ? 0.88 : 0,
  parse(input: string) {
    return Object.freeze(
      input
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const match = /^(stdout|stderr)(?:\[(\d+)\])?:\s?(.*)$/.exec(line);
          if (!match) {
            return malformed("process", line, "Malformed process output");
          }
          return record({
            source: "process",
            body: match[3] ?? "",
            severityNumber: match[1] === "stderr" ? 17 : 9,
            severityText: match[1] === "stderr" ? "ERROR" : "INFO",
            attributes: {
              stream: match[1],
              processId: match[2] ? Number(match[2]) : undefined,
            },
            original: line,
          });
        }),
    );
  },
});

export const commonLogParser: LogParser = Object.freeze({
  id: "common",
  detect: (input: string) =>
    /^\d{4}-\d\d-\d\d[T ]\S+\s+(TRACE|DEBUG|INFO|NOTICE|WARN|ERROR|FATAL)\b/im.test(
      input,
    )
      ? 0.82
      : 0,
  parse(input: string) {
    return Object.freeze(
      input
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const match =
            /^(\d{4}-\d\d-\d\d[T ]\S+)\s+(TRACE|DEBUG|INFO|NOTICE|WARN|ERROR|FATAL)\s+(.*)$/i.exec(
              line,
            );
          if (!match) return malformed("text", line, "Malformed common log");
          const severity = normalizeSeverity(match[2]);
          return record({
            source: "text",
            timestamp: timestamp(match[1]),
            severityNumber: severity.number,
            severityText: severity.text,
            body: match[3] ?? "",
            original: line,
          });
        }),
    );
  },
});

export const textLogParser: LogParser = Object.freeze({
  id: "text",
  detect: () => 0.01,
  parse: (input: string) =>
    Object.freeze(
      input
        .split("\n")
        .filter(Boolean)
        .map((line) =>
          record({
            source: "text",
            body: line,
            original: line,
          }),
        ),
    ),
});

export const builtInLogParsers = Object.freeze([
  openTelemetryLogParser,
  syslogParser,
  journaldParser,
  containerLogParser,
  processLogParser,
  commonLogParser,
  jsonLogParser,
  textLogParser,
]);

export interface LogEnricher {
  readonly id: string;
  enrich(record: LogRecord): LogRecord;
}

export interface LogRedactor {
  readonly id: string;
  redact(record: LogRecord): LogRecord;
}

const logAssignmentPattern =
  /([A-Za-z0-9_.-]+)(\s*(?:=|:)\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;\]}]+)/gu;

export function createFieldRedactor(
  fields: readonly string[],
  replacement = "[REDACTED]",
): LogRedactor {
  const sensitive = new Set(fields.map((field) => field.toLowerCase()));
  const redactText = (value: string): string =>
    value.replace(
      logAssignmentPattern,
      (match, field: string, separator: string) =>
        sensitive.has(field.toLowerCase())
          ? `${field}${separator}"${replacement}"`
          : match,
    );
  const redactValue = (value: unknown): unknown => {
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          sensitive.has(key.toLowerCase()) ? replacement : redactValue(item),
        ]),
      );
    }
    return value;
  };
  return Object.freeze({
    id: `redact:${fields.join(",")}`,
    redact(input: LogRecord) {
      return record({
        ...input,
        body: redactValue(input.body),
        attributes: redactValue(input.attributes) as Record<string, unknown>,
        resource: redactValue(input.resource) as Record<string, unknown>,
        original: redactValue(input.original),
      });
    },
  });
}

export class LogRingBuffer {
  readonly #capacity: number;
  readonly #records: Array<LogRecord | undefined>;
  #start = 0;
  #size = 0;
  #dropped = 0;
  #sampled = 0;
  #rateLimited = 0;
  #paused = false;
  #following = true;
  readonly #observers = new Set<() => void>();

  constructor(capacity = 100_000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error("Log buffer capacity must be positive");
    }
    this.#capacity = capacity;
    this.#records = Array.from({ length: capacity });
  }

  push(input: LogRecord): void {
    const index = (this.#start + this.#size) % this.#capacity;
    this.#records[index] = input;
    if (this.#size < this.#capacity) {
      this.#size += 1;
    } else {
      this.#start = (this.#start + 1) % this.#capacity;
      this.#dropped += 1;
    }
    this.#notify();
  }

  records(): readonly LogRecord[] {
    return Object.freeze(
      Array.from(
        { length: this.#size },
        (_, index) =>
          this.#records[(this.#start + index) % this.#capacity] as LogRecord,
      ),
    );
  }

  last(): LogRecord | undefined {
    return this.#size === 0
      ? undefined
      : this.#records[(this.#start + this.#size - 1) % this.#capacity];
  }

  replaceLast(input: LogRecord): void {
    if (this.#size === 0) return;
    this.#records[(this.#start + this.#size - 1) % this.#capacity] = input;
    this.#notify();
  }

  clear(): void {
    this.#records.fill(undefined);
    this.#start = 0;
    this.#size = 0;
    this.#dropped = 0;
    this.#sampled = 0;
    this.#rateLimited = 0;
    this.#notify();
  }

  recordSampled(count = 1): void {
    this.#sampled += positiveLogCount("sampled count", count);
    this.#notify();
  }

  recordRateLimited(count = 1): void {
    this.#rateLimited += positiveLogCount("rate-limited count", count);
    this.#notify();
  }

  pause(): void {
    this.#paused = true;
    this.#notify();
  }

  resume(): void {
    this.#paused = false;
    this.#notify();
  }

  follow(value = true): void {
    this.#following = value;
    this.#notify();
  }

  subscribe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  #notify(): void {
    for (const observer of this.#observers) {
      try {
        observer();
      } catch {
        // Operational observers cannot unwind ingestion or block other views.
      }
    }
  }

  statistics(): LogBufferStatistics {
    return Object.freeze({
      size: this.#size,
      dropped: this.#dropped,
      sampled: this.#sampled,
      rateLimited: this.#rateLimited,
      paused: this.#paused,
      following: this.#following,
    });
  }
}

function positiveLogCount(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

export interface LogQuery {
  readonly source: string;
  readonly predicate: (record: LogRecord) => boolean;
  readonly explanation: readonly string[];
  readonly diagnostics: readonly LogDiagnostic[];
}

function field(record: LogRecord, path: string): unknown {
  const aliases: Record<string, unknown> = {
    severity: record.severityNumber,
    severity_text: record.severityText,
    body: record.body,
    timestamp: record.timestamp,
    trace_id: record.traceId,
    span_id: record.spanId,
    source: record.source,
    service: record.resource["service.name"] ?? record.resource["service"],
  };
  if (path in aliases) return aliases[path];
  const root = path.startsWith("attributes.")
    ? record.attributes
    : path.startsWith("resource.")
      ? record.resource
      : undefined;
  if (!root) return undefined;
  return root[path.slice(path.indexOf(".") + 1)];
}

function literal(value: string): unknown {
  const stripped = value.replace(/^["']|["']$/g, "");
  const relativeTime = /^now-(\d+)(ms|s|m|h|d)$/.exec(stripped);
  if (relativeTime) {
    const amount = BigInt(relativeTime[1] ?? "0");
    const multipliers: Readonly<Record<string, bigint>> = {
      d: 86_400_000n,
      h: 3_600_000n,
      m: 60_000n,
      s: 1_000n,
      ms: 1n,
    };
    const milliseconds = amount * (multipliers[relativeTime[2] ?? "ms"] ?? 1n);
    return BigInt(Date.now()) * 1_000_000n - milliseconds * 1_000_000n;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(stripped)) {
    return Number(stripped);
  }
  const severity =
    severityNumbers[stripped.toLowerCase() as keyof typeof severityNumbers];
  return severity ?? stripped;
}

function splitLogical(source: string, operator: "and" | "or"): string[] {
  const parts: string[] = [];
  let quote = "";
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const nextQuote = updatedQuote(source, index, quote);
    if (nextQuote !== undefined) {
      quote = nextQuote;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    const end = logicalSeparatorEnd(source, index, operator);
    if (end === undefined) continue;
    parts.push(source.slice(start, index).trim());
    index = end - 1;
    start = end;
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function updatedQuote(
  source: string,
  index: number,
  quote: string,
): string | undefined {
  const character = source[index] ?? "";
  if (quote) {
    return character === quote && source[index - 1] !== "\\" ? "" : quote;
  }
  return character === '"' || character === "'" ? character : undefined;
}

function logicalSeparatorEnd(
  source: string,
  index: number,
  operator: "and" | "or",
): number | undefined {
  if (!/\s/.test(source[index] ?? "")) return undefined;
  const rest = source.slice(index);
  const match =
    operator === "and"
      ? /^\s+(?:and|&&)\s+/i.exec(rest)
      : /^\s+(?:or|\|\|)\s+/i.exec(rest);
  return match ? index + match[0].length : undefined;
}

function unwrapClause(source: string): string {
  let result = source.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function fuzzyIncludes(actual: string, expected: string): boolean {
  let offset = 0;
  for (const character of actual.toLowerCase()) {
    if (character === expected.toLowerCase()[offset]) offset += 1;
    if (offset === expected.length) return true;
  }
  return expected.length === 0;
}

export function compileLogQuery(source: string): LogQuery {
  const trimmed = source.trim();
  if (!trimmed) {
    return Object.freeze({
      source,
      predicate: () => true,
      explanation: Object.freeze(["match all records"]),
      diagnostics: Object.freeze([]),
    });
  }
  const groups = splitLogical(unwrapClause(trimmed), "or").map((group) =>
    splitLogical(unwrapClause(group), "and"),
  );
  const predicates: ((record: LogRecord) => boolean)[][] = [];
  const explanations: string[] = [];
  const diagnostics: LogDiagnostic[] = [];
  for (const group of groups) {
    const groupPredicates: ((record: LogRecord) => boolean)[] = [];
    for (const rawClause of group) {
      const clause = unwrapClause(rawClause);
      const match =
        /^([\w.-]+)\s*(>=|<=|!=|=|>|<|contains|matches|~)\s*(.+)$/i.exec(
          clause,
        );
      if (!match) {
        diagnostics.push({
          severity: "error",
          message: `Invalid query clause: ${clause}`,
        });
        continue;
      }
      const path = match[1] ?? "";
      const operator = match[2]?.toLowerCase() ?? "=";
      const expected = literal(match[3] ?? "");
      explanations.push(`${path} ${operator} ${String(expected)}`);
      groupPredicates.push((record) =>
        compareLogValues(field(record, path), expected, operator),
      );
    }
    predicates.push(groupPredicates);
  }
  return Object.freeze({
    source,
    predicate: (input: LogRecord) =>
      diagnostics.length === 0 &&
      predicates.some((group) => group.every((predicate) => predicate(input))),
    explanation: Object.freeze(explanations),
    diagnostics: Object.freeze(diagnostics),
  });
}

function compareLogValues(
  actual: unknown,
  expected: unknown,
  operator: string,
): boolean {
  const textComparators: Readonly<
    Record<string, (left: unknown, right: unknown) => boolean>
  > = {
    contains: (left, right) =>
      String(left).toLowerCase().includes(String(right).toLowerCase()),
    matches: matchesLogPattern,
    "~": (left, right) => fuzzyIncludes(String(left), String(right)),
    "=": (left, right) => String(left) === String(right),
    "!=": (left, right) => String(left) !== String(right),
  };
  const textComparator = textComparators[operator];
  if (textComparator) return textComparator(actual, expected);
  if (actual === undefined || actual === null) return false;
  return typeof actual === "bigint" || typeof expected === "bigint"
    ? compareBigInts(actual, expected, operator)
    : compareNumbers(Number(actual), Number(expected), operator);
}

function matchesLogPattern(actual: unknown, expected: unknown): boolean {
  try {
    const pattern = String(expected).replace(/^\/|\/[a-z]*$/gi, "");
    if (!isSafeRegularExpressionSource(pattern)) return false;
    return new RegExp(pattern, "i").test(String(actual));
  } catch {
    return false;
  }
}

function compareBigInts(
  actual: unknown,
  expected: unknown,
  operator: string,
): boolean {
  try {
    return compareNumbers(
      BigInt(actual as bigint | number | string),
      BigInt(expected as bigint | number | string),
      operator,
    );
  } catch {
    return false;
  }
}

function compareNumbers<T extends number | bigint>(
  left: T,
  right: T,
  operator: string,
): boolean {
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  return left < right;
}

function sameLogRecord(left: LogRecord, right: LogRecord): boolean {
  return (
    left.source === right.source &&
    left.severityNumber === right.severityNumber &&
    JSON.stringify(left.body) === JSON.stringify(right.body) &&
    JSON.stringify(left.attributes) === JSON.stringify(right.attributes)
  );
}

export class LogPipeline {
  readonly #parsers: readonly LogParser[];
  readonly #enrichers: readonly LogEnricher[];
  readonly #redactors: readonly LogRedactor[];
  readonly buffer: LogRingBuffer;
  readonly #history: string[] = [];
  readonly #saved = new Map<string, string>();
  readonly #deduplicate: boolean;
  readonly #sampleEvery: number;
  readonly #maxPerSecond?: number;
  readonly #queryHistoryLimit: number;
  readonly #now: () => number;
  #ingested = 0;
  #rateWindow = { second: -1, count: 0 };

  constructor(
    options: {
      readonly parsers?: readonly LogParser[];
      readonly enrichers?: readonly LogEnricher[];
      readonly redactors?: readonly LogRedactor[];
      readonly capacity?: number;
      readonly deduplicate?: boolean;
      readonly sampleEvery?: number;
      readonly maxPerSecond?: number;
      readonly queryHistoryLimit?: number;
      readonly now?: () => number;
    } = {},
  ) {
    this.#parsers = Object.freeze([...(options.parsers ?? builtInLogParsers)]);
    this.#enrichers = Object.freeze([...(options.enrichers ?? [])]);
    this.#redactors = Object.freeze([...(options.redactors ?? [])]);
    this.buffer = new LogRingBuffer(options.capacity);
    this.#deduplicate = options.deduplicate ?? false;
    this.#sampleEvery = positiveLogCount(
      "sampleEvery",
      options.sampleEvery ?? 1,
    );
    this.#maxPerSecond =
      options.maxPerSecond === undefined
        ? undefined
        : positiveLogCount("maxPerSecond", options.maxPerSecond);
    this.#queryHistoryLimit = positiveLogCount(
      "queryHistoryLimit",
      options.queryHistoryLimit ?? 100,
    );
    this.#now = options.now ?? Date.now;
  }

  ingest(input: string, parserId?: string): readonly LogRecord[] {
    const parser = parserId
      ? this.#parsers.find((item) => item.id === parserId)
      : this.#parsers.toSorted(
          (left, right) => right.detect(input) - left.detect(input),
        )[0];
    if (!parser) {
      throw new Error(`Log parser "${parserId ?? "detected"}" is unavailable`);
    }
    const output = parser.parse(input).map((item) => this.#ingestRecord(item));
    return Object.freeze(output);
  }

  #ingestRecord(item: LogRecord): LogRecord {
    const transformed = this.#applyPipeline(item);
    this.#ingested += 1;
    if (this.#ingested % this.#sampleEvery !== 0) {
      this.buffer.recordSampled();
      return record({ ...transformed, sampled: true });
    }
    const duplicate = this.#deduplicatedRecord(transformed);
    if (duplicate) return duplicate;
    const rateLimited = this.#applyRateLimit(transformed);
    if (rateLimited.rateLimited) {
      this.buffer.recordRateLimited();
      return rateLimited;
    }
    this.buffer.push(rateLimited);
    return rateLimited;
  }

  #applyPipeline(item: LogRecord): LogRecord {
    let transformed = item;
    for (const enricher of this.#enrichers)
      transformed = enricher.enrich(transformed);
    for (const redactor of this.#redactors)
      transformed = redactor.redact(transformed);
    return record({ ...transformed });
  }

  #applyRateLimit(item: LogRecord): LogRecord {
    const second = Math.floor(this.#now() / 1_000);
    if (this.#rateWindow.second !== second) {
      this.#rateWindow = { second, count: 0 };
    }
    this.#rateWindow.count += 1;
    return this.#maxPerSecond !== undefined &&
      this.#rateWindow.count > this.#maxPerSecond
      ? record({ ...item, rateLimited: true })
      : item;
  }

  #deduplicatedRecord(item: LogRecord): LogRecord | undefined {
    const previous = this.buffer.last();
    if (!this.#deduplicate || !previous || !sameLogRecord(previous, item))
      return undefined;
    const duplicate = record({
      ...previous,
      duplicateCount: (previous.duplicateCount ?? 1) + 1,
    });
    this.buffer.replaceLast(duplicate);
    return duplicate;
  }

  query(source: string): readonly LogRecord[] {
    this.#history.push(source);
    if (this.#history.length > this.#queryHistoryLimit) this.#history.shift();
    return this.filter(source);
  }

  filter(source: string): readonly LogRecord[] {
    const query = compileLogQuery(source);
    if (query.diagnostics.length > 0) return [];
    return Object.freeze(this.buffer.records().filter(query.predicate));
  }

  saveSearch(name: string, source: string): void {
    this.#saved.set(name, source);
  }

  savedSearches(): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(this.#saved));
  }

  history(): readonly string[] {
    return Object.freeze([...this.#history]);
  }

  clear(): void {
    this.#ingested = 0;
    this.#rateWindow = { second: -1, count: 0 };
    this.buffer.clear();
  }

  replay(records: readonly LogRecord[]): void {
    for (const item of records) this.buffer.push(this.#applyPipeline(item));
  }

  export(
    records: readonly LogRecord[] = this.buffer.records(),
    format: "jsonl" | "text" = "jsonl",
  ): string {
    if (format === "text") {
      return records.map((item) => String(item.body)).join("\n");
    }
    return records
      .map((item) =>
        JSON.stringify(item, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      )
      .join("\n");
  }
}
