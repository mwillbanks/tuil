import stringWidth from "string-width";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI control sequences are the input grammar.
const ansiSequence = /^\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/;

export function escapeTerminalControlCharacters(value: string): string {
  let escaped = "";
  for (const character of value) {
    const named = { "\r": "\\r", "\n": "\\n", "\t": "\\t" }[character];
    if (named) {
      escaped += named;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    escaped +=
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
        ? `\\u${codePoint.toString(16).padStart(4, "0")}`
        : character;
  }
  return escaped;
}

export function hasTerminalControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

interface TerminalToken {
  readonly value: string;
  readonly width: number;
}

function* terminalTokens(value: string): Generator<TerminalToken> {
  let offset = 0;
  while (offset < value.length) {
    const remaining = value.slice(offset);
    const control = ansiSequence.exec(remaining)?.[0];
    if (control) {
      yield { value: control, width: 0 };
      offset += control.length;
      continue;
    }
    const segment =
      graphemeSegmenter.segment(remaining)[Symbol.iterator]().next().value
        ?.segment ??
      remaining[0] ??
      "";
    yield { value: segment, width: stringWidth(segment) };
    offset += segment.length;
  }
}

export function createGlobalSearchExpression(query: string | RegExp): RegExp {
  if (typeof query === "string") {
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu");
  }
  if (!isSafeRegularExpressionSource(query.source)) {
    throw new TypeError("Search regular expression is too complex");
  }
  return new RegExp(
    query.source,
    query.flags.includes("g") ? query.flags : `${query.flags}g`,
  );
}

export function isSafeRegularExpressionSource(source: string): boolean {
  if (source.length > 256) return false;
  if (/\\[1-9]|\(\?[=!<]/u.test(source)) return false;
  if (/(?:[*+?]|\{\d+(?:,\d*)?\}){2}/u.test(source)) return false;
  return !/\([^)]*(?:[+*{]|\|)[^)]*\)(?:[+*{]|\{\d+)/u.test(source);
}

export function truncateTerminalText(value: string, columns: number): string {
  if (!Number.isSafeInteger(columns) || columns < 0) {
    throw new TypeError("Terminal column width must be a nonnegative integer");
  }
  let result = "";
  let used = 0;
  for (const { segment } of graphemeSegmenter.segment(value)) {
    const width = stringWidth(segment);
    if (used + width > columns) break;
    result += segment;
    used += width;
  }
  return result;
}

export function terminalTextWidth(value: string): number {
  return stringWidth(value);
}

export function sliceTerminalText(
  value: string,
  startColumn: number,
  columns = Number.POSITIVE_INFINITY,
): string {
  if (
    !Number.isSafeInteger(startColumn) ||
    startColumn < 0 ||
    (!Number.isSafeInteger(columns) && columns !== Number.POSITIVE_INFINITY) ||
    columns < 0
  ) {
    throw new TypeError("Terminal slice columns must be nonnegative integers");
  }
  let terminalOffset = 0;
  let result = "";
  for (const token of terminalTokens(value)) {
    if (token.width === 0) {
      if (terminalOffset >= startColumn) result += token.value;
      continue;
    }
    const relative = terminalOffset - startColumn;
    if (terminalOffset >= startColumn && relative + token.width <= columns) {
      result += token.value;
    } else if (
      terminalOffset >= startColumn &&
      relative + token.width > columns
    ) {
      break;
    }
    terminalOffset += token.width;
  }
  return result;
}

export function wrapTerminalText(
  value: string,
  columns: number,
): readonly string[] {
  if (!Number.isSafeInteger(columns) || columns < 1) {
    throw new TypeError("Terminal column width must be a positive integer");
  }
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const token of terminalTokens(value)) {
    if (token.width > 0 && used > 0 && used + token.width > columns) {
      lines.push(line);
      line = "";
      used = 0;
    }
    line += token.value;
    used += token.width;
  }
  lines.push(line);
  return Object.freeze(lines);
}
