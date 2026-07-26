import { expect, test } from "bun:test";
import {
  generateStoryCatalogDocumentation,
  generateStoryCatalogSnapshots,
} from "@mwillbanks/tuil-story";
import { createDefaultThemeRegistry } from "@mwillbanks/tuil-theme";
import { createEcosystemStoryCatalog } from "../../../registry/stories/ecosystem.tsx";
import { renderShowcase } from "./index.tsx";
import { startStoryServer } from "./story-server.ts";

test("showcase renders every portable application story", async () => {
  const output = await renderShowcase();
  expect(output).toContain("Running");
  expect(output).toContain("Complete");
  expect(output).toContain("Build pipeline");
  expect(output).toContain("62%");
  expect(output).toContain("100%");
});

test("story bridge serves every portable set with controls and CORS", async () => {
  const server = startStoryServer({ port: 0 });
  try {
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
