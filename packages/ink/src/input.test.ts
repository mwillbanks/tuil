import { expect, test } from "bun:test";
import { isTerminalControlSequence } from "./input.ts";

test("recognizes raw and Ink-normalized terminal control sequences", () => {
  for (const input of [
    "\u001b[I",
    "[I",
    "\u001b[O",
    "[O",
    "\u001b[?1004h",
    "[?1004h",
    "\u001bOP",
    "OP",
    "\u001b[1;5A",
    "[1;5A",
  ]) {
    expect(isTerminalControlSequence(input)).toBeTrue();
  }
});

test("does not classify printable input as terminal control", () => {
  for (const input of ["a", "text", "[", "O", "[I pasted with words"]) {
    expect(isTerminalControlSequence(input)).toBeFalse();
  }
});
