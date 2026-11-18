import { expect, test } from "bun:test";
import { useTestClock } from "../../tests/helpers/clock.ts";

const clock = useTestClock();

test("virtual deadlines preserve exact boundaries, ordering and cancellation", async () => {
  const calls: string[] = [];
  const cancelled = setTimeout(() => calls.push("cancelled"), 5);
  clearTimeout(cancelled);
  setTimeout(() => calls.push("first"), 10);
  setTimeout(() => calls.push("second"), 10);
  const started = clock.now();
  await clock.advance(9);
  expect(calls).toEqual([]);
  expect(clock.pending()).toBe(2);
  await clock.advance(1);
  expect(calls).toEqual(["first", "second"]);
  expect(clock.now() - started).toBe(10);
  expect(clock.pending()).toBe(0);
});

test("virtual delays and promise completion do not consume wall time", async () => {
  let completed = false;
  const delayed = clock.delay(20).then(() => {
    completed = true;
  });
  await clock.advance(19);
  expect(completed).toBeFalse();
  await clock.advance(1);
  await delayed;
  expect(completed).toBeTrue();
  expect(clock.pending()).toBe(0);
});

test("each virtual clock starts at the same epoch without pending timers", () => {
  expect(clock.now()).toBe(1_700_000_000_000);
  expect(clock.pending()).toBe(0);
});

test("virtual time rejects invalid advances", async () => {
  for (const duration of [-1, Infinity, NaN]) {
    await expect(clock.advance(duration)).rejects.toBeInstanceOf(RangeError);
  }
});
