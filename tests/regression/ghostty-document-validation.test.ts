import { expect, test } from "bun:test";
import {
  type PlaygroundDocumentV1,
  validatePlaygroundDocument,
} from "../../packages/ghostty-web/src/document";
import { CodeDocument } from "../../packages/ghostty-web/src/shims/code";

function document(
  component = "Text",
  value: unknown = "safe",
): PlaygroundDocumentV1 {
  return {
    version: 1,
    terminal: { width: 80, height: 24, theme: "default-dark" },
    root: { id: "root", component, props: { children: value } },
  } as PlaygroundDocumentV1;
}
test("playground rejects non-finite JSON numbers and inherited component names", () => {
  for (const value of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    expect(() =>
      validatePlaygroundDocument(document("Text", { nested: [value] })),
    ).toThrow("must contain finite numbers");
  }
  for (const component of ["toString", "constructor", "__proto__", "Unknown"]) {
    expect(() => validatePlaygroundDocument(document(component))).toThrow(
      "Unknown browser component",
    );
  }
});
test("browser code selections reject invalid offsets without replacing the active selection", () => {
  const code = new CodeDocument("A😀B");
  code.select(1, 3);
  expect(code.copy()).toBe("😀");
  for (const [start, end] of [
    [-1, 1],
    [2, 1],
    [0, 5],
    [Number.NaN, 1],
    [0, Number.NaN],
    [0.5, 1],
    [0, 1.5],
    [0, Number.POSITIVE_INFINITY],
  ]) {
    expect(() => code.select(start!, end!)).toThrow(
      "selection range is invalid",
    );
    expect(code.copy()).toBe("😀");
  }
});
