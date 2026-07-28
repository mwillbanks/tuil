import {
  createGlobalSearchExpression,
  sliceTerminalText,
  terminalTextWidth,
  wrapTerminalText,
} from "@mwillbanks/tuil-core";

export interface CodeSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: string;
}

export interface CodeDiagnostic extends CodeSpan {
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
}

export interface CodeParseResult {
  readonly language: string;
  readonly version: number;
  readonly spans: readonly CodeSpan[];
  readonly folds: readonly {
    readonly startLine: number;
    readonly endLine: number;
  }[];
  readonly diagnostics: readonly CodeDiagnostic[];
  readonly incremental?: boolean;
}

export interface CodeParser {
  readonly id: string;
  readonly languages: readonly string[];
  parse(
    source: string,
    options: {
      readonly previous?: CodeParseResult;
      readonly signal: AbortSignal;
    },
  ): CodeParseResult | Promise<CodeParseResult>;
  dispose?(): void;
}

export interface IncrementalSyntaxNode {
  readonly start: number;
  readonly end: number;
  readonly type: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly diagnostic?: Omit<CodeDiagnostic, "start" | "end" | "kind">;
}

export interface IncrementalSyntaxTree {
  readonly nodes: readonly IncrementalSyntaxNode[];
  readonly source?: string;
  readonly incremental?: boolean;
  readonly revision?: number;
}

export interface IncrementalSyntaxEngine {
  parse(
    source: string,
    previous: IncrementalSyntaxTree | undefined,
    signal: AbortSignal,
  ): IncrementalSyntaxTree | Promise<IncrementalSyntaxTree>;
  dispose?(): void;
}

export class TreeSitterCodeParser implements CodeParser {
  readonly id: string;
  readonly languages: readonly string[];
  readonly #engine: IncrementalSyntaxEngine;
  readonly #trees = new WeakMap<CodeParseResult, IncrementalSyntaxTree>();
  #version = 0;

  constructor(
    id: string,
    languages: readonly string[],
    engine: IncrementalSyntaxEngine,
  ) {
    this.id = id;
    this.languages = Object.freeze([...languages]);
    this.#engine = engine;
  }

  async parse(
    source: string,
    options: {
      readonly previous?: CodeParseResult;
      readonly signal: AbortSignal;
    },
  ): Promise<CodeParseResult> {
    if (options.signal.aborted) throw options.signal.reason;
    const tree = await this.#engine.parse(
      source,
      options.previous ? this.#trees.get(options.previous) : undefined,
      options.signal,
    );
    if (options.signal.aborted) throw options.signal.reason;
    const nodes = tree.nodes;
    const result = Object.freeze({
      language: this.languages[0] ?? "text",
      version: ++this.#version,
      spans: Object.freeze(
        nodes.map((node) => ({
          start: node.start,
          end: node.end,
          kind: node.type,
        })),
      ),
      folds: Object.freeze([
        ...new Map(
          nodes.flatMap((node) => {
            if (
              node.startLine === undefined ||
              node.endLine === undefined ||
              node.endLine <= node.startLine
            ) {
              return [];
            }
            return [
              [
                `${node.startLine}:${node.endLine}`,
                {
                  startLine: node.startLine,
                  endLine: node.endLine,
                },
              ] as const,
            ];
          }),
        ).values(),
      ]),
      diagnostics: Object.freeze(
        nodes
          .filter(
            (
              node,
            ): node is IncrementalSyntaxNode & {
              readonly diagnostic: NonNullable<
                IncrementalSyntaxNode["diagnostic"]
              >;
            } => Boolean(node.diagnostic),
          )
          .map((node) => ({
            start: node.start,
            end: node.end,
            kind: node.type,
            ...node.diagnostic,
          })),
      ),
      incremental: tree.incremental,
    });
    this.#trees.set(result, tree);
    return result;
  }

  dispose(): void {
    this.#engine.dispose?.();
  }
}

interface WorkerParseResponse {
  readonly id: number;
  readonly nodes?: readonly IncrementalSyntaxNode[];
  readonly error?: string;
  readonly incremental?: boolean;
  readonly revision?: number;
}

interface WorkerEdit {
  readonly startIndex: number;
  readonly oldEndIndex: number;
  readonly newEndIndex: number;
  readonly startPosition: { readonly row: number; readonly column: number };
  readonly oldEndPosition: { readonly row: number; readonly column: number };
  readonly newEndPosition: { readonly row: number; readonly column: number };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function treeSitterPoint(source: string, offset: number) {
  const prefix = source.slice(0, offset);
  const lineStart = prefix.lastIndexOf("\n") + 1;
  return {
    row: prefix.split("\n").length - 1,
    column: byteLength(prefix.slice(lineStart)),
  };
}

function commonPrefixLength(left: string, right: string): number {
  const maximum = Math.min(left.length, right.length);
  let offset = 0;
  while (offset < maximum && left[offset] === right[offset]) offset += 1;
  return offset;
}

function commonSuffixStarts(
  previous: string,
  source: string,
  start: number,
): readonly [number, number] {
  let oldEnd = previous.length;
  let newEnd = source.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    previous[oldEnd - 1] === source[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return [oldEnd, newEnd];
}

function avoidSplitSurrogate(source: string, offset: number): number {
  return /[\uDC00-\uDFFF]/.test(source[offset] ?? "")
    ? Math.max(0, offset - 1)
    : offset;
}

function commonEdit(previous: string, source: string): WorkerEdit | undefined {
  if (previous === source) return undefined;
  const start = avoidSplitSurrogate(
    previous,
    commonPrefixLength(previous, source),
  );
  const [suffixOldEnd, suffixNewEnd] = commonSuffixStarts(
    previous,
    source,
    start,
  );
  const oldEnd = avoidSplitSurrogate(previous, suffixOldEnd);
  const newEnd = avoidSplitSurrogate(source, suffixNewEnd);
  return {
    startIndex: byteLength(previous.slice(0, start)),
    oldEndIndex: byteLength(previous.slice(0, oldEnd)),
    newEndIndex: byteLength(source.slice(0, newEnd)),
    startPosition: treeSitterPoint(previous, start),
    oldEndPosition: treeSitterPoint(previous, oldEnd),
    newEndPosition: treeSitterPoint(source, newEnd),
  };
}

class TreeSitterWorkerClient {
  readonly #worker: Worker;
  readonly #pending = new Map<
    number,
    {
      readonly documentId: number;
      readonly cancellation: Int32Array;
      readonly resolve: (tree: IncrementalSyntaxTree) => void;
      readonly reject: (error: unknown) => void;
    }
  >();
  #sequence = 0;

  constructor() {
    const workerEntry = import.meta.path.endsWith(".ts")
      ? "./worker.ts"
      : "./worker.js";
    this.#worker = new Worker(new URL(workerEntry, import.meta.url));
    this.#worker.unref();
    this.#worker.onmessage = (event: MessageEvent<WorkerParseResponse>) => {
      const pending = this.#pending.get(event.data.id);
      if (!pending) return;
      this.#pending.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else
        pending.resolve(
          Object.freeze({
            nodes: Object.freeze([...(event.data.nodes ?? [])]),
            incremental: event.data.incremental,
            revision: event.data.revision,
          }),
        );
    };
    this.#worker.onerror = (event) => {
      const error = new Error(event.message || "Tree-sitter worker failed");
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    };
  }

  parse(
    documentId: number,
    language: string,
    source: string,
    reusePrevious: boolean,
    previousRevision: number | undefined,
    edit: WorkerEdit | undefined,
    signal: AbortSignal,
  ): Promise<IncrementalSyntaxTree> {
    if (signal.aborted) return Promise.reject(signal.reason);
    const id = ++this.#sequence;
    const cancellation = new Int32Array(new SharedArrayBuffer(4));
    return new Promise((resolve, reject) => {
      const abort = () => {
        Atomics.store(cancellation, 0, 1);
        this.#pending.delete(id);
        reject(signal.reason);
      };
      this.#pending.set(id, {
        documentId,
        cancellation,
        resolve: (tree) => {
          signal.removeEventListener("abort", abort);
          resolve(tree);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      });
      signal.addEventListener("abort", abort, { once: true });
      this.#worker.postMessage({
        type: "parse",
        id,
        documentId,
        language,
        source,
        reusePrevious,
        previousRevision,
        edit,
        cancellation: cancellation.buffer,
      });
    });
  }

  dispose(documentId: number): void {
    for (const [id, pending] of this.#pending) {
      if (pending.documentId !== documentId) continue;
      Atomics.store(pending.cancellation, 0, 1);
      this.#pending.delete(id);
      pending.reject(new Error("Tree-sitter parser is disposed"));
    }
    this.#worker.postMessage({ type: "dispose", documentId });
  }
}

const treeSitterWorker = new TreeSitterWorkerClient();
let treeSitterDocumentSequence = 0;

class BundledTreeSitterEngine implements IncrementalSyntaxEngine {
  readonly #language: string;
  readonly #documentId = ++treeSitterDocumentSequence;
  #disposed = false;
  constructor(language: string) {
    this.#language = language;
  }

  async parse(
    source: string,
    previous: IncrementalSyntaxTree | undefined,
    signal: AbortSignal,
  ): Promise<IncrementalSyntaxTree> {
    if (signal.aborted) throw signal.reason;
    if (this.#disposed) throw new Error("Tree-sitter parser is disposed");
    const tree = await treeSitterWorker.parse(
      this.#documentId,
      this.#language,
      source,
      previous?.source !== undefined,
      previous?.revision,
      previous?.source === undefined
        ? undefined
        : commonEdit(previous.source, source),
      signal,
    );
    return Object.freeze({ ...tree, source });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    treeSitterWorker.dispose(this.#documentId);
  }
}

export function createBundledCodeParsers(): readonly CodeParser[] {
  return Object.freeze([
    new TreeSitterCodeParser(
      "tuil-tree-sitter-typescript",
      ["typescript"],
      new BundledTreeSitterEngine("typescript"),
    ),
    new TreeSitterCodeParser(
      "tuil-tree-sitter-tsx",
      ["tsx"],
      new BundledTreeSitterEngine("tsx"),
    ),
    new TreeSitterCodeParser(
      "tuil-tree-sitter-javascript",
      ["javascript", "jsx"],
      new BundledTreeSitterEngine("javascript"),
    ),
    new RegexCodeParser(),
  ]);
}

export interface CodeTheme {
  readonly tokenStyles: Readonly<
    Record<string, { readonly foreground?: string; readonly bold?: boolean }>
  >;
  readonly diagnosticStyles: Readonly<
    Record<CodeDiagnostic["severity"], { readonly foreground: string }>
  >;
}

interface CodeRenderOptions {
  readonly width?: number;
  readonly lineNumbers?: boolean;
  readonly wrap?: boolean;
  readonly horizontalOffset?: number;
  readonly foldedLines?: ReadonlySet<number>;
}

const extensions: Readonly<Record<string, string>> = Object.freeze({
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  sh: "shell",
  bash: "shell",
  py: "python",
  rs: "rust",
  zig: "zig",
  go: "go",
  css: "css",
  html: "html",
});

export function detectCodeLanguage(source: string, filename?: string): string {
  const extension = filename?.split(".").at(-1)?.toLowerCase();
  if (extension && extensions[extension]) return extensions[extension];
  if (/^#!.*\b(bash|sh)\b/.test(source)) return "shell";
  if (/\b(interface|type)\s+\w+/.test(source)) return "typescript";
  if (/\b(const|let|function)\s+\w+/.test(source)) {
    return "javascript";
  }
  if (/^\s*[{[]/.test(source)) return "json";
  return "text";
}

export class RegexCodeParser implements CodeParser {
  readonly id = "tuil-regex";
  readonly languages = ["*"];
  #version: number;

  constructor() {
    this.#version = 0;
  }

  parse(
    source: string,
    options: { readonly signal: AbortSignal },
  ): CodeParseResult {
    if (options.signal.aborted) throw options.signal.reason;
    const spans: CodeSpan[] = [];
    const patterns: readonly [string, RegExp][] = [
      ["comment", /\/\/.*$|\/\*[\s\S]*?\*\/|#.*$/gm],
      ["string", /(["'`])(?:\\.|(?!\1)[^\\])*\1/g],
      [
        "keyword",
        /\b(const|let|var|function|class|interface|type|return|if|else|for|while|import|export|from|async|await|throw|try|catch|new)\b/g,
      ],
      ["number", /\b\d+(?:\.\d+)?\b/g],
    ];
    for (const [kind, pattern] of patterns) {
      for (const match of source.matchAll(pattern)) {
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          kind,
        });
      }
    }
    const folds: {
      startLine: number;
      endLine: number;
    }[] = [];
    const stack: number[] = [];
    source.split("\n").forEach((line, index) => {
      for (const character of line) {
        if (character === "{") stack.push(index);
        if (character === "}") {
          const startLine = stack.pop();
          if (startLine !== undefined && index > startLine) {
            folds.push({ startLine, endLine: index });
          }
        }
      }
    });
    return Object.freeze({
      language: "text",
      version: ++this.#version,
      spans: Object.freeze(
        spans.sort((left, right) => left.start - right.start),
      ),
      folds: Object.freeze(folds),
      diagnostics: Object.freeze(
        stack.map((line) => ({
          start: source.split("\n").slice(0, line).join("\n").length,
          end: source.length,
          kind: "syntax",
          severity: "warning" as const,
          message: "Unclosed block",
        })),
      ),
    });
  }
}

export class CodeDocument {
  readonly #parsers: readonly CodeParser[];
  #source: string;
  #language: string;
  #result?: CodeParseResult;
  #previousResult?: CodeParseResult;
  #selection?: { readonly start: number; readonly end: number };
  #generation = 0;

  constructor(
    source: string,
    options: {
      readonly language?: string;
      readonly filename?: string;
      readonly parsers?: readonly CodeParser[];
    } = {},
  ) {
    this.#source = source;
    this.#language =
      options.language ?? detectCodeLanguage(source, options.filename);
    this.#parsers = Object.freeze([
      ...(options.parsers ?? createBundledCodeParsers()),
    ]);
  }

  get source(): string {
    return this.#source;
  }

  get language(): string {
    return this.#language;
  }

  async parse(signal = new AbortController().signal): Promise<CodeParseResult> {
    const generation = this.#generation;
    const source = this.#source;
    const language = this.#language;
    const previous = this.#result ?? this.#previousResult;
    const parser =
      this.#parsers.find(
        (item) =>
          item.languages.includes(this.#language) ||
          item.languages.includes("*"),
      ) ?? this.#parsers[0];
    if (!parser) throw new Error("No code parser is registered");
    await Bun.sleep(0);
    const result = await parser.parse(source, {
      previous,
      signal,
    });
    if (generation !== this.#generation) {
      throw new Error("Code parse result was superseded by a newer document");
    }
    this.#result =
      result.language === language
        ? result
        : Object.freeze({
            ...result,
            language,
          });
    this.#previousResult = this.#result;
    return this.#result;
  }

  update(start: number, end: number, insert: string): void {
    if (start < 0 || end < start || end > this.#source.length) {
      throw new Error("Code update range is invalid");
    }
    this.#source =
      this.#source.slice(0, start) + insert + this.#source.slice(end);
    const delta = insert.length - (end - start);
    if (this.#selection) {
      this.#selection = Object.freeze({
        start: remapOffset(this.#selection.start, start, end, delta),
        end: remapOffset(this.#selection.end, start, end, delta),
      });
    }
    this.#previousResult = this.#result ?? this.#previousResult;
    this.#result = undefined;
    this.#generation += 1;
  }

  search(query: string | RegExp): readonly CodeSpan[] {
    const expression = createGlobalSearchExpression(query);
    return Object.freeze(
      [...this.#source.matchAll(expression)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        kind: "search",
      })),
    );
  }

  select(start: number, end: number): void {
    if (start < 0 || end < start || end > this.#source.length) {
      throw new Error("Code selection range is invalid");
    }
    this.#selection = Object.freeze({ start, end });
  }

  selection(): { readonly start: number; readonly end: number } | undefined {
    return this.#selection;
  }

  copy(): string {
    return this.#selection
      ? this.#source.slice(this.#selection.start, this.#selection.end)
      : this.#source;
  }

  themedSpans(theme: CodeTheme): readonly {
    readonly span: CodeSpan;
    readonly style: { readonly foreground?: string; readonly bold?: boolean };
  }[] {
    return Object.freeze(
      (this.#result?.spans ?? []).flatMap((span) => {
        const style = theme.tokenStyles[span.kind] ?? {};
        return style.foreground || style.bold ? [{ span, style }] : [];
      }),
    );
  }

  render(options: CodeRenderOptions = {}): readonly string[] {
    const width = Math.max(1, options.width ?? 80);
    const lines = this.#source.split("\n");
    const output: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const fold = this.#result?.folds.find(
        (item) => item.startLine === index && options.foldedLines?.has(index),
      );
      const prefix = options.lineNumbers
        ? `${String(index + 1).padStart(String(lines.length).length)} │ `
        : "";
      const available = Math.max(1, width - terminalTextWidth(prefix));
      const line = sliceTerminalText(
        lines[index] ?? "",
        options.horizontalOffset ?? 0,
      );
      output.push(
        ...renderCodeLine(line, prefix, available, options.wrap, Boolean(fold)),
      );
      if (fold) index = fold.endLine;
    }
    return Object.freeze(output);
  }

  dispose(): void {
    for (const parser of new Set(this.#parsers)) parser.dispose?.();
    this.#result = undefined;
    this.#previousResult = undefined;
    this.#generation += 1;
  }
}

function remapOffset(
  offset: number,
  editStart: number,
  editEnd: number,
  delta: number,
): number {
  if (offset <= editStart) return offset;
  if (offset >= editEnd) return offset + delta;
  return editStart + Math.max(0, delta + (editEnd - editStart));
}

function renderCodeLine(
  line: string,
  prefix: string,
  available: number,
  wrap = false,
  folded = false,
): readonly string[] {
  if (folded) {
    return [
      `${prefix}${sliceTerminalText(line, 0, Math.max(0, available - 1))}…`,
    ];
  }
  if (!wrap) return [`${prefix}${sliceTerminalText(line, 0, available)}`];
  const lines = wrapTerminalText(line, available);
  return lines.map(
    (entry, index) =>
      `${index === 0 ? prefix : " ".repeat(terminalTextWidth(prefix))}${entry}`,
  );
}
