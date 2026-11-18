import { expect, test } from "bun:test";
import { VirtualTerminalScreen } from "./vt-screen.ts";

function playback(value: string, width = 8, height = 3): string {
  const screen = new VirtualTerminalScreen(width, height);
  screen.write(value);
  return screen.snapshot();
}
test("cursor addressing clamps positions and defaults zero parameters to one", () => {
  expect(playback("\x1b[2;4HX\x1b[AY\x1b[2BZ")).toBe("    Y\n   X\n     Z");
  expect(playback("\x1b[99;99HX")).toBe("\n\n       X");
  expect(playback("\x1b[0;0HX")).toBe("X");
  expect(playback("\x1b[2;3fX\x1b[0GQ\x1b[1dR")).toBe(" R\nQ X");
});
test("relative horizontal and line movements respect screen edges", () => {
  expect(playback("abc\x1b[2DX\x1b[99DY\x1b[99CZ")).toBe("YXc    Z");
  expect(playback("abc\x1b[EX\x1b[2EY\x1b[FZ")).toBe("abc\nZ\nY");
  expect(playback("\x1b[99B\x1b[99AX")).toBe("X");
});
test("CSI save and restore return to the saved cell after cursor motion", () => {
  expect(playback("a\x1b[s\x1b[3;5HX\x1b[uB")).toBe("aB\n\n    X");
  const screen = new VirtualTerminalScreen(8, 3);
  screen.write("\x1b[3;8H\x1b7");
  screen.resize(3, 1);
  screen.write("\x1b8X");
  expect(screen.snapshot()).toBe("  X");
});
test("tabs, backspace, carriage return and ignored controls preserve status text", () => {
  expect(playback("abc\bX\rY\x00\x07\x7fZ")).toBe("YZX");
  expect(playback("a\tb", 12)).toBe("a       b");
  expect(playback("\tX", 4)).toBe("   X");
  expect(playback("\bX")).toBe("X");
});
for (const [command, expected] of [
  ["0J", "111\n2"],
  ["1J", "\n  2\n333"],
  ["2J", ""],
  ["3J", ""],
  ["0K", "111\n2\n333"],
  ["1K", "111\n  2\n333"],
  ["2K", "111\n\n333"],
] as const) {
  test("erase playback " + command, () => {
    expect(playback("111\n222\n333\x1b[2;2H\x1b[" + command)).toBe(expected);
  });
}
test("erase characters and insertion/deletion retain untouched columns", () => {
  expect(playback("abcdef\x1b[1;3H\x1b[2X")).toBe("ab  ef");
  expect(playback("abcdef\x1b[1;3H\x1b[2P")).toBe("abef");
  expect(playback("abcdef\x1b[1;3H\x1b[2@")).toBe("ab  cdef");
  expect(playback("abcdef\x1b[1;7H\x1b[99P")).toBe("abcdef");
  expect(playback("abcdef\x1b[1;3H\x1b[99@")).toBe("ab");
});
test("explicit scroll commands clamp counts and line feed scrolls at the bottom", () => {
  expect(playback("one\ntwo\nthree\x1b[S")).toBe("two\nthree");
  expect(playback("one\ntwo\nthree\x1b[T")).toBe("\none\ntwo");
  expect(playback("one\ntwo\nthree\x1b[99S")).toBe("");
  expect(playback("one\ntwo\nthree\x1b[99T")).toBe("");
  expect(playback("one\ntwo\nthree\nfour")).toBe("two\nthree\nfour");
});
test("styles, color forms, cursor modes and terminal reports do not pollute text", () => {
  expect(
    playback(
      "\x1b[38;2;1;2;3mA\x1b[48;5;120mB\x1b[0m\x1b[?25l\x1b[?25h\x1b[5n\x1b[6nC",
    ),
  ).toBe("ABC");
  const screen = new VirtualTerminalScreen(8, 3);
  for (const chunk of [
    "\x1b",
    "]0;status",
    "\x1b",
    "\\ok",
    "\x1b[",
    "31",
    "m!",
  ])
    screen.write(chunk);
  expect(screen.snapshot()).toBe("ok!");
});
test("resize preserves overlapping content, blanks growth and rejects invalid dimensions atomically", () => {
  const screen = new VirtualTerminalScreen(4, 2);
  screen.write("abcd\nef");
  screen.resize(6, 3);
  expect(screen.snapshot()).toBe("abcd\nef");
  screen.resize(2, 1);
  expect(screen.snapshot()).toBe("ab");
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    expect(() => new VirtualTerminalScreen(value, 2)).toThrow(RangeError);
    expect(() => new VirtualTerminalScreen(2, value)).toThrow(RangeError);
    expect(() => screen.resize(4, value)).toThrow(RangeError);
    expect(screen.snapshot()).toBe("ab");
  }
  screen.write("\rQ");
  expect(screen.snapshot()).toBe("Qb");
});
test("explicit cursor motion cancels pending wrap and wide glyphs wrap before overflow", () => {
  expect(playback("1234\x1b[1DX", 4, 2)).toBe("12X4");
  expect(playback("1234\rX", 4, 2)).toBe("X234");
  expect(playback("abc界", 4, 2)).toBe("abc\n界");
  expect(playback("a界b", 4, 2)).toBe("a界b");
});
