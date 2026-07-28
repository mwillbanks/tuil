import { createGlobalSearchExpression } from "@mwillbanks/tuil-core";
import {
  type EditorChange,
  type EditorCommand,
  type EditorDecoration,
  type EditorDiagnostic,
  type EditorPosition,
  type EditorProvider,
  type EditorProviderOptions,
  type EditorRange,
  type EditorSelection,
  type EditorSession,
  type EditorSnapshot,
  type EditorTransaction,
  position,
  selection,
} from "./index";
import {
  cutSelections,
  executeClipboardCommand,
  pasteSelections,
} from "./session-commands";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

interface HistoryEntry {
  readonly text: string;
  readonly selections: readonly EditorSelection[];
}

function graphemes(value: string): readonly string[] {
  return Object.freeze(
    [...graphemeSegmenter.segment(value)].map((segment) => segment.segment),
  );
}

function maskText(value: string): string {
  return value
    .split("\n")
    .map((line) => "•".repeat(graphemes(line).length))
    .join("\n");
}

function starts(value: string): readonly number[] {
  const result = [0];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\n") result.push(index + 1);
  }
  return result;
}

function clamp(value: string, target: EditorPosition): EditorPosition {
  const lines = value.split("\n");
  const line = Math.min(
    Math.max(0, target.line),
    Math.max(0, lines.length - 1),
  );
  return position(
    line,
    Math.min(Math.max(0, target.column), graphemes(lines[line] ?? "").length),
  );
}

function offsetAt(value: string, target: EditorPosition): number {
  const safe = clamp(value, target);
  return (
    (starts(value)[safe.line] ?? 0) +
    graphemes(value.split("\n")[safe.line] ?? "")
      .slice(0, safe.column)
      .join("").length
  );
}

function positionAt(value: string, offset: number): EditorPosition {
  const safe = Math.max(0, Math.min(value.length, offset));
  const lineStarts = starts(value);
  let line = 0;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if ((lineStarts[index] ?? 0) <= safe) line = index;
    else break;
  }
  return position(
    line,
    graphemes(value.slice(lineStarts[line] ?? 0, safe)).length,
  );
}

function offsets(value: string, range: EditorRange): [number, number] {
  const anchor = offsetAt(value, range.anchor);
  const head = offsetAt(value, range.head);
  return anchor <= head ? [anchor, head] : [head, anchor];
}

function freezeSelections(
  value: string,
  items: readonly EditorSelection[],
): readonly EditorSelection[] {
  return Object.freeze(
    items.map((item, index) =>
      selection(
        clamp(value, item.anchor),
        clamp(value, item.head),
        item.primary ?? index === 0,
      ),
    ),
  );
}

export class TextBufferSession implements EditorSession {
  readonly #id: string;
  readonly #type: string;
  readonly #readOnly: boolean;
  readonly #masked: boolean;
  readonly #clipboard?: EditorProviderOptions["clipboard"];
  readonly #onDocumentChange?: EditorProviderOptions["onDocumentChange"];
  readonly #observers = new Set<(snapshot: EditorSnapshot) => void>();
  readonly #undo: HistoryEntry[] = [];
  readonly #redo: HistoryEntry[] = [];
  #text: string;
  #version = 0;
  #selections: readonly EditorSelection[];
  #decorations: readonly EditorDecoration[] = [];
  #diagnostics: readonly EditorDiagnostic[] = [];
  #mode: string;
  #viewportAnchor?: EditorPosition;
  #disposed = false;

  constructor(options: EditorProviderOptions = {}) {
    this.#id = options.id ?? "document";
    this.#type = options.documentType ?? "text/plain";
    this.#text = options.value ?? "";
    this.#readOnly = options.readOnly ?? false;
    this.#masked = options.masked ?? false;
    this.#clipboard = options.clipboard;
    this.#onDocumentChange = options.onDocumentChange;
    this.#mode = options.mode ?? "insert";
    this.#viewportAnchor = options.viewportAnchor;
    this.#selections = [selection(position(0, 0))];
  }

  snapshot(): EditorSnapshot {
    return Object.freeze({
      document: Object.freeze({
        id: this.#id,
        type: this.#type,
        version: this.#version,
        text: this.#exportText(),
      }),
      selections: this.#selections,
      decorations: this.#decorations,
      diagnostics: this.#diagnostics,
      mode: this.#mode,
      readOnly: this.#readOnly,
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      viewportAnchor: this.#viewportAnchor,
    });
  }

  dispatch(transaction: EditorTransaction): EditorSnapshot {
    this.#assertActive();
    const changes = [...(transaction.changes ?? [])];
    if (changes.length > 0 && this.#readOnly) {
      throw new Error("Editor session is read-only");
    }
    this.#recordTransactionHistory(changes, transaction.addToHistory);
    const edits = prepareEdits(this.#text, changes);
    this.#text = applyEdits(this.#text, edits);
    this.#applyTransactionSelection(edits, transaction.selections);
    if (changes.length > 0 || transaction.selections) this.#version += 1;
    if (changes.length > 0) this.#onDocumentChange?.(this.#text);
    this.#notify();
    return this.snapshot();
  }

  #recordTransactionHistory(
    changes: readonly EditorChange[],
    addToHistory: boolean | undefined,
  ): void {
    if (changes.length === 0 || addToHistory === false) return;
    this.#undo.push({ text: this.#text, selections: this.#selections });
    this.#redo.length = 0;
  }

  #applyTransactionSelection(
    edits: readonly PreparedEdit[],
    selections: readonly EditorSelection[] | undefined,
  ): void {
    if (selections) {
      this.#selections = freezeSelections(this.#text, selections);
      return;
    }
    if (edits.length === 0) return;
    this.#selections = edits
      .toSorted((left, right) => left.index - right.index)
      .map((edit) => {
        const precedingDelta = edits
          .filter((candidate) => candidate.offsets[0] < edit.offsets[0])
          .reduce(
            (total, candidate) =>
              total +
              candidate.change.insert.length -
              (candidate.offsets[1] - candidate.offsets[0]),
            0,
          );
        return selection(
          positionAt(
            this.#text,
            edit.offsets[0] + edit.change.insert.length + precedingDelta,
          ),
        );
      });
  }

  execute(
    command: string | EditorCommand,
    argument?: unknown,
  ): boolean | Promise<boolean> {
    this.#assertActive();
    if (typeof command !== "string") return command.execute(this, argument);
    const clipboard = executeClipboardCommand(this, command, argument);
    if (clipboard !== undefined) return clipboard;
    return this.#executeSelectionCommand(command);
  }

  #executeSelectionCommand(command: string): boolean {
    if (command === "select-all") {
      this.#selections = [
        selection(position(0, 0), positionAt(this.#text, this.#text.length)),
      ];
    } else if (command === "delete-selection") {
      this.dispatch({
        changes: this.#selections.map((range) => ({ range, insert: "" })),
      });
      return true;
    } else if (command === "cursor-start") {
      this.dispatch({
        selections: [selection(position(0, 0))],
        addToHistory: false,
      });
      return true;
    } else if (command === "cursor-end") {
      this.dispatch({
        selections: [selection(positionAt(this.#text, this.#text.length))],
        addToHistory: false,
      });
      return true;
    } else {
      return false;
    }
    this.#notify();
    return true;
  }

  copy(): string | Promise<string> {
    this.#assertActive();
    const copied = this.#selections
      .map((range) => {
        const [start, end] = offsets(this.#text, range);
        const value = this.#text.slice(start, end);
        return this.#masked ? maskText(value) : value;
      })
      .join("\n");
    if (!this.#clipboard) return copied;
    return Promise.resolve(this.#clipboard.write(copied)).then(() => copied);
  }

  cut(): string | Promise<string> {
    return cutSelections(this, this.copy());
  }

  paste(value?: string): boolean | Promise<boolean> {
    return pasteSelections(this, this.#clipboard, value);
  }

  undo(): boolean {
    return this.#restoreHistory(this.#undo, this.#redo);
  }

  redo(): boolean {
    return this.#restoreHistory(this.#redo, this.#undo);
  }

  #restoreHistory(
    source: HistoryEntry[],
    destination: HistoryEntry[],
  ): boolean {
    this.#assertActive();
    const entry = source.pop();
    if (!entry) return false;
    destination.push({ text: this.#text, selections: this.#selections });
    this.#text = entry.text;
    this.#selections = entry.selections;
    this.#version += 1;
    this.#onDocumentChange?.(this.#text);
    this.#notify();
    return true;
  }

  search(query: string | RegExp): readonly EditorRange[] {
    this.#assertActive();
    if (typeof query === "string" && query.length === 0) return [];
    const expression = createGlobalSearchExpression(query);
    const ranges: EditorRange[] = [];
    for (const match of this.#text.matchAll(expression)) {
      ranges.push(
        Object.freeze({
          anchor: positionAt(this.#text, match.index),
          head: positionAt(this.#text, match.index + match[0].length),
        }),
      );
      if (match[0].length === 0) expression.lastIndex += 1;
    }
    return Object.freeze(ranges);
  }

  replace(query: string | RegExp, replacement: string, all = true): number {
    const ranges = this.search(query);
    const selected = all ? ranges : ranges.slice(0, 1);
    if (selected.length === 0) return 0;
    this.dispatch({
      changes: selected.map((range) => ({
        range,
        insert: replacement,
      })),
    });
    return selected.length;
  }

  serialize(format: "text" | "json" | "markdown" = "text"): string {
    const text = this.#exportText();
    return format === "json"
      ? JSON.stringify(
          this.#masked
            ? { type: this.#type, text, masked: true }
            : { type: this.#type, text },
        )
      : text;
  }

  #exportText(): string {
    return this.#masked ? maskText(this.#text) : this.#text;
  }

  subscribe(observer: (snapshot: EditorSnapshot) => void): () => void {
    this.#assertActive();
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  setDecorations(decorations: readonly EditorDecoration[]): void {
    this.#decorations = Object.freeze([...decorations]);
    this.#notify();
  }

  setDiagnostics(diagnostics: readonly EditorDiagnostic[]): void {
    this.#diagnostics = Object.freeze([...diagnostics]);
    this.#notify();
  }

  setMode(mode: string): void {
    this.#mode = mode;
    this.#notify();
  }

  setViewportAnchor(anchor: EditorPosition): void {
    this.#viewportAnchor = clamp(this.#text, anchor);
    this.#notify();
  }

  dispose(): void {
    this.#disposed = true;
    this.#observers.clear();
    this.#undo.length = 0;
    this.#redo.length = 0;
  }

  #notify(): void {
    const snapshot = this.snapshot();
    for (const observer of this.#observers) observer(snapshot);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Editor session is disposed");
  }
}

interface PreparedEdit {
  readonly index: number;
  readonly change: EditorChange;
  readonly offsets: readonly [number, number];
}

function prepareEdits(
  text: string,
  changes: readonly EditorChange[],
): readonly PreparedEdit[] {
  const edits = changes
    .map((change, index) => ({
      index,
      change,
      offsets: offsets(text, change.range),
    }))
    .sort((left, right) => right.offsets[0] - left.offsets[0]);
  for (let index = 1; index < edits.length; index += 1) {
    const previous = edits[index - 1];
    const current = edits[index];
    if (previous && current && current.offsets[1] > previous.offsets[0]) {
      throw new Error("Editor transaction changes cannot overlap");
    }
  }
  return edits;
}

function applyEdits(text: string, edits: readonly PreparedEdit[]): string {
  let result = text;
  for (const edit of edits) {
    result =
      result.slice(0, edit.offsets[0]) +
      edit.change.insert +
      result.slice(edit.offsets[1]);
  }
  return result;
}

export const textBufferProvider: EditorProvider = Object.freeze({
  id: "tuil-buffer",
  version: "1",
  capabilities: new Set([
    "single-line",
    "multiline",
    "multiple-selections",
    "history",
    "search",
    "replace",
    "decorations",
    "diagnostics",
    "clipboard",
    "masked",
    "static",
  ] as const),
  documentTypes: [
    "text/plain",
    "text/markdown",
    "text/code",
    "application/query",
  ],
  staticModes: ["static", "json", "silent"],
  create: (options: EditorProviderOptions) => new TextBufferSession(options),
});

export function insertText(
  session: EditorSession,
  value: string,
): EditorSnapshot {
  const changes: EditorChange[] = session
    .snapshot()
    .selections.map((range) => ({ range, insert: value }));
  return session.dispatch({ changes });
}
