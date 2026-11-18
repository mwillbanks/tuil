import { expect, test } from "bun:test";
import { createStorybookAdapter } from "@mwillbanks/tuil-story/storybook";
import { platformBrowserStorySet } from "../../../registry/stories/platform-story-data.ts";
import {
  runStorySurface,
  type StorySurfaceProcess,
  type StorySurfaceRuntime,
} from "./with-story-server.ts";

function surfaceProcess(exitCode: number | null): StorySurfaceProcess & {
  kills: number;
} {
  return {
    exitCode,
    exited: Promise.resolve(exitCode ?? 0),
    kills: 0,
    kill() {
      this.kills += 1;
    },
  };
}

test("published storybook adapter exposes portable variants and controls", () => {
  const adapter = createStorybookAdapter(platformBrowserStorySet);
  expect(adapter.stories["Renderer"]).toBeDefined();
  expect(adapter.meta.argTypes).toHaveProperty("terminalInput");
});

test("story surface runner owns readiness, signals, and child lifetimes", async () => {
  const bridge = surfaceProcess(null);
  const application = surfaceProcess(3);
  const listeners = new Map<string, () => void>();
  let healthAttempts = 0;
  const runtime: StorySurfaceRuntime = {
    spawn: (command) =>
      command[1] === "story-server.ts" ? bridge : application,
    fetch: (() => {
      healthAttempts += 1;
      if (healthAttempts === 1) return Promise.reject(new Error("starting"));
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as unknown as typeof fetch,
    sleep: () => Promise.resolve(),
    once: (signal, listener) => listeners.set(signal, listener),
    off: (signal, listener) => {
      if (listeners.get(signal) === listener) listeners.delete(signal);
    },
  };
  expect(await runStorySurface("storybook", runtime)).toBe(3);
  expect(healthAttempts).toBe(2);
  expect(listeners.size).toBe(0);
  expect(application.kills).toBe(0);
  expect(bridge.kills).toBe(1);

  await expect(runStorySurface("unknown", runtime)).rejects.toThrow(
    "Expected development surface",
  );
  await expect(
    runStorySurface("docs", {
      ...runtime,
      spawn: () => surfaceProcess(1),
    }),
  ).rejects.toThrow("exited before becoming ready");

  const neverReady = surfaceProcess(null);
  await expect(
    runStorySurface("docs", {
      ...runtime,
      spawn: () => neverReady,
      fetch: (() =>
        Promise.resolve(
          new Response(null, { status: 503 }),
        )) as unknown as typeof fetch,
    }),
  ).rejects.toThrow("did not become ready");
  expect(neverReady.kills).toBe(1);
});
