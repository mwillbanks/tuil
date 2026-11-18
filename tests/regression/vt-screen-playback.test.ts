import { expect, test } from "bun:test";
import { VirtualTerminalScreen } from "../../packages/ink/src/vt-screen.ts";
test("split combining marks attach to the last grapheme at the wrap boundary", () => {
  const screen = new VirtualTerminalScreen(3, 2);
  screen.write("abc");
  screen.write("\u0301");
  expect(screen.snapshot()).toBe("abc\u0301");
  screen.write("d");
  expect(screen.snapshot()).toBe("abc\u0301\nd");
  const wide = new VirtualTerminalScreen(3, 2);
  wide.write("a界");
  wide.write("\u0301");
  expect(wide.snapshot()).toBe("a界\u0301");
});
