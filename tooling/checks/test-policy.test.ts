import { expect, test } from "bun:test";
import { checkUnitTiming, timingViolations } from "./test-policy.ts";

test("unit timing policy accepts fixed values and a registered virtual clock", () => {
  expect(
    timingViolations('const date = new Date("2024-01-01T00:00:00Z");'),
  ).toEqual([]);
  expect(
    timingViolations(
      [
        'import { useTestClock } from "../../tests/helpers/clock.ts";',
        "const clock = useTestClock();",
        "async function deadline() { await clock.advance(10); return Date.now(); }",
      ].join("\n"),
    ),
  ).toEqual([]);
});

test("unit timing policy rejects direct, imported, destructured and aliased real time", () => {
  for (const source of [
    "setTimeout(() => {}, 10);",
    "globalThis.setInterval(() => {}, 10);",
    "Bun.sleep(10);",
    "const pause = Bun.sleep; pause(10);",
    "const { sleep: pause } = Bun; pause(10);",
    'import { setTimeout as delay } from "node:timers/promises"; delay(10);',
    'import * as timers from "node:timers"; timers.setInterval(() => {}, 10);',
    "const read = performance.now; read();",
    "const { now: read } = Date; read();",
    "process.hrtime.bigint();",
    "new Date();",
    "const CurrentDate = Date; new CurrentDate();",
    "Date();",
    "AbortSignal.timeout(10);",
    "const wait = Atomics.wait; wait(array, 0, 1, 10);",
    'import { promisify } from "node:util"; const delay = promisify(setTimeout); delay(10);',
    "const pause = setTimeout.bind(globalThis); pause(() => {}, 10);",
    "setTimeout.call(globalThis, () => {}, 10);",
    'const { setTimeout: pause } = require("node:timers"); pause(() => {}, 10);',
    'const pause = (Bun["sleep"]); pause(10);',
  ]) {
    expect(timingViolations(source).length, source).toBeGreaterThan(0);
  }
});

test("virtual-clock registration cannot permit current time at module evaluation", () => {
  const source = [
    'import { useTestClock } from "../../tests/helpers/clock.ts";',
    "useTestClock();",
    "Date.now();",
  ].join("\n");
  expect(timingViolations(source)).toMatchObject([{ api: "Date.now" }]);
});

test("policy reports executable calls and ignores prohibited names in fixture strings", () => {
  expect(timingViolations('const example = "await Bun.sleep(10)";')).toEqual(
    [],
  );
  expect(
    timingViolations(
      "\n\nconst pause = Bun.sleep;\npause(10);",
      "example.test.ts",
    ),
  ).toEqual([{ file: "example.test.ts", line: 4, api: "Bun.sleep" }]);
});

test("unit timing policy follows extensionless helpers and reexported fixtures", async () => {
  const sources = new Map([
    ["/workspace/unit.test.ts", 'import "./helpers/index";'],
    ["/workspace/helpers/index.ts", 'export * from "./nested";'],
    [
      "/workspace/helpers/nested.ts",
      "const pause = Bun.sleep; export const wait = () => pause(10);",
    ],
  ]);
  await expect(
    checkUnitTiming(["unit.test.ts"], "/workspace", async (path) =>
      sources.get(path),
    ),
  ).rejects.toThrow("Bun.sleep");
});

test("unit timing policy rejects indirect root harness imports", async () => {
  const sources = new Map([
    ["/workspace/unit.test.ts", 'import("./helpers/fixture.ts");'],
    [
      "/workspace/helpers/fixture.ts",
      'export * from "../tests/functional/network.ts";',
    ],
  ]);
  await expect(
    checkUnitTiming(["unit.test.ts"], "/workspace", async (path) =>
      sources.get(path),
    ),
  ).rejects.toThrow("Root harness fixtures");
});

test("captured native APIs cannot bypass a registered global virtual clock", () => {
  const source = [
    'import { useTestClock } from "../../tests/helpers/clock.ts";',
    "const read = Date.now;",
    "useTestClock();",
    "function callback() { return read(); }",
  ].join("\n");
  expect(timingViolations(source)).toMatchObject([{ api: "Date.now" }]);
});
