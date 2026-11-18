import { expect, test } from "bun:test";
import { BrowserConsole } from "./console";

test("browser console routes formatted logs and diagnostics to their configured writers", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const browser = new BrowserConsole(
    { write: (value) => stdout.push(value) },
    { write: (value) => stderr.push(value) },
  );
  browser.log("Ready", 2, { active: true }, null, undefined);
  expect(stdout).toEqual(['Ready 2 {"active":true} null \n']);
  const failure = new Error("failure");
  failure.stack = "fixture stack";
  browser.warn(failure);
  expect(stderr).toEqual(["fixture stack\n"]);
  const withoutStack = new Error("message");
  withoutStack.stack = undefined;
  browser.error(withoutStack);
  expect(stderr.at(-1)).toBe("message\n");
  browser.assert(true, "ignored");
  expect(stderr).toHaveLength(2);
  browser.assert(false, "broken", { code: 1 });
  expect(stderr.at(-1)).toBe('Assertion failed: broken {"code":1}\n');
  expect(browser.groupEnd()).toBeUndefined();
});

test("browser console aliases preserve routing and default both streams to the provided writer", () => {
  const values: string[] = [];
  const browser = new BrowserConsole({ write: (value) => values.push(value) });
  for (const method of [
    "info",
    "debug",
    "dir",
    "dirxml",
    "table",
    "count",
    "countReset",
    "time",
    "timeEnd",
    "timeLog",
    "group",
    "groupCollapsed",
    "trace",
  ] as const) {
    browser[method](method);
    expect(values.at(-1)).toBe(method + "\n");
  }
  browser.assert();
  expect(values.at(-1)).toBe("Assertion failed:\n");
});
