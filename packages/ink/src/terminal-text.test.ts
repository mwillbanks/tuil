import { expect, test } from "bun:test";
import { escapeTerminalControlCharacters } from "./terminal-text.ts";

test("terminal text escaping neutralizes control sequences", () => {
  expect(escapeTerminalControlCharacters("a\nb\t\u0007")).toBe(
    "a\\nb\\t\\u0007",
  );
  expect(escapeTerminalControlCharacters("\u001b[2J")).toBe("\\u001b[2J");
  expect(escapeTerminalControlCharacters("\u001b]0;title\u0007")).toBe(
    "\\u001b]0;title\\u0007",
  );
  expect(escapeTerminalControlCharacters("\u009b2J\u009dtitle")).toBe(
    "\\u009b2J\\u009dtitle",
  );
});
