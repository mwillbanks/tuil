import { expect, test } from "bun:test";
import { FrameScheduler } from "../../packages/renderer/src/index.ts";
test("frame scheduler rejects nonfinite rate configuration before scheduling", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    expect(() => new FrameScheduler(() => {}, { targetFps: value })).toThrow(
      "positive",
    );
    expect(() => new FrameScheduler(() => {}, { maximumFps: value })).toThrow(
      "positive",
    );
  }
});
