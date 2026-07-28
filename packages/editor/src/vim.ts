import { insertText, TextBufferSession } from "./buffer";
import {
  type EditorPosition,
  type EditorRange,
  position,
  selection,
} from "./index";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export type VimMode =
  | "normal"
  | "insert"
  | "visual"
  | "visual-line"
  | "operator-pending"
  | "command-line";

export interface VimKeymap {
  readonly [sequence: string]: string;
}

export interface VimState {
  readonly mode: VimMode;
  readonly count: number;
  readonly pendingOperator?: "delete" | "change" | "yank";
  readonly commandLine: string;
  readonly registers: Readonly<Record<string, string>>;
  readonly marks: Readonly<Record<string, EditorPosition>>;
}

interface VimMotionState {
  readonly cursor: EditorPosition;
  readonly lines: readonly string[];
  readonly count: number;
}

function normalizeNormalKey(key: string): string {
  const aliases: Readonly<Record<string, string>> = {
    left: "h",
    right: "l",
    up: "k",
    down: "j",
  };
  return aliases[key] ?? key;
}

function lineGraphemes(value: string): readonly string[] {
  return [...graphemeSegmenter.segment(value)].map((entry) => entry.segment);
}

function removeLastGrapheme(value: string): string {
  return lineGraphemes(value).slice(0, -1).join("");
}

function codeUnitToColumn(value: string, offset: number): number {
  return lineGraphemes(value.slice(0, offset)).length;
}

function documentOffset(value: string, target: EditorPosition): number {
  const lines = value.split("\n");
  const line = Math.max(0, Math.min(target.line, lines.length - 1));
  const before = lines
    .slice(0, line)
    .reduce((sum, entry) => sum + entry.length + 1, 0);
  return (
    before +
    lineGraphemes(lines[line] ?? "")
      .slice(0, Math.max(0, target.column))
      .join("").length
  );
}

export class VimEditorSession extends TextBufferSession {
  readonly #registers = new Map<string, string>();
  readonly #marks = new Map<string, EditorPosition>();
  readonly #keymap: VimKeymap;
  #mode: VimMode = "normal";
  #count = "";
  #pendingOperator?: "delete" | "change" | "yank";
  #commandLine = "";
  #lastInsert = "";
  #currentInsert = "";
  #markPending = false;
  #jumpPending = false;
  #registerPending = false;
  #activeRegister = '"';
  #lastSearch = "";
  #leaderPending = false;
  readonly #leader: string;

  constructor(
    options: ConstructorParameters<typeof TextBufferSession>[0] & {
      readonly keymap?: VimKeymap;
      readonly leader?: string;
    } = {},
  ) {
    super({ ...options, mode: "normal" });
    this.#keymap = Object.freeze({ ...options.keymap });
    this.#leader = options.leader ?? "\\";
  }

  vimState(): VimState {
    return Object.freeze({
      mode: this.#mode,
      count: Number(this.#count || "1"),
      pendingOperator: this.#pendingOperator,
      commandLine: this.#commandLine,
      registers: Object.freeze(Object.fromEntries(this.#registers)),
      marks: Object.freeze(Object.fromEntries(this.#marks)),
    });
  }

  key(input: string): boolean {
    let key = this.#keymap[input] ?? input;
    if (this.#mode === "insert") return this.#insertKey(key);
    key = normalizeNormalKey(key);
    if (this.#mode === "command-line") return this.#commandKey(key);
    return this.#normalKey(key);
  }

  #normalKey(initialKey: string): boolean {
    let key = initialKey;
    const leaderKey = this.#resolveLeaderKey(key);
    if (leaderKey === undefined) return true;
    key = leaderKey;
    if (this.#consumeCount(key)) return true;
    if (this.#resolvePendingKey(key)) return true;
    const state = this.#resolveStateKey(key);
    if (state !== undefined) return state;
    const operator = this.#resolveOperatorKey(key);
    return operator ?? this.#resolveMotionKey(key);
  }

  #consumeCount(key: string): boolean {
    const countKey =
      /^[1-9]$/.test(key) || (Boolean(this.#count) && key === "0");
    if (!countKey) return false;
    this.#count += key;
    return true;
  }

  #insertKey(key: string): boolean {
    if (key === "escape") {
      if (this.#currentInsert) this.#lastInsert = this.#currentInsert;
      return this.#setMode("normal");
    }
    if (key === "backspace") {
      this.#currentInsert = removeLastGrapheme(this.#currentInsert);
      return this.#backspace();
    }
    if (["left", "right", "up", "down", "enter"].includes(key)) return false;
    insertText(this, key);
    this.#currentInsert += key;
    return true;
  }

  #resolveLeaderKey(key: string): string | undefined {
    if (this.#leaderPending) {
      this.#leaderPending = false;
      return this.#keymap[`${this.#leader}${key}`] ?? key;
    }
    if (key !== this.#leader) return key;
    this.#leaderPending = true;
    return undefined;
  }

  #resolvePendingKey(key: string): boolean {
    if (key.length !== 1) return false;
    if (this.#markPending) {
      const cursor = this.snapshot().selections[0]?.head;
      if (cursor) this.#marks.set(key, cursor);
      this.#markPending = false;
      return true;
    }
    if (this.#jumpPending) {
      const mark = this.#marks.get(key);
      if (mark) {
        this.dispatch({ selections: [selection(mark)], addToHistory: false });
      }
      this.#jumpPending = false;
      return true;
    }
    if (!this.#registerPending) return false;
    this.#activeRegister = key;
    this.#registerPending = false;
    return true;
  }

  #resolveStateKey(key: string): boolean | undefined {
    const mode = this.#resolveModeKey(key);
    if (mode !== undefined) return mode;
    const prefix = this.#resolvePrefixKey(key);
    if (prefix !== undefined) return prefix;
    return this.#resolveActionKey(key);
  }

  #resolveModeKey(key: string): boolean | undefined {
    const modes: Readonly<Record<string, VimMode>> = {
      i: "insert",
      v: "visual",
      V: "visual-line",
    };
    const mode = modes[key];
    if (mode) {
      if (mode === "insert") this.#currentInsert = "";
      if (mode === "visual" || mode === "visual-line") {
        this.#selectVisualUnit(mode);
      }
      return this.#setMode(mode);
    }
    return undefined;
  }

  #resolvePrefixKey(key: string): boolean | undefined {
    const pending: Readonly<Record<string, () => void>> = {
      m: () => {
        this.#markPending = true;
      },
      "'": () => {
        this.#jumpPending = true;
      },
      '"': () => {
        this.#registerPending = true;
      },
    };
    const action = pending[key];
    if (action) {
      action();
      return true;
    }
    if (key === ":" || key === "/") {
      this.#commandLine = key;
      return this.#setMode("command-line");
    }
    return undefined;
  }

  #resolveActionKey(key: string): boolean | undefined {
    const actions: Readonly<Record<string, () => boolean>> = {
      escape: () => this.#cancel(),
      u: () => this.undo(),
      "ctrl+r": () => this.redo(),
      p: () => this.#paste(),
    };
    const action = actions[key];
    if (action) return action();
    if (key === "n" && this.#lastSearch) return this.#nextSearch();
    if (key === "." && this.#lastInsert) {
      insertText(this, this.#lastInsert);
      return true;
    }
    return undefined;
  }

  #resolveOperatorKey(key: string): boolean | undefined {
    const operators = {
      d: "delete",
      c: "change",
      y: "yank",
    } as const;
    const operator = operators[key as keyof typeof operators];
    if (!operator) return undefined;
    if (this.#mode === "visual" || this.#mode === "visual-line") {
      return this.#visualOperator(operator);
    }
    if (this.#pendingOperator === operator) return this.#lineOperator(operator);
    this.#pendingOperator = operator;
    return this.#setMode("operator-pending", false);
  }

  #resolveMotionKey(key: string): boolean {
    return ["h", "j", "k", "l", "w", "b", "0", "$"].includes(key)
      ? this.#motion(key)
      : false;
  }

  #paste(): boolean {
    const value =
      this.#registers.get(this.#activeRegister) ??
      this.#registers.get('"') ??
      "";
    if (!value) return false;
    insertText(this, value);
    return true;
  }

  #nextSearch(): boolean {
    const cursor = this.snapshot().selections[0]?.head ?? position(0, 0);
    const matches = this.search(this.#lastSearch);
    const match =
      matches.find(
        (range) =>
          range.anchor.line > cursor.line ||
          (range.anchor.line === cursor.line &&
            range.anchor.column > cursor.column),
      ) ?? matches[0];
    if (match) {
      this.dispatch({
        selections: [selection(match.anchor, match.head)],
        addToHistory: false,
      });
    }
    return true;
  }

  #setMode(mode: VimMode, clear = true): boolean {
    this.#mode = mode;
    if (clear && mode !== "operator-pending") {
      this.#pendingOperator = undefined;
    }
    super.setMode(mode);
    return true;
  }

  #cancel(): boolean {
    this.#count = "";
    this.#pendingOperator = undefined;
    this.#commandLine = "";
    this.#markPending = false;
    this.#jumpPending = false;
    this.#registerPending = false;
    this.#leaderPending = false;
    return this.#setMode("normal");
  }

  #motion(key: string): boolean {
    const snapshot = this.snapshot();
    const { cursor, lines, count } = this.#motionState();
    const next = this.#motionTarget(key, cursor, lines, count);
    const current = snapshot.selections[0];
    const range = this.#pendingOperator
      ? selection(cursor, next)
      : this.#mode === "visual-line"
        ? selection(
            position(current?.anchor.line ?? cursor.line, 0),
            position(next.line, lineGraphemes(lines[next.line] ?? "").length),
          )
        : this.#mode === "visual"
          ? selection(current?.anchor ?? cursor, next)
          : selection(next);
    if (this.#pendingOperator) {
      this.#operator(this.#pendingOperator, range);
    } else {
      this.dispatch({ selections: [range], addToHistory: false });
    }
    this.#count = "";
    return true;
  }

  #motionTarget(
    key: string,
    cursor: EditorPosition,
    lines: readonly string[],
    count: number,
  ): EditorPosition {
    const offsets: Readonly<Record<string, readonly [number, number]>> = {
      h: [0, -count],
      l: [0, count],
      j: [count, 0],
      k: [-count, 0],
    };
    const offset = offsets[key];
    if (offset) {
      return position(cursor.line + offset[0], cursor.column + offset[1]);
    }
    if (key === "0") return position(cursor.line, 0);
    const line = lines[cursor.line] ?? "";
    const width = lineGraphemes(line).length;
    if (key === "$") return position(cursor.line, width);
    const boundaries = [...line.matchAll(/\w+/gu)].map((match) =>
      codeUnitToColumn(line, match.index),
    );
    const column =
      key === "w"
        ? (boundaries.find((value) => value > cursor.column) ?? width)
        : ([...boundaries].reverse().find((value) => value < cursor.column) ??
          0);
    return position(cursor.line, column);
  }

  #operator(operator: "delete" | "change" | "yank", range: EditorRange): void {
    const value = this.#selectedText(range);
    this.#registers.set('"', value);
    this.#registers.set(this.#activeRegister, value);
    this.#activeRegister = '"';
    if (operator !== "yank") {
      this.dispatch({ changes: [{ range, insert: "" }] });
    } else {
      this.dispatch({
        selections: [selection(range.anchor)],
        addToHistory: false,
      });
    }
    if (operator === "change") this.#currentInsert = "";
    this.#setMode(operator === "change" ? "insert" : "normal");
  }

  #visualOperator(operator: "delete" | "change" | "yank"): boolean {
    const range = this.snapshot().selections[0];
    if (!range) return false;
    this.#operator(operator, range);
    this.#count = "";
    return true;
  }

  #selectVisualUnit(mode: "visual" | "visual-line"): void {
    const { cursor, lines } = this.#motionState();
    const lineWidth = lineGraphemes(lines[cursor.line] ?? "").length;
    const range =
      mode === "visual-line"
        ? {
            anchor: position(cursor.line, 0),
            head:
              cursor.line < lines.length - 1
                ? position(cursor.line + 1, 0)
                : position(cursor.line, lineWidth),
          }
        : {
            anchor: cursor,
            head: position(cursor.line, Math.min(lineWidth, cursor.column + 1)),
          };
    this.dispatch({ selections: [selection(range.anchor, range.head)] });
  }

  #lineOperator(operator: "delete" | "change" | "yank"): boolean {
    const { cursor, lines, count } = this.#motionState();
    const end = Math.min(lines.length - 1, cursor.line + count - 1);
    const nextLine = end < lines.length - 1;
    this.#operator(operator, {
      anchor: position(cursor.line, 0),
      head: position(
        nextLine ? end + 1 : end,
        nextLine ? 0 : lineGraphemes(lines[end] ?? "").length,
      ),
    });
    this.#count = "";
    return true;
  }

  #motionState(): VimMotionState {
    const snapshot = this.snapshot();
    return {
      cursor: snapshot.selections[0]?.head ?? position(0, 0),
      lines: snapshot.document.text.split("\n"),
      count: Number(this.#count || "1"),
    };
  }

  #selectedText(range: EditorRange): string {
    const value = this.serialize();
    const anchor = documentOffset(value, range.anchor);
    const head = documentOffset(value, range.head);
    return value.slice(Math.min(anchor, head), Math.max(anchor, head));
  }

  #backspace(): boolean {
    const cursor = this.snapshot().selections[0]?.head;
    if (!cursor || cursor.column === 0) return false;
    this.dispatch({
      changes: [
        {
          range: {
            anchor: position(cursor.line, cursor.column - 1),
            head: cursor,
          },
          insert: "",
        },
      ],
    });
    return true;
  }

  #commandKey(key: string): boolean {
    if (key === "escape") return this.#cancel();
    if (key === "enter") {
      if (this.#commandLine.startsWith("/")) {
        this.#lastSearch = this.#commandLine.slice(1);
        const match = this.search(this.#lastSearch)[0];
        if (match) {
          this.dispatch({
            selections: [selection(match.anchor, match.head)],
            addToHistory: false,
          });
        }
      } else if (this.#commandLine === ":undo") {
        this.undo();
      } else if (this.#commandLine === ":redo") {
        this.redo();
      }
      this.#commandLine = "";
      return this.#setMode("normal");
    }
    this.#commandLine =
      key === "backspace"
        ? this.#commandLine.slice(0, -1)
        : this.#commandLine + key;
    return true;
  }
}

export const vimEditorProvider = Object.freeze({
  id: "tuil-vim",
  version: "1",
  capabilities: new Set([
    "multiline",
    "history",
    "search",
    "replace",
    "clipboard",
    "vim",
    "static",
  ] as const),
  documentTypes: [
    "text/plain",
    "text/markdown",
    "text/code",
    "application/query",
  ],
  create: (options: ConstructorParameters<typeof VimEditorSession>[0]) =>
    new VimEditorSession(options),
});
