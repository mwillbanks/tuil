import { expect, test } from "bun:test";
import { CodeDocument } from "../../packages/code/src/index.ts";

test("invalid CodeDocument offsets preserve source and UTF-16 selection", () => {
  const document = new CodeDocument("a😀b", { language: "text", parsers: [] });
  document.select(1, 3);
  expect(document.copy()).toBe("😀");
  const invalid: [number, number][] = [
    [NaN, 3],
    [1, NaN],
    [1, Infinity],
    [0.5, 3],
    [1, 2.5],
    [-1, 3],
    [3, 1],
    [1, 5],
  ];
  for (const [start, end] of invalid) {
    expect(() => document.select(start, end)).toThrow(
      "Code selection range is invalid",
    );
    expect(() => document.update(start, end, "!")).toThrow(
      "Code update range is invalid",
    );
  }
  expect(document.source).toBe("a😀b");
  expect(document.selection()).toEqual({ start: 1, end: 3 });
  document.update(0, 0, "!");
  expect(document.source).toBe("!a😀b");
  expect(document.copy()).toBe("😀");
});
