import type {
  EditorClipboardAdapter,
  EditorSession,
} from "@mwillbanks/tuil-editor";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  Box,
  Text,
  usePointerEvents,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import {
  compileLogQuery,
  type LogPipeline,
  type LogRecord,
} from "@mwillbanks/tuil-logging";
import { ScrollAreaState } from "@mwillbanks/tuil-scroll";
import { Text as InkText } from "ink";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

export type LogDensity = "dense" | "comfortable";
export type LogThemeVariant =
  | LogDensity
  | "monochrome"
  | "high-contrast"
  | "color-blind-safe";

export interface LogTheme {
  readonly variant: LogThemeVariant;
  readonly tokens: Readonly<
    Record<
      | "trace"
      | "debug"
      | "info"
      | "notice"
      | "warn"
      | "error"
      | "fatal"
      | "timestamp"
      | "source"
      | "service"
      | "attribute"
      | "traceId"
      | "selected"
      | "match"
      | "parseError"
      | "live",
      string
    >
  >;
}

const baseTokens = Object.freeze({
  trace: "dim",
  debug: "cyan",
  info: "blue",
  notice: "green",
  warn: "yellow",
  error: "red",
  fatal: "magenta",
  timestamp: "dim",
  source: "cyan",
  service: "blue",
  attribute: "gray",
  traceId: "magenta",
  selected: "inverse",
  match: "underline",
  parseError: "red",
  live: "green",
});

export function createLogTheme(variant: LogThemeVariant): LogTheme {
  const tokens =
    variant === "monochrome"
      ? Object.fromEntries(
          Object.keys(baseTokens).map((key) => [
            key,
            key === "selected"
              ? "inverse"
              : key === "match"
                ? "underline"
                : key === "parseError"
                  ? "bold"
                  : "default",
          ]),
        )
      : variant === "high-contrast"
        ? {
            ...baseTokens,
            info: "brightBlue",
            warn: "brightYellow",
            error: "brightRed",
          }
        : variant === "color-blind-safe"
          ? {
              ...baseTokens,
              warn: "blue",
              error: "magenta",
              fatal: "brightMagenta",
            }
          : baseTokens;
  return Object.freeze({
    variant,
    tokens: Object.freeze(tokens) as LogTheme["tokens"],
  });
}

export const defaultLogThemes = Object.freeze(
  [
    "dense",
    "comfortable",
    "monochrome",
    "high-contrast",
    "color-blind-safe",
  ].map((variant) => createLogTheme(variant as LogThemeVariant)),
);

export interface LogRowView {
  readonly index: number;
  readonly severity: string;
  readonly timestamp: string;
  readonly source: string;
  readonly service: string;
  readonly attributes: string;
  readonly traceId: string;
  readonly body: string;
  readonly selected: boolean;
  readonly parseError: boolean;
  readonly duplicateCount: number;
  readonly rateLimited: boolean;
  readonly sampled: boolean;
}

function service(record: LogRecord): string {
  return String(
    record.resource["service.name"] ?? record.resource["service"] ?? "",
  );
}

export function LogRow(
  record: LogRecord,
  index: number,
  selected = false,
): LogRowView {
  return Object.freeze({
    index,
    severity: record.severityText ?? String(record.severityNumber ?? "INFO"),
    timestamp: record.timestamp?.toString() ?? "",
    source: record.source,
    service: service(record),
    attributes:
      Object.keys(record.attributes).length > 0
        ? JSON.stringify(record.attributes)
        : "",
    traceId: record.traceId ?? "",
    body:
      typeof record.body === "string"
        ? record.body
        : JSON.stringify(record.body),
    selected,
    parseError: record.diagnostics.length > 0,
    duplicateCount: record.duplicateCount ?? 0,
    rateLimited: record.rateLimited ?? false,
    sampled: record.sampled ?? false,
  });
}

export type LogViewerModelOptions = Readonly<{
  width?: number;
  height?: number;
  theme?: LogThemeVariant;
  id?: string;
}> &
  (
    | Readonly<{
        queryEditor?: undefined;
        queryEditorOwnership?: undefined;
      }>
    | Readonly<{
        queryEditor: EditorSession;
        queryEditorOwnership: "borrowed" | "owned";
      }>
  );

export class LogViewerModel {
  readonly #pipeline: LogPipeline;
  readonly #ownsQueryEditor: boolean;
  readonly scroll: ScrollAreaState;
  readonly queryEditor: EditorSession;
  #records: readonly LogRecord[] = [];
  #selected = 0;
  #query = "";
  #theme: LogTheme;
  readonly #observers = new Set<() => void>();
  readonly #unsubscribeBuffer: () => void;
  #revision = 0;

  constructor(pipeline: LogPipeline, options: LogViewerModelOptions = {}) {
    this.#pipeline = pipeline;
    this.#records = pipeline.buffer.records();
    this.scroll = new ScrollAreaState({
      id: options.id ?? "log-viewer",
      viewport: {
        width: options.width ?? 100,
        height: options.height ?? 20,
      },
      extent: {
        width: options.width ?? 100,
        height: this.#records.length,
      },
      sticky: { bottom: true },
      followFocus: true,
    });
    if (!options.queryEditor) {
      throw new Error(
        "LogViewerModel requires a queryEditor from the application editor provider registry",
      );
    }
    if (!options.queryEditorOwnership) {
      throw new Error(
        "LogViewerModel requires explicit borrowed or owned queryEditor ownership",
      );
    }
    this.queryEditor = options.queryEditor;
    this.#ownsQueryEditor = options.queryEditorOwnership === "owned";
    this.#selected = Math.max(0, this.#records.length - 1);
    this.scroll.move("bottom");
    this.#theme = createLogTheme(options.theme ?? "comfortable");
    this.#unsubscribeBuffer = pipeline.buffer.subscribe(() => {
      if (!pipeline.buffer.statistics().paused) this.refresh();
      else this.#notify();
    });
  }

  refresh(): void {
    this.#records = this.#query
      ? this.#pipeline.filter(this.#query)
      : this.#pipeline.buffer.records();
    this.scroll.setExtent({
      width: this.scroll.snapshot().extent.width,
      height: this.#records.length,
    });
    this.#selected = Math.max(
      0,
      Math.min(this.#records.length - 1, this.#selected),
    );
    this.#notify();
  }

  setQuery(source: string): readonly string[] {
    const compiled = compileLogQuery(source);
    this.#query = source;
    this.#pipeline.query(source);
    this.queryEditor.dispatch({
      changes: [
        {
          range: {
            anchor: { line: 0, column: 0 },
            head: {
              line: 0,
              column: this.queryEditor.serialize().length,
            },
          },
          insert: source,
        },
      ],
    });
    this.refresh();
    return Object.freeze(compiled.diagnostics.map((item) => item.message));
  }

  select(index: number): void {
    this.#selected = Math.max(0, Math.min(this.#records.length - 1, index));
    this.scroll.scrollIntoView({
      x: 0,
      y: this.#selected,
      width: 1,
      height: 1,
    });
    this.#notify();
  }

  move(delta: number): void {
    this.select(this.#selected + delta);
  }

  pause(): void {
    this.#pipeline.buffer.pause();
  }

  resume(): void {
    this.#pipeline.buffer.resume();
  }

  setTheme(variant: LogThemeVariant): void {
    this.#theme = createLogTheme(variant);
    this.#notify();
  }

  subscribe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  revision(): number {
    return this.#revision;
  }

  snapshot(): {
    readonly rows: readonly LogRowView[];
    readonly selected?: LogRecord;
    readonly live: boolean;
    readonly theme: LogTheme;
    readonly dropped: number;
    readonly sampled: number;
    readonly rateLimited: number;
    readonly total: number;
  } {
    const viewport = this.scroll.snapshot();
    const statistics = this.#pipeline.buffer.statistics();
    const start = viewport.position.y;
    const end = start + viewport.viewport.height;
    return Object.freeze({
      rows: Object.freeze(
        this.#records
          .slice(start, end)
          .map((record, offset) =>
            LogRow(record, start + offset, start + offset === this.#selected),
          ),
      ),
      selected: this.#records[this.#selected],
      live: !statistics.paused,
      theme: this.#theme,
      dropped: statistics.dropped,
      sampled: statistics.sampled,
      rateLimited: statistics.rateLimited,
      total: this.#records.length,
    });
  }

  export(format: "jsonl" | "text" = "jsonl"): string {
    return this.#pipeline.export(this.#records, format);
  }

  async copy(
    clipboard: EditorClipboardAdapter,
    format: "jsonl" | "text" = "text",
  ): Promise<string> {
    const value = this.export(format);
    await clipboard.write(value);
    return value;
  }

  dispose(): void {
    this.#unsubscribeBuffer();
    this.#observers.clear();
    if (this.#ownsQueryEditor) this.queryEditor.dispose();
  }

  #notify(): void {
    this.#revision += 1;
    for (const observer of this.#observers) observer();
  }
}

export interface LogViewerProps {
  readonly model: LogViewerModel;
  readonly emptyMessage?: string;
  readonly id?: string;
  readonly label?: string;
  readonly query?: string;
  readonly disposeOnUnmount?: boolean;
  readonly autoFocus?: boolean;
  readonly onLiveChange?: (live: boolean) => void | Promise<void>;
  readonly showTimestamp?: boolean;
}

type LogViewerSnapshot = ReturnType<LogViewerModel["snapshot"]>;
type LogViewerKey = Readonly<{
  upArrow?: boolean;
  downArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  home?: boolean;
  end?: boolean;
}>;

function navigateLogViewer(
  model: LogViewerModel,
  key: LogViewerKey,
  total: number,
): boolean {
  const delta = key.upArrow
    ? -1
    : key.downArrow
      ? 1
      : key.pageUp
        ? -10
        : key.pageDown
          ? 10
          : undefined;
  if (delta !== undefined) model.move(delta);
  else if (key.home) model.select(0);
  else if (key.end) model.select(total - 1);
  else return false;
  return true;
}

function requestedLiveState(
  input: string,
  current: boolean,
): boolean | undefined {
  if (input === "p") return false;
  if (input === "r") return true;
  if (input === " ") return !current;
  return undefined;
}

function useLogViewerInput(
  model: LogViewerModel,
  focused: boolean,
  snapshot: LogViewerSnapshot,
  onLiveChange: LogViewerProps["onLiveChange"],
): void {
  useTerminalInput(
    (input, key) => {
      if (navigateLogViewer(model, key, snapshot.total)) return true;
      const next = requestedLiveState(input, snapshot.live);
      if (next === undefined) return false;
      if (next) model.resume();
      else model.pause();
      void onLiveChange?.(next);
      return true;
    },
    { enabled: focused, priority: 1_700 },
  );
}

function LogViewerHeader({
  snapshot,
}: {
  readonly snapshot: LogViewerSnapshot;
}): ReactNode {
  const indicators = [
    snapshot.dropped > 0 ? `${snapshot.dropped} dropped` : "",
    snapshot.sampled > 0 ? `${snapshot.sampled} sampled` : "",
    snapshot.rateLimited > 0 ? `${snapshot.rateLimited} rate-limited` : "",
  ].filter(Boolean);
  return (
    <Text>
      <LogThemeText
        token={snapshot.live ? snapshot.theme.tokens.live : undefined}
      >
        {snapshot.live ? "LIVE" : "PAUSED"}
      </LogThemeText>{" "}
      · {snapshot.total} records
      {indicators.length > 0 ? ` · ${indicators.join(" · ")}` : ""}
    </Text>
  );
}

function LogViewerRows({
  snapshot,
  emptyMessage,
  query,
  showTimestamp,
}: {
  readonly snapshot: LogViewerSnapshot;
  readonly emptyMessage: string;
  readonly query: string;
  readonly showTimestamp: boolean;
}): ReactNode {
  if (snapshot.rows.length === 0) return <Text dimColor>{emptyMessage}</Text>;
  return (
    <Box flexDirection="column">
      {snapshot.rows.map((row, index) => (
        <Box
          key={`${row.index}:${row.timestamp}:${row.source}`}
          marginBottom={
            snapshot.theme.variant === "dense" ||
            index === snapshot.rows.length - 1
              ? 0
              : 1
          }
        >
          <LogViewerRow
            row={row}
            query={query}
            showTimestamp={showTimestamp}
            theme={snapshot.theme}
          />
        </Box>
      ))}
    </Box>
  );
}

type LogTextStyle = Readonly<{
  color?: string;
  dimColor?: boolean;
  inverse?: boolean;
  underline?: boolean;
  bold?: boolean;
}>;

export function logThemeTextStyle(token: string | undefined): LogTextStyle {
  if (!token || token === "default") return {};
  if (token === "dim") return { dimColor: true };
  if (token === "inverse") return { inverse: true };
  if (token === "underline") return { underline: true };
  if (token === "bold") return { bold: true };
  return { color: token };
}

function LogThemeText(props: {
  readonly token?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <InkText {...logThemeTextStyle(props.token)}>{props.children}</InkText>
  );
}

function LogViewerRow(props: {
  readonly row: LogRowView;
  readonly query: string;
  readonly showTimestamp: boolean;
  readonly theme: LogTheme;
}): ReactNode {
  const { row } = props;
  const { theme } = props;
  return (
    <Text>
      {row.selected ? "▶ " : "  "}
      <LogRowIdentity
        row={row}
        showTimestamp={props.showTimestamp}
        theme={theme}
      />{" "}
      <LogRowBody row={row} query={props.query} theme={theme} />
      <LogRowContext row={row} theme={theme} />
    </Text>
  );
}

function LogRowIdentity(props: {
  readonly row: LogRowView;
  readonly showTimestamp: boolean;
  readonly theme: LogTheme;
}): ReactNode {
  const { row, theme } = props;
  return (
    <>
      {props.showTimestamp && row.timestamp ? (
        <LogThemeText token={theme.tokens.timestamp}>
          {row.timestamp}{" "}
        </LogThemeText>
      ) : null}
      <LogThemeText
        token={
          row.parseError
            ? theme.tokens.parseError
            : theme.tokens[severityToken(row.severity)]
        }
      >
        {row.severity}
      </LogThemeText>
      {row.source === "text" ? null : (
        <LogThemeText token={theme.tokens.source}> {row.source}</LogThemeText>
      )}
      {row.service ? (
        <LogThemeText token={theme.tokens.service}> {row.service}</LogThemeText>
      ) : null}
    </>
  );
}

function LogRowBody(props: {
  readonly row: LogRowView;
  readonly query: string;
  readonly theme: LogTheme;
}): ReactNode {
  const { row, theme } = props;
  const matchOffset = props.query ? row.body.indexOf(props.query) : -1;
  const matchEnd =
    matchOffset < 0 ? matchOffset : matchOffset + props.query.length;
  return (
    <LogThemeText token={row.selected ? theme.tokens.selected : undefined}>
      {matchOffset < 0 ? row.body : row.body.slice(0, matchOffset)}
      {matchOffset < 0 ? null : (
        <LogThemeText token={theme.tokens.match}>
          {row.body.slice(matchOffset, matchEnd)}
        </LogThemeText>
      )}
      {matchOffset < 0 ? null : row.body.slice(matchEnd)}
    </LogThemeText>
  );
}

function LogRowContext(props: {
  readonly row: LogRowView;
  readonly theme: LogTheme;
}): ReactNode {
  const { row, theme } = props;
  return (
    <>
      {row.attributes ? (
        <LogThemeText token={theme.tokens.attribute}>
          {" "}
          {row.attributes}
        </LogThemeText>
      ) : null}
      {row.traceId ? (
        <LogThemeText token={theme.tokens.traceId}>
          {" "}
          trace={row.traceId}
        </LogThemeText>
      ) : null}
      {row.duplicateCount > 1 ? (
        <LogThemeText token={theme.tokens.attribute}>
          {" "}
          ×{row.duplicateCount}
        </LogThemeText>
      ) : null}
      {row.sampled ? (
        <LogThemeText token={theme.tokens.warn}> sampled</LogThemeText>
      ) : null}
      {row.rateLimited ? (
        <LogThemeText token={theme.tokens.warn}> rate-limited</LogThemeText>
      ) : null}
    </>
  );
}

function severityToken(
  severityText: string,
): "trace" | "debug" | "info" | "notice" | "warn" | "error" | "fatal" {
  const severity = severityText.toLowerCase();
  if (severity.includes("fatal")) return "fatal";
  if (severity.includes("error")) return "error";
  if (severity.includes("warn")) return "warn";
  if (severity.includes("notice")) return "notice";
  if (severity.includes("debug")) return "debug";
  if (severity.includes("trace")) return "trace";
  return "info";
}

function useLogViewerBehavior(options: {
  readonly model: LogViewerModel;
  readonly id: string;
  readonly label: string;
  readonly autoFocus: boolean;
  readonly disposeOnUnmount: boolean;
  readonly onLiveChange: LogViewerProps["onLiveChange"];
}): LogViewerSnapshot {
  const { model, id, label } = options;
  const subscribe = useCallback(
    (notify: () => void) => model.subscribe(notify),
    [model],
  );
  const revision = useCallback(() => model.revision(), [model]);
  useSyncExternalStore(subscribe, revision, revision);
  const snapshot = model.snapshot();
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: false,
        hidden: false,
        role: "application" as const,
        label,
      }),
      [id, label],
    ),
  );
  useEffect(() => {
    if (options.autoFocus) focus();
  }, [focus, options.autoFocus]);
  useLogViewerInput(model, focused, snapshot, options.onLiveChange);
  usePointerEvents(
    useMemo(
      () => [
        { id, type: "click" as const, listener: focus },
        {
          id,
          type: "wheel" as const,
          listener: (event: { readonly wheelY: number }) =>
            model.move(event.wheelY),
        },
      ],
      [focus, id, model],
    ),
  );
  useEffect(
    () => () => {
      if (options.disposeOnUnmount) model.dispose();
    },
    [model, options.disposeOnUnmount],
  );
  return snapshot;
}

export function LogViewer({
  model,
  emptyMessage = "No log records",
  id: providedId,
  label = "Log viewer",
  query = "",
  disposeOnUnmount = false,
  autoFocus = false,
  onLiveChange,
  showTimestamp = true,
}: LogViewerProps): ReactNode {
  const generated = useId();
  const id = providedId ?? generated;
  const snapshot = useLogViewerBehavior({
    model,
    id,
    label,
    autoFocus,
    disposeOnUnmount,
    onLiveChange,
  });
  return (
    <Box
      flexDirection="column"
      id={id}
      role="application"
      label={label}
      valueText={`${snapshot.total} records`}
    >
      <LogViewerHeader snapshot={snapshot} />
      <LogViewerRows
        snapshot={snapshot}
        emptyMessage={emptyMessage}
        query={query}
        showTimestamp={showTimestamp}
      />
    </Box>
  );
}

export function LogSearchBar(props: {
  readonly model: LogViewerModel;
  readonly query: string;
}): ReactNode {
  const [diagnostics, setDiagnostics] = useState<readonly string[]>([]);
  useEffect(() => {
    setDiagnostics(props.model.setQuery(props.query));
  }, [props.model, props.query]);
  return (
    <Text>
      /{props.query}
      {diagnostics.length > 0 ? ` · ${diagnostics.join("; ")}` : ""}
    </Text>
  );
}

export function LogFilterBar(props: { readonly query: string }): ReactNode {
  const valid = compileLogQuery(props.query).diagnostics.length === 0;
  return (
    <Text color={valid ? "green" : "red"}>filter: {props.query || "none"}</Text>
  );
}

function logFacets(records: readonly LogRecord[]) {
  const facets = new Map<string, number>();
  for (const record of records) {
    const key = service(record) || record.source;
    facets.set(key, (facets.get(key) ?? 0) + 1);
  }
  return Object.freeze(Object.fromEntries(facets));
}

export function LogFacetPanel(props: {
  readonly records: readonly LogRecord[];
}): ReactNode {
  return (
    <Box flexDirection="column">
      {Object.entries(logFacets(props.records)).map(([name, count]) => (
        <Text key={name}>
          {name}: {count}
        </Text>
      ))}
    </Box>
  );
}

export function LogDetail(props: { readonly record: LogRecord }): ReactNode {
  return (
    <StructuredValue
      value={{
        body: props.record.body,
        attributes: props.record.attributes,
        resource: props.record.resource,
        diagnostics: props.record.diagnostics,
      }}
    />
  );
}

export function LogTimeline(props: {
  readonly records: readonly LogRecord[];
}): ReactNode {
  const buckets = new Map<string, number>();
  for (const record of props.records) {
    const value = record.timestamp
      ? String(record.timestamp / 1_000_000_000n)
      : "unknown";
    buckets.set(value, (buckets.get(value) ?? 0) + 1);
  }
  return (
    <Box flexDirection="column">
      {[...buckets.entries()].map(([time, count]) => (
        <Text key={time}>
          {time}: {"█".repeat(Math.min(40, count))} {count}
        </Text>
      ))}
    </Box>
  );
}

export function TraceContext(props: { readonly record: LogRecord }): ReactNode {
  return (
    <Text>
      trace={props.record.traceId ?? "-"} span={props.record.spanId ?? "-"}{" "}
      flags={props.record.flags ?? 0}
    </Text>
  );
}

export function StructuredValue(props: { readonly value: unknown }): ReactNode {
  return (
    <Text>
      {typeof props.value === "string"
        ? props.value
        : JSON.stringify(props.value, null, 2)}
    </Text>
  );
}

export function LogSourceBadge(props: {
  readonly record: LogRecord;
}): ReactNode {
  return <Text>[{service(props.record) || props.record.source}]</Text>;
}

export function LiveIndicator(props: {
  readonly live: boolean;
  readonly dropped?: number;
  readonly sampled?: number;
  readonly rateLimited?: number;
}): ReactNode {
  const indicators = [
    props.dropped ? `${props.dropped} dropped` : "",
    props.sampled ? `${props.sampled} sampled` : "",
    props.rateLimited ? `${props.rateLimited} rate-limited` : "",
  ].filter(Boolean);
  return (
    <Text>
      {props.live ? "LIVE" : "PAUSED"}
      {indicators.length > 0 ? ` · ${indicators.join(" · ")}` : ""}
    </Text>
  );
}

export function ParseErrorRow(props: {
  readonly record: LogRecord;
}): ReactNode {
  if (props.record.diagnostics.length === 0) return null;
  return (
    <Text color="red">
      {String(props.record.body)} ·{" "}
      {props.record.diagnostics.map((item) => item.message).join("; ")}
    </Text>
  );
}

export function LogExportDialog(props: {
  readonly model: LogViewerModel;
  readonly format?: "jsonl" | "text";
}): ReactNode {
  const format = props.format ?? "jsonl";
  return (
    <Box flexDirection="column">
      <Text bold>Export {format}</Text>
      <Text>{props.model.export(format)}</Text>
    </Box>
  );
}
