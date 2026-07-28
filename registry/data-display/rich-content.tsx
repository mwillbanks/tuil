import { useStreamingPipeline } from "@mwillbanks/tuil";
import {
  CodeDocument,
  type CodeSpan,
  type CodeTheme,
} from "@mwillbanks/tuil-code";
import { DiffModel, StructuredContentModel } from "@mwillbanks/tuil-content";
import { truncateTerminalText } from "@mwillbanks/tuil-core";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  Box as SemanticBox,
  usePointerEvent,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import type { DocumentNode } from "@mwillbanks/tuil-streaming";
import { Box, Text } from "ink";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

const markdownStreamingPipelineOptions = Object.freeze({
  format: "markdown" as const,
});

function keyedLines(lines: readonly string[]): readonly {
  readonly key: string;
  readonly line: string;
}[] {
  const occurrences = new Map<string, number>();
  return lines.map((line) => {
    const occurrence = occurrences.get(line) ?? 0;
    occurrences.set(line, occurrence + 1);
    return { key: `${line}:${occurrence}`, line };
  });
}

function markdownLines(source: string): readonly string[] {
  return source
    .split("\n")
    .map((line) => (/^#{1,6} /.test(line) ? line.toUpperCase() : line));
}

export interface MarkdownViewerProps {
  readonly source: string;
  readonly width?: number;
  readonly selectable?: boolean;
  readonly selectedBlock?: number;
  readonly id?: string;
  readonly label?: string;
  readonly autoFocus?: boolean;
  readonly onSelectedBlockChange?: (index: number) => void | Promise<void>;
  readonly renderBlock?: (node: DocumentNode, index: number) => ReactNode;
}

function markdownText(node: DocumentNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(markdownText).join("");
}

function renderMarkdownChildren(
  node: DocumentNode,
  props: MarkdownViewerProps,
): ReactNode {
  return (
    <Text>
      {(node.children ?? []).map((child, childIndex) => (
        <Text key={`${child.type}:${child.span?.start ?? markdownText(child)}`}>
          {renderMarkdownNode(child, childIndex, props)}
        </Text>
      ))}
    </Text>
  );
}

function renderMarkdownTable(node: DocumentNode): ReactNode {
  return (
    <Box flexDirection="column">
      {(node.children ?? []).map((row) => (
        <Text key={JSON.stringify(row.value ?? row.children)}>
          | {(row.children ?? []).map(markdownText).join(" | ")} |
        </Text>
      ))}
    </Box>
  );
}

type MarkdownNodeRenderer = (
  node: DocumentNode,
  text: string,
  props: MarkdownViewerProps,
) => ReactNode;

const markdownNodeRenderers: Readonly<
  Partial<Record<string, MarkdownNodeRenderer>>
> = Object.freeze({
  heading: (_node, text) => (
    <Text bold underline>
      {text}
    </Text>
  ),
  link: (node, text) => (
    <Text color="blue" underline>
      {text} ({String(node.attributes?.["url"] ?? "")})
    </Text>
  ),
  code: (node, _text, props) => (
    <CodeViewer
      source={String(node.value ?? "")}
      language={String(node.attributes?.["language"] ?? "")}
      width={props.width}
      lineNumbers={false}
    />
  ),
  table: (node) => renderMarkdownTable(node),
});

function renderMarkdownNode(
  node: DocumentNode,
  index: number,
  props: MarkdownViewerProps,
): ReactNode {
  const custom = props.renderBlock?.(node, index);
  if (custom !== undefined) return custom;
  const text = truncateTerminalText(markdownText(node), props.width ?? 80);
  const renderer = markdownNodeRenderers[node.type];
  if (renderer) return renderer(node, text, props);
  if (node.children?.length) return renderMarkdownChildren(node, props);
  return (
    <Text inverse={props.selectable && props.selectedBlock === index}>
      {text}
    </Text>
  );
}

function documentNodeKeys(nodes: readonly DocumentNode[]): readonly string[] {
  const occurrences = new Map<string, number>();
  return nodes.map((node) => {
    const identity = `${node.type}:${node.span?.start ?? "pending"}:${node.raw ?? JSON.stringify(node.value)}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return `${identity}:${occurrence}`;
  });
}

function useMarkdownNodes(source: string): readonly DocumentNode[] {
  const pipeline = useStreamingPipeline(markdownStreamingPipelineOptions);
  const [nodes, setNodes] = useState<readonly DocumentNode[]>(() =>
    markdownLines(source).map((line) => ({ type: "paragraph", value: line })),
  );
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    setError(undefined);
    const controller = new AbortController();
    pipeline.reset();
    void pipeline
      .write(source, controller.signal)
      .then(() => pipeline.end(controller.signal))
      .then((document) => {
        if (controller.signal.aborted) return;
        setNodes(Object.freeze(document.root.children ?? []));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause);
      });
    return () => controller.abort();
  }, [pipeline, source]);
  if (error) throw error;
  return nodes;
}

export function MarkdownViewer({
  source,
  width = 80,
  ...props
}: MarkdownViewerProps): ReactNode {
  const generated = useId();
  const id = props.id ?? generated;
  const nodes = useMarkdownNodes(source);
  const [internalSelected, setInternalSelected] = useState(0);
  const selected = props.selectedBlock ?? internalSelected;
  const nodeKeys = useMemo(() => documentNodeKeys(nodes), [nodes]);
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: false,
        hidden: false,
        role: "application" as const,
        label: props.label ?? "Markdown viewer",
      }),
      [id, props.label],
    ),
  );
  useEffect(() => {
    if (props.autoFocus) focus();
  }, [focus, props.autoFocus]);
  const select = async (index: number) => {
    const next = Math.max(0, Math.min(nodes.length - 1, index));
    if (props.selectedBlock === undefined) setInternalSelected(next);
    await props.onSelectedBlockChange?.(next);
  };
  usePointerEvent(id, "click", focus);
  useTerminalInput(
    async (_input, key) => {
      if (key.upArrow) await select(selected - 1);
      else if (key.downArrow) await select(selected + 1);
      else if (key.home) await select(0);
      else if (key.end) await select(nodes.length - 1);
      else return false;
      return true;
    },
    { enabled: focused && Boolean(props.selectable), priority: 1_500 },
  );
  return (
    <SemanticBox
      id={id}
      role="application"
      label={props.label ?? "Markdown viewer"}
      valueText={`${nodes.length} blocks`}
      flexDirection="column"
    >
      {nodes.map((node, index) => (
        <Box key={nodeKeys[index]}>
          {renderMarkdownNode(node, index, {
            source,
            width,
            ...props,
            selectedBlock: selected,
          })}
        </Box>
      ))}
    </SemanticBox>
  );
}

export interface CodeViewerProps {
  readonly source: string;
  readonly language?: string;
  readonly width?: number;
  readonly lineNumbers?: boolean;
  readonly theme?: CodeTheme;
  readonly id?: string;
  readonly label?: string;
  readonly autoFocus?: boolean;
  readonly wrap?: boolean;
  readonly horizontalOffset?: number;
  readonly foldedLines?: ReadonlySet<number>;
  readonly search?: string | RegExp;
  readonly clipboard?: {
    write(value: string): void | Promise<void>;
  };
  readonly onCopy?: (value: string) => void | Promise<void>;
  readonly selectedLine?: number;
  readonly onSelectedLineChange?: (line: number) => void | Promise<void>;
}

const terminalCodeTheme: CodeTheme = {
  tokenStyles: {
    keyword: { foreground: "magenta", bold: true },
    string: { foreground: "green" },
    number: { foreground: "cyan" },
    comment: { foreground: "gray" },
  },
  diagnosticStyles: {
    info: { foreground: "blue" },
    warning: { foreground: "yellow" },
    error: { foreground: "red" },
  },
};

interface RenderCodeSpan {
  readonly span: CodeSpan;
  readonly style: {
    readonly foreground?: string;
    readonly bold?: boolean;
    readonly underline?: boolean;
    readonly inverse?: boolean;
  };
}

function styledCodeLine(
  line: string,
  lineOffset: number,
  spans: readonly RenderCodeSpan[],
): ReactNode {
  const relevant = spans
    .filter(
      ({ span }) =>
        span.end > lineOffset && span.start < lineOffset + line.length,
    )
    .sort((left, right) => left.span.start - right.span.start);
  const boundaries = new Set([0, line.length]);
  for (const { span } of relevant) {
    boundaries.add(Math.max(0, span.start - lineOffset));
    boundaries.add(Math.min(line.length, span.end - lineOffset));
  }
  const offsets = [...boundaries].sort((left, right) => left - right);
  return offsets.slice(0, -1).map((start, index) => {
    const end = offsets[index + 1] ?? line.length;
    const covering = relevant.filter(
      ({ span }) =>
        span.start <= lineOffset + start && span.end >= lineOffset + end,
    );
    const style = Object.assign({}, ...covering.map((entry) => entry.style));
    return (
      <Text
        key={`${lineOffset + start}:${lineOffset + end}`}
        color={style.foreground}
        bold={style.bold}
        underline={style.underline}
        inverse={style.inverse}
      >
        {line.slice(start, end)}
      </Text>
    );
  });
}

interface CodeViewerProjection {
  readonly lines: readonly string[];
  readonly matches: readonly CodeSpan[];
  readonly spans: readonly RenderCodeSpan[];
}

interface CodeViewerProjectionOptions {
  readonly foldedLines?: ReadonlySet<number>;
  readonly horizontalOffset?: number;
  readonly lineNumbers?: boolean;
  readonly search?: string | RegExp;
  readonly theme?: CodeTheme;
  readonly width?: number;
  readonly wrap?: boolean;
}

async function projectCodeViewer(
  document: CodeDocument,
  options: CodeViewerProjectionOptions,
  signal: AbortSignal,
): Promise<CodeViewerProjection> {
  await document.parse(signal);
  const lines = document.render({
    width: options.width,
    lineNumbers: options.lineNumbers ?? true,
    wrap: options.wrap,
    horizontalOffset: options.horizontalOffset,
    foldedLines: options.foldedLines,
  });
  const matches = options.search ? document.search(options.search) : [];
  const projectionChangesOffsets =
    options.wrap || options.horizontalOffset || options.foldedLines?.size;
  const spans = projectionChangesOffsets
    ? []
    : [
        ...document.themedSpans(options.theme ?? terminalCodeTheme),
        ...matches.map((span) => ({
          span,
          style: { underline: true },
        })),
      ];
  return { lines, matches, spans };
}

function useCodeViewerProjection(
  document: CodeDocument,
  props: CodeViewerProps,
  setInternalLine: (line: number) => void,
  setActiveMatch: (index: number) => void,
): CodeViewerProjection {
  const uncontrolled = props.selectedLine === undefined;
  const [lines, setLines] = useState<readonly string[]>([]);
  const [matches, setMatches] = useState<readonly CodeSpan[]>([]);
  const [spans, setSpans] = useState<readonly RenderCodeSpan[]>([]);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    setError(undefined);
    const controller = new AbortController();
    void projectCodeViewer(
      document,
      {
        foldedLines: props.foldedLines,
        horizontalOffset: props.horizontalOffset,
        lineNumbers: props.lineNumbers,
        search: props.search,
        theme: props.theme,
        width: props.width,
        wrap: props.wrap,
      },
      controller.signal,
    )
      .then((projection) => {
        if (controller.signal.aborted) return;
        setLines(projection.lines);
        setMatches(projection.matches);
        setSpans(projection.spans);
        setActiveMatch(0);
        const firstMatch = projection.matches[0];
        if (firstMatch) {
          const firstLine = sourceLineAtOffset(props.source, firstMatch.start);
          if (uncontrolled) setInternalLine(firstLine);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error);
      });
    return () => controller.abort();
  }, [
    document,
    props.foldedLines,
    props.horizontalOffset,
    props.lineNumbers,
    props.search,
    props.theme,
    props.width,
    props.wrap,
    props.source,
    setInternalLine,
    setActiveMatch,
    uncontrolled,
  ]);
  if (error) throw error;
  return { lines, matches, spans };
}

interface CodeViewerKey {
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly home?: boolean;
  readonly end?: boolean;
  readonly ctrl?: boolean;
}

function codeNavigationTarget(
  key: CodeViewerKey,
  selectedLine: number,
  lineCount: number,
): number | undefined {
  if (key.upArrow) return selectedLine - 1;
  if (key.downArrow) return selectedLine + 1;
  if (key.home) return 0;
  if (key.end) return lineCount - 1;
  return undefined;
}

function adjacentMatchIndex(
  input: string,
  activeMatch: number,
  matchCount: number,
): number | undefined {
  if (matchCount === 0) return undefined;
  if (input === "n") return (activeMatch + 1) % matchCount;
  if (input === "N") return (activeMatch - 1 + matchCount) % matchCount;
  return undefined;
}

function useCodeViewerControls(options: {
  readonly props: CodeViewerProps;
  readonly document: CodeDocument;
  readonly focused: boolean;
  readonly lines: readonly string[];
  readonly matches: readonly CodeSpan[];
  readonly activeMatch: number;
  readonly selectedLine: number;
  readonly setActiveMatch: (index: number) => void;
  readonly setInternalLine: (line: number) => void;
}): void {
  const selectLine = async (line: number) => {
    const next = Math.max(0, Math.min(options.lines.length - 1, line));
    if (options.props.selectedLine === undefined) options.setInternalLine(next);
    await options.props.onSelectedLineChange?.(next);
  };
  useTerminalInput(
    async (input, key) => {
      const navigation = codeNavigationTarget(
        key,
        options.selectedLine,
        options.lines.length,
      );
      if (navigation !== undefined) {
        await selectLine(navigation);
        return true;
      }
      const matchIndex = adjacentMatchIndex(
        input,
        options.activeMatch,
        options.matches.length,
      );
      const match =
        matchIndex === undefined ? undefined : options.matches[matchIndex];
      if (match && matchIndex !== undefined) {
        options.setActiveMatch(matchIndex);
        await selectLine(sourceLineAtOffset(options.props.source, match.start));
        return true;
      }
      if (input !== "c" || !key.ctrl) return false;
      const active = options.matches[options.activeMatch];
      if (active) options.document.select(active.start, active.end);
      const value = options.document.copy();
      await options.props.clipboard?.write(value);
      await options.props.onCopy?.(value);
      return true;
    },
    { enabled: options.focused, priority: 1_500 },
  );
}

function CodeViewerLines(props: {
  readonly focused: boolean;
  readonly lines: readonly string[];
  readonly lineOffsets: readonly number[];
  readonly selectedLine: number;
  readonly spans: readonly RenderCodeSpan[];
}): ReactNode {
  return keyedLines(props.lines).map(({ key, line }, index) => {
    const lineOffset = props.lineOffsets[index] ?? 0;
    const numbered = /^(\s*\d+ │ )(.*)$/.exec(line);
    const prefix = numbered?.[1] ?? "";
    const content = numbered?.[2] ?? line;
    return (
      <Text key={key} inverse={props.focused && index === props.selectedLine}>
        {prefix}
        {styledCodeLine(content, lineOffset, props.spans)}
      </Text>
    );
  });
}

export function CodeViewer(props: CodeViewerProps): ReactNode {
  const generated = useId();
  const id = props.id ?? generated;
  const [internalLine, setInternalLine] = useState(0);
  const [activeMatch, setActiveMatch] = useState(0);
  const selectedLine = props.selectedLine ?? internalLine;
  const document = useMemo(
    () => new CodeDocument(props.source, { language: props.language }),
    [props.language, props.source],
  );
  const projection = useCodeViewerProjection(
    document,
    props,
    setInternalLine,
    setActiveMatch,
  );
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: false,
        hidden: false,
        role: "application" as const,
        label: props.label ?? "Code viewer",
      }),
      [id, props.label],
    ),
  );
  useEffect(() => {
    if (props.autoFocus) focus();
  }, [focus, props.autoFocus]);
  usePointerEvent(id, "click", focus);
  useCodeViewerControls({
    props,
    document,
    focused,
    lines: projection.lines,
    matches: projection.matches,
    activeMatch,
    selectedLine,
    setActiveMatch,
    setInternalLine,
  });
  const renderedSpans: readonly RenderCodeSpan[] = projection.spans.map(
    (entry) =>
      entry.span.kind === "search"
        ? {
            ...entry,
            style: {
              underline: true,
              inverse: projection.matches[activeMatch] === entry.span,
            },
          }
        : entry,
  );
  const lineOffsets = codeLineOffsets(props.source);
  return (
    <SemanticBox
      id={id}
      role="application"
      label={props.label ?? "Code viewer"}
      valueText={`${projection.lines.length} lines · ${projection.matches.length} matches`}
      flexDirection="column"
    >
      <CodeViewerLines
        focused={focused}
        lines={projection.lines}
        lineOffsets={lineOffsets}
        selectedLine={selectedLine}
        spans={renderedSpans}
      />
    </SemanticBox>
  );
}

function sourceLineAtOffset(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length - 1;
}

function codeLineOffsets(source: string): readonly number[] {
  const offsets = [0];
  for (const line of source.split("\n").slice(0, -1)) {
    offsets.push((offsets.at(-1) ?? 0) + line.length + 1);
  }
  return offsets;
}

export interface TimelineItem {
  readonly id: string;
  readonly time: string;
  readonly title: string;
  readonly description?: string;
}

export function Timeline(props: {
  readonly items: readonly TimelineItem[];
}): ReactNode {
  return (
    <Box flexDirection="column">
      {props.items.map((item, index) => (
        <Text key={item.id}>
          {index === props.items.length - 1 ? "└" : "├"} {item.time}{" "}
          {item.title}
          {item.description ? ` — ${item.description}` : ""}
        </Text>
      ))}
    </Box>
  );
}

export interface ChartDatum {
  readonly label: string;
  readonly value: number;
}

export function BarChart(props: {
  readonly data: readonly ChartDatum[];
  readonly width?: number;
}): ReactNode {
  const width = Math.max(1, props.width ?? 30);
  const maximum = Math.max(1, ...props.data.map((item) => item.value));
  return (
    <Box flexDirection="column">
      {props.data.map((item) => (
        <Text key={item.label}>
          {item.label.padEnd(12)}{" "}
          {"█".repeat(Math.round((item.value / maximum) * width))} {item.value}
        </Text>
      ))}
    </Box>
  );
}

export function StructuredContentSummary(props: {
  readonly value: unknown;
}): ReactNode {
  const model = new StructuredContentModel(props.value);
  model.expandAll();
  return (
    <Box flexDirection="column">
      {model.rows().map((row) => (
        <Text key={row.path}>
          {"  ".repeat(row.depth)}
          {row.key}: {String(row.value ?? row.type)}
        </Text>
      ))}
    </Box>
  );
}

export function RichDiffViewer(props: {
  readonly source: string;
  readonly mode?: "unified" | "split";
  readonly id?: string;
  readonly label?: string;
  readonly autoFocus?: boolean;
  readonly search?: string | RegExp;
  readonly collapseUnchangedAfter?: number;
  readonly onResolveHunk?: (
    index: number,
    decision: "apply" | "reject",
    content: string,
  ) => void | Promise<void>;
}): ReactNode {
  const generated = useId();
  const id = props.id ?? generated;
  const model = useMemo(() => new DiffModel(props.source), [props.source]);
  const [activeHunk, setActiveHunk] = useState(0);
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: false,
        hidden: false,
        role: "application" as const,
        label: props.label ?? "Diff viewer",
      }),
      [id, props.label],
    ),
  );
  useEffect(() => {
    if (props.autoFocus) focus();
  }, [focus, props.autoFocus]);
  usePointerEvent(id, "click", focus);
  useTerminalInput(
    async (input, key) => {
      if (key.upArrow || input === "k")
        setActiveHunk(Math.max(0, activeHunk - 1));
      else if (key.downArrow || input === "j")
        setActiveHunk(Math.min(model.hunks().length - 1, activeHunk + 1));
      else if (input === "a" || input === "r") {
        const decision = input === "a" ? "apply" : "reject";
        await props.onResolveHunk?.(
          activeHunk,
          decision,
          model.resolveHunk(activeHunk, decision),
        );
      } else return false;
      return true;
    },
    { enabled: focused, priority: 1_500 },
  );
  const matches = props.search
    ? new Set(model.search(props.search))
    : new Set();
  return (
    <SemanticBox
      id={id}
      role="application"
      label={props.label ?? "Diff viewer"}
      valueText={`${model.hunks().length} hunks`}
      flexDirection="column"
    >
      {keyedLines(
        model.render(props.mode, {
          collapseUnchangedAfter: props.collapseUnchangedAfter,
        }),
      ).map(({ key, line }, index) => (
        <Text key={key} inverse={matches.has(index)}>
          {line}
        </Text>
      ))}
    </SemanticBox>
  );
}
