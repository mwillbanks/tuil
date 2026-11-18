import { afterEach, expect, test } from "bun:test";
import { Text } from "@mwillbanks/tuil-ink";
import { cleanup } from "@mwillbanks/tuil-testing-ink";
import { useInput } from "ink";
import { createElement, useState } from "react";
import {
  defineTuilStories,
  generateStoryCatalogDocumentation,
  generateStoryCatalogSnapshots,
  handleStoryHttpRequest,
  renderStoryRequest,
  storyHttpLimits,
  TuilStoryCatalog,
  TuilStorySession,
  validateStoryBridgeRequest,
} from "../../../../../packages/story/src/index.tsx";

afterEach(cleanup);

function CommandStory(props: { readonly label: string }) {
  const [status, setStatus] = useState("idle");
  useInput((_input, key) => {
    if (key.return) setStatus("submitted");
    else if (_input === "x") setStatus("typed");
  });
  return createElement(
    Text,
    { role: "status", label: props.label + " status" },
    props.label + ": " + status,
  );
}

function commandCatalog(): TuilStoryCatalog {
  const catalog = new TuilStoryCatalog();
  catalog.register(
    "commands",
    "Commands",
    defineTuilStories({
      component: CommandStory,
      stories: {
        Interactive: {
          args: { label: "Ready" },
          terminal: {
            width: 50,
            height: 10,
            interactive: true,
            reducedMotion: true,
          },
        },
        Static: {
          args: { label: "Playback" },
          terminal: { width: 40, height: 8, interactive: false },
        },
      },
    }),
  );
  return catalog;
}

test("portable story sessions apply controls, replay commands, and document variants", async () => {
  const catalog = commandCatalog();
  const session = await TuilStorySession.open(catalog, {
    storyId: "commands",
    variant: "Interactive",
  });
  try {
    expect(session.snapshot().frame).toContain("Ready: idle");
    await session.setArgs({ label: "Updated" });
    await session.press("x");
    expect(session.snapshot().frame).toContain("Updated: typed");
    await session.press("enter");
    expect(session.snapshot().frame).toContain("Updated: submitted");

    await session.setControls({
      width: 45,
      height: 9,
      colorDepth: 8,
      theme: "default-light",
      interactive: false,
      reducedMotion: true,
    });
    const staticSession = session.snapshot();
    expect(staticSession.controls).toMatchObject({
      width: 45,
      height: 9,
      colorDepth: 8,
      theme: "default-light",
      interactive: false,
    });
    expect(staticSession.actions.map((action) => action.type)).toContain(
      "resize",
    );
  } finally {
    await session.close();
  }
  expect(() => session.snapshot()).toThrow("Story session is closed");

  const playback = await renderStoryRequest(catalog, {
    storyId: "commands",
    variant: "Static",
  });
  expect(playback.frame).toContain("Playback: idle");
  const snapshots = await generateStoryCatalogSnapshots(catalog, {
    maxStories: 2,
  });
  expect(Object.keys(snapshots["commands"] ?? {})).toEqual([
    "Interactive",
    "Static",
  ]);
  const docs = await generateStoryCatalogDocumentation(catalog, {
    maxStories: 2,
  });
  expect(docs["commands"]).toContain("# Commands");
  expect(docs["commands"]).toContain("## Interactive");
  await expect(
    generateStoryCatalogSnapshots(catalog, { maxStories: 1 }),
  ).rejects.toThrow("exceeds the configured");
});

test("story bridge validates JSON controls and maps body and render failures", async () => {
  const accepted = validateStoryBridgeRequest({
    storyId: "commands",
    variant: "Interactive",
    args: { nested: [{ value: true }] },
    controls: {
      width: 80,
      height: 24,
      colorDepth: 24,
      unicode: true,
      theme: "default-dark",
      platform: "linux",
      interactive: true,
      reducedMotion: true,
      mouse: true,
      hyperlinks: true,
    },
    inputs: ["x", "enter"],
  });
  expect(accepted.inputs).toEqual(["x", "enter"]);
  expect(Object.isFrozen(accepted)).toBe(true);

  let nestedArgs: Record<string, unknown> = { value: true };
  for (let depth = 0; depth <= storyHttpLimits.maxArgsDepth; depth++) {
    nestedArgs = { child: nestedArgs };
  }
  expect(() =>
    validateStoryBridgeRequest({
      storyId: "",
      variant: "Interactive",
    }),
  ).toThrow("storyId is invalid");
  expect(() =>
    validateStoryBridgeRequest({
      storyId: "commands",
      variant: "Interactive",
      args: nestedArgs,
    }),
  ).toThrow("maximum nesting depth");
  expect(() =>
    validateStoryBridgeRequest({
      storyId: "commands",
      variant: "Interactive",
      inputs: [1],
    }),
  ).toThrow("Story inputs must contain");
  expect(() =>
    validateStoryBridgeRequest({
      storyId: "commands",
      variant: "Interactive",
      controls: { width: storyHttpLimits.minWidth - 1 },
    }),
  ).toThrow("width");
  expect(() =>
    validateStoryBridgeRequest({
      storyId: "commands",
      variant: "Interactive",
      controls: { interactive: "yes" },
    }),
  ).toThrow("boolean");
  expect(() =>
    validateStoryBridgeRequest({
      storyId: "commands",
      variant: "Interactive",
      controls: { platform: "browser" },
    }),
  ).toThrow("platform");

  const url = "http://localhost/api/tuil-story";
  const badLength = await handleStoryHttpRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-length": "100" },
      body: "{}",
    }),
    async () => {
      throw new Error("renderer must not run");
    },
    { maxBodyBytes: 8 },
  );
  expect(badLength.status).toBe(400);

  const missingBody = await handleStoryHttpRequest(
    new Request(url, { method: "POST" }),
    async () => {
      throw new Error("renderer must not run");
    },
  );
  expect(missingBody.status).toBe(400);

  const invalidUtf8 = await handleStoryHttpRequest(
    new Request(url, {
      method: "POST",
      body: new Uint8Array([0xff]),
    }),
    async () => {
      throw new Error("renderer must not run");
    },
  );
  expect(invalidUtf8.status).toBe(400);

  const failedRender = await handleStoryHttpRequest(
    new Request(url, {
      method: "POST",
      body: JSON.stringify({
        storyId: "commands",
        variant: "Interactive",
      }),
    }),
    async () => {
      throw "synthetic renderer failure";
    },
  );
  expect(failedRender.status).toBe(400);
  expect(await failedRender.json()).toEqual({
    error: "synthetic renderer failure",
  });

  const controller = new AbortController();
  controller.abort(new Error("synthetic client abort"));
  const aborted = await handleStoryHttpRequest(
    new Request(url, {
      method: "POST",
      body: JSON.stringify({
        storyId: "commands",
        variant: "Interactive",
      }),
      signal: controller.signal,
    }),
    async () => {
      throw new Error("renderer must not run");
    },
  );
  expect(aborted.status).toBe(499);
});

test("waiting story sessions cancel independently and release the renderer in order", async () => {
  const catalog = commandCatalog();
  const location = { storyId: "commands", variant: "Interactive" };
  const first = await TuilStorySession.open(catalog, location);
  const controller = new AbortController();
  const reason = new Error("queued session cancelled");
  try {
    const rejected = TuilStorySession.open(catalog, {
      ...location,
      signal: controller.signal,
    });
    controller.abort(reason);
    await expect(rejected).rejects.toBe(reason);
    expect(first.snapshot().frame).toContain("Ready: idle");
    await first.setControls({ colorDepth: 1 });
    expect(first.controls.colorDepth).toBe(1);

    const waiting = renderStoryRequest(catalog, {
      ...location,
      inputs: ["x", "enter"],
      controls: { colorDepth: 4 },
    });
    await first.close();
    const replacement = await waiting;
    expect(replacement.controls.colorDepth).toBe(4);
    expect(replacement.frame).toContain("Ready: submitted");
  } finally {
    await first.close();
  }
  await expect(
    renderStoryRequest(catalog, { ...location, variant: "Missing" }),
  ).rejects.toThrow("Unknown variant");
  expect((await renderStoryRequest(catalog, location)).frame).toContain(
    "Ready: idle",
  );
});

test("portable render requests enforce documented limits before acquiring a terminal", async () => {
  const catalog = commandCatalog();
  const location = { storyId: "commands", variant: "Static" };
  await expect(
    renderStoryRequest(catalog, {
      ...location,
      inputs: Array.from({ length: storyHttpLimits.maxInputs + 1 }, () => "x"),
    }),
  ).rejects.toThrow("at most 100 simulated inputs");
  await expect(
    renderStoryRequest(catalog, {
      ...location,
      inputs: ["x".repeat(storyHttpLimits.maxInputLength + 1)],
    }),
  ).rejects.toThrow("cannot exceed 1024 characters");
  await expect(
    generateStoryCatalogSnapshots(catalog, { maxStories: 0 }),
  ).rejects.toThrow("positive integer");
  const controller = new AbortController();
  const reason = new Error("catalog generation cancelled");
  controller.abort(reason);
  await expect(
    generateStoryCatalogSnapshots(catalog, { signal: controller.signal }),
  ).rejects.toBe(reason);
  await expect(
    handleStoryHttpRequest(
      new Request("http://localhost/", {
        method: "POST",
        body: "{}",
      }),
      async () => {
        throw new Error("unexpected render");
      },
      { maxBodyBytes: 0 },
    ),
  ).rejects.toThrow("Story body limit");
});
