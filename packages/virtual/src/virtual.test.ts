import { expect, test } from "bun:test";
import { fitTerminalText } from "./index.ts";

test("terminal text utilities preserve ANSI widths and one-cell rows", () => {
  expect(fitTerminalText("\u001b[31m界面\u001b[39m", 5)).toBe(
    "\u001b[31m界面\u001b[39m ",
  );
  expect(fitTerminalText("terminal", 5)).toEndWith("…");
});
