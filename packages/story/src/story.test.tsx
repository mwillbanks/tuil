import { afterEach, expect, test } from "bun:test";
import { useApp } from "@mwillbanks/tuil";
import { Text } from "@mwillbanks/tuil-ink";
import { cleanup } from "@mwillbanks/tuil-testing-ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ansiFrameToHtml,
  createFumadocsStoryAdapter,
  createTerminalStoryFrameEffect,
  TerminalStoryFrame,
  TerminalStoryFrameView,
} from "./browser.tsx";
import {
  createStoryHttpHandler,
  defineTuilStories,
  generateStoryCatalogSnapshots,
  renderStoryRequest,
  storyFrameToMarkdown,
  TuilStoryCatalog,
  TuilStorySession,
} from "./index.tsx";
import {
  createStaticStoryHttpHandler,
  renderStaticStoryRequest,
  StaticStoryCatalog,
} from "./static.ts";
import { createStorybookAdapter } from "./storybook.tsx";

afterEach(cleanup);

function Greeting(props: { readonly label: string; readonly width: number }) {
  const app = useApp();
  return createElement(
    Text,
    {
      color: app.theme.colors.primary.foreground,
      role: "status",
      label: props.label,
    },
    props.label.repeat(props.width),
  );
}

const definition = defineTuilStories({
  component: Greeting,
  stories: {
    Default: {
      args: { label: "Ready", width: 3 },
      terminal: { width: 60, reducedMotion: true },
    },
  },
});

function catalog() {
  const catalog = new TuilStoryCatalog();
  catalog.register("greeting", "Greeting", definition);
  return catalog;
}

test("renders portable stories, updates args, and records controls", async () => {
  const session = await TuilStorySession.open(catalog(), {
    storyId: "greeting",
    variant: "Default",
  });
  expect(session.snapshot().frame).toContain("Ready");
  await session.setArgs({ label: "Updated" });
  expect(session.snapshot().frame).toContain("Updated");
  await session.setControls({ width: 42 });
  expect(session.snapshot().controls.width).toBe(42);
  expect(session.snapshot().actions.map((action) => action.type)).toContain(
    "resize",
  );
  await session.close();
  await expect(session.setArgs({ label: "closed" })).rejects.toThrow(
    "session is closed",
  );
  await expect(session.setControls({ width: 50 })).rejects.toThrow(
    "session is closed",
  );
});

test("catalog and story session lifetimes cover validation and cancellation", async () => {
  const stories = new TuilStoryCatalog();
  const greeting = stories.register("greeting", "Zulu", definition);
  stories.register("alternate", "Alpha", definition);
  expect(stories.list().map((set) => set.id)).toEqual([
    "alternate",
    "greeting",
  ]);
  expect(() => stories.register("", "Empty", definition)).toThrow(
    "cannot be empty",
  );
  expect(() => stories.register("greeting", "Duplicate", definition)).toThrow(
    "already registered",
  );

  const session = await TuilStorySession.open(stories, {
    storyId: "greeting",
    variant: "Default",
    controls: { colorDepth: 4 },
  });
  expect(session.args["label"]).toBe("Ready");
  expect(session.controls.colorDepth).toBe(4);
  await session.press("enter");

  const waitingController = new AbortController();
  const waiting = TuilStorySession.open(stories, {
    storyId: "alternate",
    variant: "Default",
    signal: waitingController.signal,
  });
  waitingController.abort(new Error("cancel queued story"));
  await expect(waiting).rejects.toThrow("cancel queued story");
  await session.close();
  await session.close();

  greeting.dispose();
  greeting.dispose();
  expect(stories.get("greeting")).toBeUndefined();
  await expect(
    TuilStorySession.open(stories, {
      storyId: "missing",
      variant: "Default",
    }),
  ).rejects.toThrow("Unknown story set");
  await expect(
    TuilStorySession.open(stories, {
      storyId: "alternate",
      variant: "Missing",
    }),
  ).rejects.toThrow("Unknown variant");
});

test("serves normalized frames through the browser bridge", async () => {
  const stories = catalog();
  const handler = createStoryHttpHandler(stories);
  const response = await handler(
    new Request("http://localhost/api/tuil-story", {
      method: "POST",
      body: JSON.stringify({
        storyId: "greeting",
        variant: "Default",
        args: { label: "Browser" },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const frame = (await response.json()) as { readonly frame: string };
  expect(frame.frame).toContain("Browser");
  expect(
    (await handler(new Request("http://localhost/api/tuil-story"))).status,
  ).toBe(405);
});

test("renders browser frames and reports bridge failures", async () => {
  const request = {
    storyId: "greeting",
    variant: "Default",
  } as const;
  const frame = await renderStoryRequest(catalog(), request);
  const frameHtml = ansiFrameToHtml(frame.ansiFrame);
  const rendered = renderToStaticMarkup(
    createElement(TerminalStoryFrameView, {
      request,
      inspector: true,
      frame,
      frameHtml,
      status: "",
    }),
  );
  expect(rendered).toContain("data-tuil-inspector");
  expect(rendered).toContain("Frame inspection");
  expect(
    renderToStaticMarkup(
      createElement(TerminalStoryFrameView, {
        request,
        inspector: false,
        status: "Rendering terminal story…",
      }),
    ),
  ).toContain("Rendering terminal story");
  expect(
    renderToStaticMarkup(
      createElement(TerminalStoryFrame, {
        ...request,
        inspector: false,
      }),
    ),
  ).toContain("Rendering terminal story");

  const originalFetch = globalThis.fetch;
  const frames: Array<typeof frame | undefined> = [];
  const statuses: string[] = [];
  try {
    globalThis.fetch = (() =>
      Promise.resolve(Response.json(frame))) as unknown as typeof fetch;
    const disposeSuccess = createTerminalStoryFrameEffect({
      endpoint: "/story",
      body: JSON.stringify(request),
      setFrame: (value) => frames.push(value),
      setStatus: (value) => statuses.push(value),
    })();
    await Bun.sleep(0);
    expect(frames.at(-1)?.frame).toContain("Ready");
    expect(statuses.at(-1)).toBe("");
    disposeSuccess();

    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ error: "Bridge failed" }, { status: 500 }),
      )) as unknown as typeof fetch;
    const disposeFailure = createTerminalStoryFrameEffect({
      endpoint: "/story",
      body: JSON.stringify(request),
      setFrame: (value) => frames.push(value),
      setStatus: (value) => statuses.push(value),
    })();
    await Bun.sleep(0);
    expect(frames.at(-1)).toBeUndefined();
    expect(statuses.at(-1)).toBe("Bridge failed");
    disposeFailure();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("produces Storybook, Fumadocs, snapshot, and documentation adapters", async () => {
  const stories = catalog();
  const set = stories.get("greeting");
  if (!set) throw new Error("missing story");
  const storybook = createStorybookAdapter(set);
  expect(storybook.meta.argTypes?.["terminalWidth"]).toBeDefined();
  expect(storybook.meta.argTypes?.["terminalInput"]).toBeDefined();
  expect(
    (
      storybook.stories["Default"]?.args as
        | Readonly<Record<string, unknown>>
        | undefined
    )?.["terminalWidth"],
  ).toBe(60);
  const fumadocs = createFumadocsStoryAdapter(set)["Default"];
  if (!fumadocs) throw new Error("missing Fumadocs story");
  const fumadocsElement = fumadocs.Component({
    ...fumadocs.args.initial,
    terminalWidth: 41,
    width: 4,
    terminalInput: "enter",
  }) as ReactElement<{
    readonly controls: { readonly width: number };
    readonly args: { readonly width: number };
    readonly inputs: readonly string[];
  }>;
  expect(fumadocsElement.props.controls.width).toBe(41);
  expect(fumadocsElement.props.args.width).toBe(4);
  expect(fumadocsElement.props.inputs).toEqual(["enter"]);
  const storybookElement = (
    storybook.stories["Default"]?.render as
      | ((args: Readonly<Record<string, unknown>>) => ReactElement<{
          readonly controls: { readonly width: number };
          readonly args: { readonly width: number };
        }>)
      | undefined
  )?.({
    ...(storybook.stories["Default"]?.args as Readonly<
      Record<string, unknown>
    >),
    terminalWidth: 43,
    width: 5,
  });
  expect(storybookElement?.props.controls.width).toBe(43);
  expect(storybookElement?.props.args.width).toBe(5);
  const frame = await renderStoryRequest(stories, {
    storyId: "greeting",
    variant: "Default",
  });
  expect(storyFrameToMarkdown(frame)).toContain("### Semantics");
  expect(frame.ansiFrame).toContain("\u001b[");
  expect(ansiFrameToHtml(frame.ansiFrame)).toContain("<span");
});

test("catalog snapshots are deterministic and omit live telemetry", async () => {
  const first = await generateStoryCatalogSnapshots(catalog());
  const second = await generateStoryCatalogSnapshots(catalog());
  expect(second).toEqual(first);
  const serialized = JSON.stringify(first);
  expect(serialized).not.toContain('"events"');
  expect(serialized).not.toContain('"actions"');
  expect(serialized).not.toContain('"timestamp"');
});

test("applies width, color depth, and theme controls to rendered frames", async () => {
  const narrow = await renderStoryRequest(catalog(), {
    storyId: "greeting",
    variant: "Default",
    args: { label: "terminal", width: 20 },
    controls: { width: 24, colorDepth: 24, theme: "default-dark" },
  });
  const wide = await renderStoryRequest(catalog(), {
    storyId: "greeting",
    variant: "Default",
    args: { label: "terminal", width: 20 },
    controls: { width: 80, colorDepth: 24, theme: "default-light" },
  });
  expect(narrow.frame).not.toBe(wide.frame);
  expect(
    Math.max(...narrow.frame.split("\n").map((line) => line.length)),
  ).toBeLessThanOrEqual(24);
  expect(narrow.ansiFrame).not.toBe(wide.ansiFrame);
});

test("honors cancellation and bounds simulated inputs", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    renderStoryRequest(
      catalog(),
      { storyId: "greeting", variant: "Default" },
      { signal: controller.signal },
    ),
  ).rejects.toThrow();
  await expect(
    renderStoryRequest(catalog(), {
      storyId: "greeting",
      variant: "Default",
      inputs: Array.from({ length: 101 }, () => "tab"),
    }),
  ).rejects.toThrow("at most 100");
});

test("aborts a story that never reaches its first committed frame", async () => {
  const suspended = new Promise<never>(() => {});
  function NeverReady(): never {
    throw suspended;
  }
  const stories = new TuilStoryCatalog();
  stories.register(
    "never-ready",
    "Never ready",
    defineTuilStories({
      component: NeverReady,
      stories: { Default: { args: {} } },
    }),
  );
  const controller = new AbortController();
  const opening = TuilStorySession.open(stories, {
    storyId: "never-ready",
    variant: "Default",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  await expect(
    Promise.race([
      opening,
      Bun.sleep(1_000).then(() => {
        throw new Error("Never-ready story did not honor cancellation");
      }),
    ]),
  ).rejects.toThrow();
  expect(
    (
      await renderStoryRequest(catalog(), {
        storyId: "greeting",
        variant: "Default",
      })
    ).frame,
  ).toContain("Ready");
});

test("serves a static adapter with complete terminal controls", async () => {
  function StaticGreeting(props: { readonly label: string }) {
    return createElement(
      Text,
      { role: "status", label: props.label },
      props.label,
    );
  }
  const staticDefinition = defineTuilStories({
    component: StaticGreeting,
    stories: {
      Default: { args: { label: "Ready", width: 1 } },
    },
  });
  const staticCatalog = new StaticStoryCatalog();
  const unregister = staticCatalog.register("greeting", staticDefinition);
  expect(
    (
      await renderStaticStoryRequest(staticCatalog, {
        storyId: "greeting",
        variant: "Default",
        args: { label: "Static server" },
        controls: {
          height: 12,
          unicode: false,
          theme: "default-light",
        },
      })
    ).frame,
  ).toContain("Static server");
  expect(
    (
      await renderStaticStoryRequest(staticCatalog, {
        storyId: "greeting",
        variant: "Default",
        controls: { height: 12, unicode: false, theme: "default-light" },
      })
    ).controls,
  ).toMatchObject({
    height: 12,
    unicode: false,
    theme: "default-light",
    interactive: false,
  });
  const response = await createStaticStoryHttpHandler(staticCatalog)(
    new Request("http://localhost/story", {
      method: "POST",
      body: JSON.stringify({
        storyId: "greeting",
        variant: "Default",
      }),
    }),
  );
  expect(response.status).toBe(200);
  await unregister();
  expect(staticCatalog.runtimeCatalog.get("greeting")).toBeUndefined();
});
