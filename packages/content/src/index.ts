import type {
  DocumentNode,
  PartialDocument,
  RenderProjection,
} from "@mwillbanks/tuil-streaming";

export interface TreeRow {
  readonly path: string;
  readonly depth: number;
  readonly key: string;
  readonly type: string;
  readonly value?: unknown;
  readonly expandable: boolean;
  readonly expanded: boolean;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function flattenValue(
  value: unknown,
  expanded: ReadonlySet<string>,
  path = "$",
  depth = 0,
  key = "$",
  seen = new WeakSet<object>(),
): TreeRow[] {
  const expandable = value !== null && typeof value === "object";
  const rows: TreeRow[] = [
    Object.freeze({
      path,
      depth,
      key,
      type: typeOf(value),
      value: expandable ? undefined : value,
      expandable,
      expanded: expandable && expanded.has(path),
    }),
  ];
  if (!expandable || !expanded.has(path)) return rows;
  const object = value as object;
  if (seen.has(object)) return rows;
  seen.add(object);
  for (const [childKey, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    rows.push(
      ...flattenValue(
        child,
        expanded,
        childPath(path, childKey, Array.isArray(value)),
        depth + 1,
        childKey,
        seen,
      ),
    );
  }
  return rows;
}

export class StructuredContentModel {
  readonly #value: unknown;
  readonly #expanded = new Set<string>();
  readonly #selected = new Set<string>();
  readonly #renderers: readonly {
    readonly test: (value: unknown, path: string) => boolean;
    readonly render: (value: unknown, path: string) => string;
  }[];

  constructor(
    value: unknown,
    expandRoot = true,
    renderers: readonly {
      readonly test: (value: unknown, path: string) => boolean;
      readonly render: (value: unknown, path: string) => string;
    }[] = [],
  ) {
    this.#value = value;
    this.#renderers = Object.freeze([...renderers]);
    if (expandRoot) this.#expanded.add("$");
  }

  rows(): readonly TreeRow[] {
    return Object.freeze(flattenValue(this.#value, this.#expanded));
  }

  viewport(offset: number, size: number): readonly TreeRow[] {
    const start = Math.max(0, Math.floor(offset));
    return Object.freeze(
      this.rows().slice(start, start + Math.max(0, Math.floor(size))),
    );
  }

  format(path: string): string {
    const value = resolveJsonPath(this.#value, path);
    const renderer = this.#renderers.find((item) => item.test(value, path));
    if (renderer) return renderer.render(value, path);
    if (typeof value === "string") return value;
    return cycleSafeStringify(value);
  }

  toggle(path: string): void {
    if (this.#expanded.has(path)) this.#expanded.delete(path);
    else this.#expanded.add(path);
  }

  expandAll(): void {
    const seen = new WeakSet<object>();
    const visit = (value: unknown, path: string) => {
      if (value === null || typeof value !== "object") return;
      if (seen.has(value)) return;
      seen.add(value);
      this.#expanded.add(path);
      for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
      )) {
        visit(child, childPath(path, key, Array.isArray(value)));
      }
    };
    visit(this.#value, "$");
  }

  collapseAll(): void {
    this.#expanded.clear();
  }

  select(path: string, additive = false): void {
    if (!additive) this.#selected.clear();
    this.#selected.add(path);
  }

  selected(): readonly string[] {
    return Object.freeze([...this.#selected]);
  }

  search(query: string | RegExp): readonly TreeRow[] {
    const expression = typeof query === "string" ? query.toLowerCase() : query;
    this.expandAll();
    return Object.freeze(
      this.rows().filter((row) => {
        const text = `${row.path} ${String(row.value ?? "")}`;
        return typeof expression === "string"
          ? text.toLowerCase().includes(expression)
          : testExpression(expression, text);
      }),
    );
  }

  copy(path: string, format: "json" | "path" | "text"): string {
    if (format === "path") return path;
    const value = resolveJsonPath(this.#value, path);
    return format === "json" ? cycleSafeStringify(value, 2) : String(value);
  }
}

export function resolveJsonPath(value: unknown, path: string): unknown {
  if (path === "$") return value;
  const matches = [
    ...path.matchAll(/\.([^.[\]]+)|\[(?:(\d+)|"((?:\\.|[^"])*)")\]/g),
  ];
  if (`$${matches.map((match) => match[0]).join("")}` !== path) {
    throw new Error(`Invalid JSON path "${path}"`);
  }
  const tokens = matches.map(
    (match) => match[1] ?? match[2] ?? JSON.parse(`"${match[3] ?? ""}"`),
  );
  let current = value;
  for (const token of tokens) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function cycleSafeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, current) => {
      if (current && typeof current === "object") {
        if (seen.has(current)) return "[Circular]";
        seen.add(current);
      }
      return current;
    },
    space,
  );
}

function childPath(path: string, key: string, array: boolean): string {
  if (array) return `${path}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function testExpression(expression: RegExp, value: string): boolean {
  expression.lastIndex = 0;
  return expression.test(value);
}

export interface DiffLine {
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly kind: "header" | "hunk" | "context" | "addition" | "deletion";
  readonly text: string;
}

interface DiffLineCounters {
  oldLine: number;
  newLine: number;
}

function parseDiffLine(text: string, counters: DiffLineCounters): DiffLine {
  if (text.startsWith("@@")) {
    const match = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(text);
    counters.oldLine = Number(match?.[1] ?? 0);
    counters.newLine = Number(match?.[2] ?? 0);
    return { kind: "hunk", text };
  }
  if (/^(?:---|\+\+\+|diff )/.test(text)) return { kind: "header", text };
  if (text.startsWith("+")) {
    return { newLine: counters.newLine++, kind: "addition", text };
  }
  if (text.startsWith("-")) {
    return { oldLine: counters.oldLine++, kind: "deletion", text };
  }
  return {
    oldLine: counters.oldLine++,
    newLine: counters.newLine++,
    kind: "context",
    text,
  };
}

export function parseUnifiedDiff(source: string): readonly DiffLine[] {
  const counters = { oldLine: 0, newLine: 0 };
  return Object.freeze(
    source.split("\n").map((text) => parseDiffLine(text, counters)),
  );
}

export class DiffModel {
  readonly lines: readonly DiffLine[];
  #hunk = 0;

  constructor(source: string) {
    this.lines = parseUnifiedDiff(source);
  }

  hunks(): readonly number[] {
    return Object.freeze(
      this.lines.flatMap((line, index) =>
        line.kind === "hunk" ? [index] : [],
      ),
    );
  }

  navigate(direction: 1 | -1): number {
    const hunks = this.hunks();
    if (hunks.length === 0) return -1;
    this.#hunk = (this.#hunk + direction + hunks.length) % hunks.length;
    return hunks[this.#hunk] ?? -1;
  }

  search(query: string | RegExp): readonly number[] {
    return Object.freeze(
      this.lines.flatMap((line, index) => {
        const matches =
          typeof query === "string"
            ? line.text.includes(query)
            : testExpression(query, line.text);
        return matches ? [index] : [];
      }),
    );
  }

  copyPatch(): string {
    return this.lines.map((line) => line.text).join("\n");
  }

  hunkPatch(index: number): string {
    const hunks = this.hunks();
    const start = hunks[index];
    if (start === undefined) return "";
    const end = hunks[index + 1] ?? this.lines.length;
    return this.lines
      .slice(start, end)
      .map((line) => line.text)
      .join("\n");
  }

  resolveHunk(index: number, decision: "apply" | "reject"): string {
    return this.hunkPatch(index)
      .split("\n")
      .filter((line) => {
        if (line.startsWith("@@")) return false;
        if (decision === "apply") return !line.startsWith("-");
        return !line.startsWith("+");
      })
      .map((line) => (/^[ +-]/.test(line) ? line.slice(1) : line))
      .join("\n");
  }

  selectLines(start: number, end: number): string {
    const first = Math.max(0, Math.min(start, end));
    const last = Math.min(this.lines.length - 1, Math.max(start, end));
    return this.lines
      .slice(first, last + 1)
      .map((line) => line.text)
      .join("\n");
  }

  render(
    mode: "unified" | "split" = "unified",
    options: { readonly collapseUnchangedAfter?: number } = {},
  ): readonly string[] {
    const collapse = (lines: readonly string[]): readonly string[] => {
      const threshold = options.collapseUnchangedAfter;
      if (!threshold || threshold < 1) return lines;
      const output: string[] = [];
      let contextRun: string[] = [];
      const flush = () => {
        if (contextRun.length > threshold) {
          output.push(
            ...contextRun.slice(0, Math.ceil(threshold / 2)),
            `… ${contextRun.length - threshold} unchanged lines …`,
            ...contextRun.slice(-Math.floor(threshold / 2)),
          );
        } else output.push(...contextRun);
        contextRun = [];
      };
      for (const line of lines) {
        if (/^\s*\d*\s+\d*\s+\s/.test(line)) contextRun.push(line);
        else {
          flush();
          output.push(line);
        }
      }
      flush();
      return Object.freeze(output);
    };
    if (mode === "unified") {
      return collapse(
        this.lines.map(
          (line) =>
            `${String(line.oldLine ?? "").padStart(4)} ${String(line.newLine ?? "").padStart(4)} ${line.text}`,
        ),
      );
    }
    const rows: string[] = [];
    for (let index = 0; index < this.lines.length; index += 1) {
      const line = this.lines[index];
      if (!line) continue;
      if (
        line.kind === "deletion" &&
        this.lines[index + 1]?.kind === "addition"
      ) {
        rows.push(
          `${line.text.slice(1).padEnd(40)} │ ${this.lines[index + 1]?.text.slice(1) ?? ""}`,
        );
        index += 1;
      } else {
        rows.push(`${line.text.padEnd(40)} │ ${line.text}`);
      }
    }
    return collapse(rows);
  }
}

function nodeLines(node: DocumentNode, depth = 0): string[] {
  const prefix = "  ".repeat(depth);
  if (node.children?.length) {
    return [
      `${prefix}${node.type}`,
      ...node.children.flatMap((child) => nodeLines(child, depth + 1)),
    ];
  }
  return [`${prefix}${node.raw ?? String(node.value ?? "")}`];
}

export const rawProjection: RenderProjection<string> = Object.freeze({
  id: "raw",
  project: (document: PartialDocument) => document.source,
});

export const treeProjection: RenderProjection<readonly string[]> =
  Object.freeze({
    id: "tree",
    project: (document: PartialDocument) =>
      Object.freeze(nodeLines(document.root)),
  });

export const tableProjection: RenderProjection<
  readonly Readonly<Record<string, unknown>>[]
> = Object.freeze({
  id: "table",
  project(document: PartialDocument) {
    const value = document.root.value;
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item) =>
          Object.freeze(
            typeof item === "object" && item
              ? { ...(item as Record<string, unknown>) }
              : { value: item },
          ),
        ),
      );
    }
    return Object.freeze(
      (document.root.children ?? []).map((child) =>
        Object.freeze({
          type: child.type,
          value: child.value,
          raw: child.raw,
        }),
      ),
    );
  },
});

export const builtInContentProjections = Object.freeze([
  rawProjection,
  treeProjection,
  tableProjection,
]);
