import { expect, test } from "bun:test";
import {
  generateStoryCatalogDocumentation,
  generateStoryCatalogSnapshots,
} from "@mwillbanks/tuil-story";
import { renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createDefaultThemeRegistry } from "@mwillbanks/tuil-theme";
import {
  createEcosystemStoryCatalog,
  StoryCatalogSummary,
} from "../../../registry/stories/ecosystem.tsx";
import { renderShowcase } from "./index.tsx";
import { startStoryServer, storyServerMessage } from "./story-server.ts";
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

test("showcase renders every portable application story", async () => {
  const output = await renderShowcase();
  expect(output).toContain("Running");
  expect(output).toContain("Complete");
  expect(output).toContain("Build pipeline");
  expect(output).toContain("62%");
  expect(output).toContain("100%");
  const summary = renderTuil(<StoryCatalogSummary />);
  await summary.ready;
  expect(summary.screen.frame()).toContain("5 portable story sets");
  await summary.cleanup();
});

test("story surface runner owns readiness, signals, and child lifetimes", async () => {
  const bridge = surfaceProcess(null);
  const application = surfaceProcess(3);
  const listeners: Array<() => void> = [];
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
    once: (_signal, listener) => listeners.push(listener),
  };
  expect(await runStorySurface("storybook", runtime)).toBe(3);
  expect(healthAttempts).toBe(2);
  expect(listeners).toHaveLength(2);
  listeners[0]?.();
  expect(application.kills).toBe(1);
  expect(bridge.kills).toBe(2);

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

test("story bridge serves every portable set with controls and CORS", async () => {
  const server = startStoryServer({ port: 0 });
  try {
    expect(storyServerMessage(server.url)).toContain(server.url.toString());
    const endpoint = new URL("/api/tuil-story", server.url);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:6006",
      },
      body: JSON.stringify({
        storyId: "foundation",
        variant: "Running",
        controls: {
          width: 40,
          theme: "default-light",
          colorDepth: 24,
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:6006",
    );
    const frame = (await response.json()) as {
      readonly ansiFrame: string;
      readonly controls: {
        readonly width: number;
        readonly theme: string;
      };
    };
    expect(frame.ansiFrame).toContain("\u001b[");
    expect(frame.controls).toMatchObject({
      width: 40,
      theme: "default-light",
    });
    const initializer = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storyId: "init-wizard",
        variant: "StaticFallback",
      }),
    });
    expect(initializer.status).toBe(200);
    expect(await initializer.text()).toContain("tuil init");
    expect((await fetch(new URL("/health", server.url))).status).toBe(200);
    expect((await fetch(new URL("/missing", server.url))).status).toBe(404);
    const preflight = await fetch(endpoint, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:3000" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
    const disallowed = await fetch(endpoint, {
      method: "OPTIONS",
      headers: { origin: "https://example.com" },
    });
    expect(disallowed.headers.has("access-control-allow-origin")).toBeFalse();
  } finally {
    await server.stop(true);
  }
});

test("generates bounded snapshots and documentation for the entire catalog", async () => {
  const catalog = createEcosystemStoryCatalog();
  const options = { themeRegistry: createDefaultThemeRegistry() };
  const snapshots = await generateStoryCatalogSnapshots(catalog, options);
  expect(Object.keys(snapshots).sort()).toEqual([
    "data",
    "forms",
    "foundation",
    "init-wizard",
    "navigation",
  ]);
  expect(
    Object.values(snapshots).reduce(
      (count, variants) => count + Object.keys(variants).length,
      0,
    ),
  ).toBe(10);
  expect(JSON.stringify(snapshots)).not.toContain('"events"');
  expect(JSON.stringify(snapshots)).not.toContain('"actions"');
  const documentation = await generateStoryCatalogDocumentation(
    catalog,
    options,
  );
  expect(documentation["init-wizard"]).toContain("# Application/Initializer");
  expect(documentation["foundation"]).toContain("## Complete");
  await expect(
    generateStoryCatalogSnapshots(catalog, { ...options, maxStories: 9 }),
  ).rejects.toThrow("9 story limit");
  const controller = new AbortController();
  controller.abort();
  await expect(
    generateStoryCatalogSnapshots(catalog, {
      ...options,
      signal: controller.signal,
    }),
  ).rejects.toThrow();
});
