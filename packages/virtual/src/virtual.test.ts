import { expect, test } from "bun:test";
import { fitTerminalText, TerminalVirtualizerAdapter } from "./index.ts";

test("terminal virtualizer measures large cell ranges within frame budgets", () => {
  const adapter = new TerminalVirtualizerAdapter({
    count: 1_000_000,
    viewportSize: 20,
    scrollOffset: 900_000,
    overscan: 2,
  });
  const started = performance.now();
  let range = adapter.measure({
    count: 1_000_000,
    viewportSize: 20,
    scrollOffset: 0,
    overscan: 2,
  });
  for (let index = 1; index < 10_000; index += 1) {
    range = adapter.measure({
      count: 1_000_000,
      viewportSize: 20,
      scrollOffset: index * 10,
      overscan: 2,
    });
  }
  const elapsed = performance.now() - started;
  adapter.dispose();
  adapter.dispose();
  expect(range.indexes.length).toBeLessThanOrEqual(24);
  expect(elapsed).toBeLessThan(250);
});

test("terminal text utilities preserve ANSI widths and one-cell rows", () => {
  expect(fitTerminalText("\u001b[31m界面\u001b[39m", 5)).toBe(
    "\u001b[31m界面\u001b[39m ",
  );
  expect(fitTerminalText("terminal", 5)).toEndWith("…");
});
