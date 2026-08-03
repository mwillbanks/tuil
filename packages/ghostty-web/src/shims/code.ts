export interface CodeSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: string;
}

export interface CodeTheme {
  readonly tokenStyles: Readonly<
    Record<string, { readonly foreground?: string; readonly bold?: boolean }>
  >;
  readonly diagnosticStyles: Readonly<
    Record<string, { readonly foreground: string }>
  >;
}

export class CodeDocument {
  readonly #source: string;
  readonly #language: string;
  #selection?: { readonly start: number; readonly end: number };
  #spans: readonly CodeSpan[] = [];

  constructor(
    source: string,
    options: { readonly language?: string; readonly filename?: string } = {},
  ) {
    this.#source = source;
    this.#language = options.language ?? "text";
  }

  get source(): string {
    return this.#source;
  }

  get language(): string {
    return this.#language;
  }

  async parse(signal = new AbortController().signal): Promise<{
    readonly language: string;
    readonly version: number;
    readonly spans: readonly CodeSpan[];
    readonly folds: readonly never[];
    readonly diagnostics: readonly never[];
  }> {
    signal.throwIfAborted();
    const spans: CodeSpan[] = [];
    for (const [kind, expression] of [
      ["string", /(["'`])(?:\\.|(?!\1)[^\\])*\1/gu],
      [
        "keyword",
        /\b(?:const|let|function|class|interface|type|return|import|export|from)\b/gu,
      ],
      ["number", /\b\d+(?:\.\d+)?\b/gu],
    ] as const) {
      for (const match of this.#source.matchAll(expression)) {
        spans.push({
          start: match.index,
          end: match.index + match[0].length,
          kind,
        });
      }
    }
    this.#spans = Object.freeze(
      spans.sort((left, right) => left.start - right.start),
    );
    return Object.freeze({
      language: this.#language,
      version: 1,
      spans: this.#spans,
      folds: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });
  }

  search(query: string | RegExp): readonly CodeSpan[] {
    const expression =
      typeof query === "string"
        ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")
        : new RegExp(
            query.source,
            query.flags.includes("g") ? query.flags : `${query.flags}g`,
          );
    // fallow-ignore-next-line code-duplication -- Browser shim intentionally mirrors the public code document search contract.
    return Object.freeze(
      [...this.#source.matchAll(expression)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        kind: "search",
      })),
    );
  }

  select(start: number, end: number): void {
    if (start < 0 || end < start || end > this.#source.length)
      throw new RangeError("Code selection range is invalid");
    this.#selection = { start, end };
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
    // fallow-ignore-next-line code-duplication -- Browser shim intentionally mirrors the public code document styling contract.
    return this.#spans.flatMap((span) => {
      const style = theme.tokenStyles[span.kind];
      return style ? [{ span, style }] : [];
    });
  }

  render(
    options: {
      readonly width?: number;
      readonly lineNumbers?: boolean;
      readonly wrap?: boolean;
      readonly horizontalOffset?: number;
      readonly foldedLines?: ReadonlySet<number>;
    } = {},
  ): readonly string[] {
    const lines = this.#source.split("\n");
    const digits = String(lines.length).length;
    return Object.freeze(
      lines.map((line, index) => {
        const prefix = options.lineNumbers
          ? `${String(index + 1).padStart(digits)} │ `
          : "";
        const offset = Math.max(0, options.horizontalOffset ?? 0);
        const width = Math.max(1, (options.width ?? 80) - prefix.length);
        return `${prefix}${line.slice(offset, offset + width)}`;
      }),
    );
  }

  dispose(): void {}
}
