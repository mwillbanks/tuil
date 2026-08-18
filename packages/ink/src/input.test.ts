import { expect, test } from "bun:test";
import {
  hasTerminalControlCharacters,
  isTerminalControlSequence,
  TerminalInputRouter,
} from "./input.ts";

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

test("classifies literal control characters separately from printable input", () => {
  expect(hasTerminalControlCharacters("\t")).toBeTrue();
  expect(hasTerminalControlCharacters("P")).toBeFalse();
});

test("allows control-character handlers to opt in without exposing them by default", async () => {
  const router = new TerminalInputRouter();
  const received: string[] = [];
  router.register((input) => {
    received.push(`default:${input}`);
    return true;
  }, 2);
  router.register(
    (input) => {
      received.push(`allowed:${input}`);
      return true;
    },
    1,
    undefined,
    true,
  );
  expect(await router.dispatch("\u001b[I", {} as never)).toBeTrue();
  expect(received).toEqual(["allowed:\u001b[I"]);
});
