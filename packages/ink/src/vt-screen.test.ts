import { expect, test } from "bun:test";
import { VirtualTerminalScreen } from "./vt-screen.ts";

test("virtual terminal reconstructs incremental later-line changes", () => {
  const screen = new VirtualTerminalScreen(20, 4);
  screen.write("first\nsecond");
  expect(screen.snapshot()).toBe("first\nsecond");

  screen.write("\u001b[2;1H\u001b[2Kupdated");
  expect(screen.snapshot()).toBe("first\nupdated");
});

test("virtual terminal applies cursor, erase, save, and presentation sequences", () => {
  const screen = new VirtualTerminalScreen(12, 3);
  screen.write(
    "\u001b[2J\u001b[Hone\n\u001b[31mtwo\u001b[0m\u001b7\u001b[3;1Hthree\u001b8!",
  );
  expect(screen.snapshot()).toBe("one\ntwo!\nthree");
  screen.write("\u001b[2;4H\u001b[3X");
  expect(screen.snapshot()).toBe("one\ntwo\nthree");
});

test("virtual terminal ignores OSC hyperlinks and preserves linked text", () => {
  const screen = new VirtualTerminalScreen(20, 2);
  screen.write("\u001b]8;;https://example.test\u0007linked\u001b]8;;\u001b\\");
  expect(screen.snapshot()).toBe("linked");
});

test("virtual terminal preserves incomplete control sequences between writes", () => {
  const screen = new VirtualTerminalScreen(20, 2);
  screen.write("first\u001b[2;");
  screen.write("1H\u001b]8;;https://example.test");
  screen.write("\u0007second\u001b]8;;\u001b");
  screen.write("\\");
  expect(screen.snapshot()).toBe("first\nsecond");
});

test("virtual terminal applies delayed autowrap after the final column", () => {
  const screen = new VirtualTerminalScreen(5, 2);
  screen.write("12345");
  expect(screen.snapshot()).toBe("12345");
  screen.write("6");
  expect(screen.snapshot()).toBe("12345\n6");
});
