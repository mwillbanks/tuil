import { expect, test } from "bun:test";
import { CodeDocument, type CodeTheme } from "./code";

test("browser code parser exposes deterministic tokens, theming, and aborted work", async () => {
  const source = 'export const answer = "ready";\nreturn 42;';
  const code = new CodeDocument(source, {
    language: "typescript",
    filename: "example.ts",
  });
  expect(code.source).toBe(source);
  expect(code.language).toBe("typescript");
  expect(new CodeDocument("plain").language).toBe("text");
  const result = await code.parse();
  expect(result).toMatchObject({
    language: "typescript",
    version: 1,
    folds: [],
    diagnostics: [],
  });
  expect(
    result.spans.map((span) => source.slice(span.start, span.end)),
  ).toEqual(["export", "const", '"ready"', "return", "42"]);
  expect(Object.isFrozen(result)).toBeTrue();
  expect(Object.isFrozen(result.spans)).toBeTrue();
  const theme: CodeTheme = {
    tokenStyles: { keyword: { foreground: "red", bold: true } },
    diagnosticStyles: {},
  };
  expect(
    code
      .themedSpans(theme)
      .map(({ span, style }) => [source.slice(span.start, span.end), style]),
  ).toEqual([
    ["export", { foreground: "red", bold: true }],
    ["const", { foreground: "red", bold: true }],
    ["return", { foreground: "red", bold: true }],
  ]);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  controller.abort(reason);
  await expect(code.parse(controller.signal)).rejects.toBe(reason);
  expect(code.themedSpans(theme)).toHaveLength(3);
  code.dispose();
});

test("browser code search escapes literal syntax and preserves regex semantics", () => {
  const code = new CodeDocument("a.b aXb A.B a.b");
  expect(code.search("a.b")).toEqual([
    { start: 0, end: 3, kind: "search" },
    { start: 12, end: 15, kind: "search" },
  ]);
  const expression = /a.b/i;
  expect(code.search(expression)).toHaveLength(4);
  expect(expression.lastIndex).toBe(0);
  expect(code.search(/a.b/g)).toHaveLength(3);
  expect(code.search("missing")).toEqual([]);
  expect(Object.isFrozen(code.search("a.b"))).toBeTrue();
});

test("browser code selection copies UTF-16 ranges and rendering bounds source slices", () => {
  const code = new CodeDocument("hello\nworld");
  expect(code.copy()).toBe("hello\nworld");
  code.select(1, 4);
  expect(code.copy()).toBe("ell");
  code.select(0, 0);
  expect(code.copy()).toBe("");
  expect(code.render()).toEqual(["hello", "world"]);
  expect(
    code.render({ width: 7, horizontalOffset: 1, lineNumbers: true }),
  ).toEqual(["1 │ ell", "2 │ orl"]);
  expect(code.render({ width: 0, horizontalOffset: -1 })).toEqual(["h", "w"]);
  expect(Object.isFrozen(code.render())).toBeTrue();
});
