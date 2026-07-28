import { wrapTerminalText } from "@mwillbanks/tuil-core";
import { TextBufferSession } from "./buffer";
import type {
  EditorCapability,
  EditorChange,
  EditorCommand,
  EditorProvider,
  EditorProviderOptions,
  EditorRange,
  EditorSelection,
  EditorSession,
  EditorSnapshot,
  EditorTransaction,
} from "./index";
import {
  cutSelections,
  executeClipboardCommand,
  pasteSelections,
} from "./session-commands";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export type BuiltInRichNodeType =
  | "document"
  | "paragraph"
  | "heading"
  | "text"
  | "bullet-list"
  | "ordered-list"
  | "list-item"
  | "link"
  | "code-block"
  | "table"
  | "table-row"
  | "table-cell";

export type RichNodeType = BuiltInRichNodeType | (string & {});

export interface RichMark {
  readonly [key: string]: unknown;
  readonly type: "bold" | "italic" | "code" | "strike" | "link" | (string & {});
  readonly attributes?: Readonly<Record<string, string>>;
}

export interface RichNode {
  readonly [key: string]: unknown;
  readonly type: RichNodeType;
  readonly text?: string;
  readonly level?: number;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly marks?: readonly RichMark[];
  readonly children?: readonly RichNode[];
}

export interface RichDocument {
  readonly version: number;
  readonly root: RichNode;
}

export interface RichTransaction {
  readonly path: readonly number[];
  readonly node?: RichNode;
  readonly remove?: boolean;
}

export interface RichNodeProvider {
  readonly type: string;
  validate?(node: RichNode): void;
  text?(node: RichNode, children: string): string;
  markdown?(node: RichNode, children: string): string;
}

export interface RichEditorProviderOptions {
  readonly nodes?: readonly RichNodeProvider[];
}

const richNodeTypes = new Set<BuiltInRichNodeType>([
  "document",
  "paragraph",
  "heading",
  "text",
  "bullet-list",
  "ordered-list",
  "list-item",
  "link",
  "code-block",
  "table",
  "table-row",
  "table-cell",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function richNodeRecord(value: unknown): Record<string, unknown> {
  if (
    !isRecord(value) ||
    typeof value["type"] !== "string" ||
    value["type"].trim().length === 0
  ) {
    throw new Error("Rich editor changes must preserve non-empty node types");
  }
  return value;
}

function validateTextField(value: Record<string, unknown>): void {
  if (value["text"] !== undefined && typeof value["text"] !== "string") {
    throw new Error("Rich editor text nodes must contain strings");
  }
}

function validateLevelField(value: Record<string, unknown>): void {
  if (
    value["level"] !== undefined &&
    (!Number.isSafeInteger(value["level"]) ||
      (value["level"] as number) < 1 ||
      (value["level"] as number) > 6)
  ) {
    throw new Error("Rich editor heading levels must be between 1 and 6");
  }
}

function validateArrayField(
  value: Record<string, unknown>,
  field: "children" | "marks",
): void {
  if (value[field] !== undefined && !Array.isArray(value[field])) {
    throw new Error(`Rich editor node ${field} must be an array`);
  }
}

function validateAttributesField(value: Record<string, unknown>): void {
  if (value["attributes"] !== undefined && !isRecord(value["attributes"])) {
    throw new Error("Rich editor node attributes must be an object");
  }
}

function validateRichNodeFields(value: Record<string, unknown>): void {
  validateTextField(value);
  validateLevelField(value);
  validateArrayField(value, "children");
  validateArrayField(value, "marks");
  validateAttributesField(value);
}

function validateRichMark(mark: unknown): RichMark {
  if (
    !isRecord(mark) ||
    typeof mark["type"] !== "string" ||
    mark["type"].trim().length === 0
  ) {
    throw new Error("Rich editor changes must preserve non-empty marks");
  }
  if (mark["attributes"] !== undefined && !isRecord(mark["attributes"])) {
    throw new Error("Rich editor mark attributes must be an object");
  }
  return mark as unknown as RichMark;
}

function validateRichNode(
  value: unknown,
  providers: ReadonlyMap<string, RichNodeProvider>,
): RichNode {
  const record = richNodeRecord(value);
  validateRichNodeFields(record);
  const node = {
    ...(record as unknown as RichNode),
    marks: (record["marks"] as unknown[] | undefined)?.map(validateRichMark),
    children: (record["children"] as unknown[] | undefined)?.map((child) =>
      validateRichNode(child, providers),
    ),
  };
  providers.get(node.type)?.validate?.(node);
  return node;
}

function freezeNode(node: RichNode): RichNode {
  return Object.freeze({
    ...node,
    attributes: node.attributes
      ? Object.freeze({ ...node.attributes })
      : undefined,
    marks: node.marks
      ? Object.freeze(node.marks.map((mark) => Object.freeze({ ...mark })))
      : undefined,
    children: node.children
      ? Object.freeze(node.children.map(freezeNode))
      : undefined,
  });
}

function invalidRichPath(path: readonly number[]): Error {
  return new Error(`Rich document path ${path.join(".")} is invalid`);
}

function richNodeProviderMap(
  providers: readonly RichNodeProvider[] = [],
): ReadonlyMap<string, RichNodeProvider> {
  const result = new Map<string, RichNodeProvider>();
  for (const provider of providers) {
    if (!provider.type.trim()) {
      throw new Error("Rich node providers require a non-empty type");
    }
    if (richNodeTypes.has(provider.type as BuiltInRichNodeType)) {
      throw new Error(
        `Rich node provider "${provider.type}" cannot replace a built-in node`,
      );
    }
    if (result.has(provider.type)) {
      throw new Error(`Rich node provider "${provider.type}" is duplicated`);
    }
    result.set(provider.type, Object.freeze({ ...provider }));
  }
  return result;
}

function editRichLeaf(
  children: RichNode[],
  index: number,
  transaction: RichTransaction,
): void {
  if (transaction.remove) {
    children.splice(index, 1);
    return;
  }
  if (!children[index] || !transaction.node)
    throw invalidRichPath(transaction.path);
  children[index] = transaction.node;
}

function editRichNode(
  node: RichNode,
  transaction: RichTransaction,
  depth: number,
): RichNode {
  const index = transaction.path[depth];
  if (index === undefined) return transaction.node ?? node;
  const children = [...(node.children ?? [])];
  const leaf = depth === transaction.path.length - 1;
  if (leaf) editRichLeaf(children, index, transaction);
  else {
    const child = children[index];
    if (!child) throw invalidRichPath(transaction.path);
    children[index] = editRichNode(child, transaction, depth + 1);
  }
  return freezeNode({ ...node, children });
}

export class RichDocumentSession {
  #document: RichDocument;
  readonly #history: RichDocument[] = [];
  readonly #redo: RichDocument[] = [];
  readonly #providers: ReadonlyMap<string, RichNodeProvider>;

  constructor(
    root: RichNode = { type: "document", children: [] },
    options: RichEditorProviderOptions = {},
  ) {
    this.#providers = richNodeProviderMap(options.nodes);
    const validated = validateRichNode(root, this.#providers);
    if (validated.type !== "document") {
      throw new Error("Rich documents require a document root");
    }
    this.#document = Object.freeze({ version: 0, root: freezeNode(validated) });
  }

  snapshot(): RichDocument {
    return this.#document;
  }

  dispatch(transaction: RichTransaction): RichDocument {
    const node = transaction.node
      ? freezeNode(validateRichNode(transaction.node, this.#providers))
      : undefined;
    const validated = { ...transaction, node };
    if (transaction.path.length === 0 && transaction.node) {
      if (node?.type !== "document") {
        throw new Error("Rich documents require a document root");
      }
      this.#history.push(this.#document);
      this.#redo.length = 0;
      this.#document = Object.freeze({
        version: this.#document.version + 1,
        root: node,
      });
      return this.#document;
    }
    this.#history.push(this.#document);
    this.#redo.length = 0;
    this.#document = Object.freeze({
      version: this.#document.version + 1,
      root: editRichNode(this.#document.root, validated, 0),
    });
    return this.#document;
  }

  undo(): boolean {
    const previous = this.#history.pop();
    if (!previous) return false;
    this.#redo.push(this.#document);
    this.#document = previous;
    return true;
  }

  redo(): boolean {
    const next = this.#redo.pop();
    if (!next) return false;
    this.#history.push(this.#document);
    this.#document = next;
    return true;
  }

  serialize(format: "json" | "markdown" = "json"): string {
    return format === "json"
      ? JSON.stringify(this.#document)
      : richDocumentToMarkdown(this.#document.root, this.#providers);
  }
}

function parseRichDocument(
  value: string | undefined,
  providers: ReadonlyMap<string, RichNodeProvider>,
): RichNode {
  if (!value?.trim()) return { type: "document", children: [] };
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    candidate = undefined;
  }
  if (isRecord(candidate)) {
    const root = validateRichNode(candidate["root"] ?? candidate, providers);
    if (root.type === "document") return root;
  }
  // Markdown and plain text inputs remain valid rich documents.
  return {
    type: "document",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", text: value }],
      },
    ],
  };
}

export interface RichEditorDocument {
  snapshot(): RichDocument;
  dispatch(transaction: RichTransaction): RichDocument;
  undo(): boolean;
  redo(): boolean;
  serialize(format?: "json" | "markdown"): string;
}

interface RichTextSpan {
  readonly path: readonly number[];
  readonly start: number;
  readonly end: number;
}

interface RichTextProjection {
  readonly text: string;
  readonly spans: readonly RichTextSpan[];
}

interface RichEditorHistoryEntry {
  readonly document: RichDocument;
  readonly selections: readonly EditorSelection[];
}

const richBlockNodeTypes = new Set<RichNodeType>([
  "paragraph",
  "heading",
  "list-item",
  "code-block",
  "table-row",
]);

function projectRichText(
  root: RichNode,
  providers: ReadonlyMap<string, RichNodeProvider>,
): RichTextProjection {
  let text = "";
  const spans: RichTextSpan[] = [];
  const visit = (node: RichNode, path: readonly number[]) => {
    const start = text.length;
    const spanStart = spans.length;
    if (node.text !== undefined) {
      text += node.text;
      spans.push(Object.freeze({ path, start, end: text.length }));
    } else {
      for (const [index, child] of (node.children ?? []).entries()) {
        visit(child, [...path, index]);
      }
      const custom = providers.get(node.type)?.text?.(node, text.slice(start));
      if (custom !== undefined) {
        text = text.slice(0, start) + custom;
        spans.splice(spanStart);
      }
    }
    if (
      richBlockNodeTypes.has(node.type) &&
      !text.slice(start).endsWith("\n")
    ) {
      text += "\n";
    }
  };
  visit(root, []);
  return Object.freeze({ text, spans: Object.freeze(spans) });
}

function richPositionOffset(
  text: string,
  target: EditorRange["anchor"],
): number {
  const lines = text.split("\n");
  const line = Math.min(Math.max(0, target.line), lines.length - 1);
  const lineText = lines[line] ?? "";
  const column = Math.min(
    Math.max(0, target.column),
    [...graphemeSegmenter.segment(lineText)].length,
  );
  const lineStart = lines
    .slice(0, line)
    .reduce((total, value) => total + value.length + 1, 0);
  const value = [...graphemeSegmenter.segment(lineText)]
    .slice(0, column)
    .map((segment) => segment.segment)
    .join("");
  return lineStart + value.length;
}

function richChangeOffsets(
  text: string,
  change: EditorChange,
): readonly [number, number] {
  const anchor = richPositionOffset(text, change.range.anchor);
  const head = richPositionOffset(text, change.range.head);
  return anchor <= head ? [anchor, head] : [head, anchor];
}

function replaceRichNodeAtPath(
  node: RichNode,
  path: readonly number[],
  replacement: RichNode,
  depth = 0,
): RichNode {
  if (depth === path.length) return replacement;
  const index = path[depth];
  const children = [...(node.children ?? [])];
  if (index === undefined || !children[index]) throw invalidRichPath(path);
  children[index] = replaceRichNodeAtPath(
    children[index],
    path,
    replacement,
    depth + 1,
  );
  return freezeNode({ ...node, children });
}

function applyRichTextChange(
  root: RichNode,
  projection: RichTextProjection,
  change: EditorChange,
): RichNode {
  const [start, end] = richChangeOffsets(projection.text, change);
  const touched = richTextSpansForRange(projection.spans, start, end);
  if (touched.length === 0) {
    return applyRichTextOutsideLeaf(root, projection, change, start, end);
  }
  assertRichTextRangeIsEditable(projection.text, touched, start, end);
  return replaceRichTextSpans(root, touched, start, end, change.insert);
}

function richTextSpansForRange(
  spans: readonly RichTextSpan[],
  start: number,
  end: number,
): readonly RichTextSpan[] {
  return spans.filter(
    (span) =>
      (start === end && span.start <= start && span.end >= start) ||
      (span.start < end && span.end > start),
  );
}

function applyRichTextOutsideLeaf(
  root: RichNode,
  projection: RichTextProjection,
  change: EditorChange,
  start: number,
  end: number,
): RichNode {
  if (projection.spans.length === 0 && start === 0 && end === 0) {
    return freezeNode({
      ...root,
      children: [
        ...(root.children ?? []),
        {
          type: "paragraph",
          children: [{ type: "text", text: change.insert }],
        },
      ],
    });
  }
  throw new Error("Rich text edits require an editable text node");
}

function assertRichTextRangeIsEditable(
  text: string,
  touched: readonly RichTextSpan[],
  start: number,
  end: number,
): void {
  const first = touched[0];
  const last = touched.at(-1);
  if (!first || !last) throw new Error("Rich text range is empty");
  const editableStart = Math.max(start, first.start);
  const editableEnd = Math.min(end, last.end);
  const structuralText =
    text.slice(start, editableStart) + text.slice(editableEnd, end);
  const spanGaps = touched
    .slice(0, -1)
    .map((span, index) =>
      text.slice(span.end, touched[index + 1]?.start ?? span.end),
    )
    .join("");
  if (structuralText || spanGaps) {
    throw new Error(
      "Rich text edits cannot replace structural separators; use a rich transaction",
    );
  }
}

function replaceRichTextSpans(
  root: RichNode,
  touched: readonly RichTextSpan[],
  start: number,
  end: number,
  insert: string,
): RichNode {
  let next = root;
  for (const [index, span] of touched.entries()) {
    const current = nodeAtRichPath(next, span.path);
    const prefix =
      index === 0
        ? (current.text ?? "").slice(0, Math.max(0, start - span.start))
        : "";
    const suffix =
      index === touched.length - 1
        ? (current.text ?? "").slice(Math.max(0, end - span.start))
        : "";
    next = replaceRichNodeAtPath(next, span.path, {
      ...current,
      text: `${prefix}${index === 0 ? insert : ""}${suffix}`,
    });
  }
  return next;
}

function nodeAtRichPath(root: RichNode, path: readonly number[]): RichNode {
  let node = root;
  for (const index of path) {
    const child = node.children?.[index];
    if (!child) throw invalidRichPath(path);
    node = child;
  }
  return node;
}

/**
 * EditorSession adapter that exposes the rich document transaction model
 * with a plain-text projection for shared editor commands. The rich tree is
 * the canonical state; JSON serialization is never used as an edit buffer.
 */
export class RichEditorSession implements EditorSession {
  readonly rich: RichEditorDocument;
  readonly #view: TextBufferSession;
  readonly #clipboard?: EditorProviderOptions["clipboard"];
  readonly #providers: ReadonlyMap<string, RichNodeProvider>;
  readonly #readOnly: boolean;
  readonly #history: RichEditorHistoryEntry[] = [];
  readonly #redo: RichEditorHistoryEntry[] = [];
  #document: RichDocument;

  constructor(
    options: EditorProviderOptions,
    richOptions: RichEditorProviderOptions = {},
  ) {
    this.#providers = richNodeProviderMap(richOptions.nodes);
    const root = validateRichNode(
      parseRichDocument(options.value, this.#providers),
      this.#providers,
    );
    this.#document = Object.freeze({ version: 0, root: freezeNode(root) });
    this.#readOnly = options.readOnly ?? false;
    this.#view = new TextBufferSession({
      ...options,
      readOnly: false,
      documentType: options.documentType ?? "application/tuil-rich+json",
      value: projectRichText(root, this.#providers).text,
    });
    this.#clipboard = options.clipboard;
    this.rich = Object.freeze({
      snapshot: () => this.richSnapshot(),
      dispatch: (transaction: RichTransaction) => this.transact(transaction),
      undo: () => this.undo(),
      redo: () => this.redo(),
      serialize: (format: "json" | "markdown" = "json") =>
        this.serialize(format),
    });
  }

  richSnapshot(): RichDocument {
    return this.#document;
  }

  transact(transaction: RichTransaction): RichDocument {
    this.#assertWritable();
    const editor = new RichDocumentSession(this.#document.root, {
      nodes: [...this.#providers.values()],
    });
    const next = editor.dispatch(transaction);
    this.#recordHistory();
    this.#setDocument(next.root);
    return this.#document;
  }

  snapshot(): EditorSnapshot {
    const snapshot = this.#view.snapshot();
    return Object.freeze({
      ...snapshot,
      readOnly: this.#readOnly,
      canUndo: this.#history.length > 0,
      canRedo: this.#redo.length > 0,
    });
  }

  dispatch(transaction: EditorTransaction): EditorSnapshot {
    const changes = [...(transaction.changes ?? [])];
    if (changes.length > 0) this.#assertWritable();
    if (changes.length === 0) {
      this.#view.dispatch({ ...transaction, addToHistory: false });
      return this.snapshot();
    }
    const before = projectRichText(this.#document.root, this.#providers);
    const trial = new TextBufferSession({ value: before.text });
    const candidate = trial.dispatch(transaction);
    trial.dispose();
    let root = this.#document.root;
    const sorted = changes
      .map((change) => ({
        change,
        offset: richChangeOffsets(before.text, change)[0],
      }))
      .sort((left, right) => right.offset - left.offset);
    for (const { change } of sorted) {
      const current = projectRichText(root, this.#providers);
      root = applyRichTextChange(root, current, change);
    }
    const projected = projectRichText(root, this.#providers).text;
    if (projected !== candidate.document.text) {
      throw new Error("Rich text edit changed document structure");
    }
    if (transaction.addToHistory !== false) this.#recordHistory();
    this.#document = Object.freeze({
      version: this.#document.version + 1,
      root: freezeNode(root),
    });
    this.#replaceView(projected, candidate.selections);
    return this.snapshot();
  }

  execute(
    command: string | EditorCommand,
    argument?: unknown,
  ): boolean | Promise<boolean> {
    if (typeof command !== "string") return command.execute(this, argument);
    const clipboard = executeClipboardCommand(this, command, argument);
    if (clipboard !== undefined) return clipboard;
    if (command === "delete-selection") {
      this.dispatch({
        changes: this.snapshot().selections.map((range) => ({
          range,
          insert: "",
        })),
      });
      return true;
    }
    return this.#view.execute(command, argument);
  }

  undo(): boolean {
    return this.#restoreHistory(this.#history, this.#redo);
  }

  redo(): boolean {
    return this.#restoreHistory(this.#redo, this.#history);
  }

  search(query: string | RegExp): readonly EditorRange[] {
    return this.#view.search(query);
  }

  replace(query: string | RegExp, replacement: string, all?: boolean): number {
    const ranges = this.search(query);
    const selected = all === false ? ranges.slice(0, 1) : ranges;
    if (selected.length === 0) return 0;
    this.dispatch({
      changes: selected.map((range) => ({ range, insert: replacement })),
    });
    return selected.length;
  }

  copy(): string | Promise<string> {
    return this.#view.copy();
  }

  cut(): string | Promise<string> {
    return cutSelections(this, this.copy());
  }

  paste(value?: string): boolean | Promise<boolean> {
    return pasteSelections(this, this.#clipboard, value);
  }

  serialize(format: "text" | "json" | "markdown" = "text"): string {
    const snapshot = this.#document;
    return format === "markdown"
      ? richDocumentToMarkdown(snapshot.root, this.#providers)
      : format === "json"
        ? JSON.stringify(snapshot)
        : this.#view.serialize("text");
  }

  subscribe(observer: (snapshot: EditorSnapshot) => void): () => void {
    return this.#view.subscribe(() => observer(this.snapshot()));
  }

  dispose(): void {
    this.#view.dispose();
    this.#history.length = 0;
    this.#redo.length = 0;
  }

  #recordHistory(): void {
    this.#history.push({
      document: this.#document,
      selections: this.#view.snapshot().selections,
    });
    this.#redo.length = 0;
  }

  #assertWritable(): void {
    if (this.#readOnly) throw new Error("Editor session is read-only");
  }

  #restoreHistory(
    source: RichEditorHistoryEntry[],
    destination: RichEditorHistoryEntry[],
  ): boolean {
    const entry = source.pop();
    if (!entry) return false;
    destination.push({
      document: this.#document,
      selections: this.#view.snapshot().selections,
    });
    this.#document = entry.document;
    this.#replaceView(
      projectRichText(this.#document.root, this.#providers).text,
      entry.selections,
    );
    return true;
  }

  #setDocument(root: RichNode): void {
    this.#document = Object.freeze({
      version: this.#document.version + 1,
      root: freezeNode(root),
    });
    this.#replaceView(projectRichText(root, this.#providers).text);
  }

  #replaceView(
    value: string,
    selections = this.#view.snapshot().selections,
  ): void {
    const current = this.#view.serialize("text");
    const lines = current.split("\n");
    this.#view.dispatch({
      changes: [
        {
          range: {
            anchor: { line: 0, column: 0 },
            head: {
              line: lines.length - 1,
              column: lines.at(-1)?.length ?? 0,
            },
          },
          insert: value,
        },
      ],
      selections,
      addToHistory: false,
    });
  }
}

export function createRichEditorProvider(
  options: RichEditorProviderOptions = {},
): EditorProvider {
  const nodes = Object.freeze([...richNodeProviderMap(options.nodes).values()]);
  return Object.freeze({
    id: "tuil-rich-document",
    version: "1",
    capabilities: new Set<EditorCapability>([
      "multiline",
      "history",
      "search",
      "replace",
      "decorations",
      "diagnostics",
      "clipboard",
      "rich-document",
      "static",
    ]),
    documentTypes: [
      "application/tuil-rich+json",
      "application/json",
      "text/markdown",
    ],
    staticModes: ["static", "json", "silent"],
    create(editorOptions: EditorProviderOptions): EditorSession {
      return new RichEditorSession(editorOptions, { nodes });
    },
  });
}

export const richEditorProvider = createRichEditorProvider();

function applyMarkdownMark(value: string, mark: RichMark): string {
  if (!value) return value;
  const wrappers: Partial<Record<RichMark["type"], [string, string]>> = {
    bold: ["**", "**"],
    italic: ["_", "_"],
    code: ["`", "`"],
    strike: ["~~", "~~"],
  };
  const wrapper = wrappers[mark.type];
  if (wrapper) return `${wrapper[0]}${value}${wrapper[1]}`;
  return mark.type === "link"
    ? `[${value}](${mark.attributes?.["href"] ?? ""})`
    : value;
}

export function richDocumentToMarkdown(
  node: RichNode,
  providers: ReadonlyMap<string, RichNodeProvider> = new Map(),
): string {
  const children = (node.children ?? [])
    .map((child) => richDocumentToMarkdown(child, providers))
    .join("");
  const formatters: Readonly<
    Record<string, (current: RichNode, content: string) => string>
  > = {
    document: (_current, content) => content,
    paragraph: (_current, content) => `${content}\n\n`,
    heading: (current, content) =>
      `${"#".repeat(current.level ?? 1)} ${content}\n\n`,
    text: (current) =>
      (current.marks ?? []).reduce(applyMarkdownMark, current.text ?? ""),
    "list-item": (_current, content) => `- ${content.trim()}\n`,
    "code-block": (current, content) =>
      `\`\`\`${current.attributes?.["language"] ?? ""}\n${current.text ?? content}\n\`\`\`\n\n`,
    table: (_current, content) => `${content}\n`,
    "table-row": (_current, content) => `|${content}|\n`,
    "table-cell": (_current, content) => ` ${content.trim()} |`,
  };
  const builtIn = formatters[node.type];
  if (builtIn) return builtIn(node, children);
  return providers.get(node.type)?.markdown?.(node, children) ?? children;
}

export function projectRichDocument(
  node: RichNode,
  width = 80,
): readonly string[] {
  if (!Number.isSafeInteger(width) || width < 1) {
    throw new TypeError("Rich document width must be a positive integer");
  }
  const lines: string[] = [];
  for (const source of richDocumentToMarkdown(node).split("\n")) {
    lines.push(...wrapTerminalText(source, width));
  }
  return Object.freeze(lines);
}
