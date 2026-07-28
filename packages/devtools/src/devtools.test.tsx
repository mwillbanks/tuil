import { afterEach, expect, test } from "bun:test";
import { defineCommand } from "@mwillbanks/tuil";
import { Text } from "@mwillbanks/tuil-ink";
import { createPlugin } from "@mwillbanks/tuil-plugin";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement, Fragment } from "react";
import {
  builtInDevtoolsPanelIds,
  DevtoolsStore,
  devtoolsPanels,
  inspectRuntime,
  TuilDevtools,
} from "./index.tsx";

afterEach(cleanup);

test("inspects runtime panels and bounds observed events", async () => {
  const instance = renderTuil(createElement(Text, null, "application"), {
    plugins: [
      createPlugin({
        id: "inspected",
        version: "1.0.0",
        setup() {},
      }),
    ],
  });
  await instance.ready;
  instance.app.commands.register(
    defineCommand({ id: "save", title: "Save", execute() {} }),
  );
  const store = new DevtoolsStore(instance.app, { maxEvents: 2 });
  await instance.app.events.emit("app:ready", {
    appId: instance.app.id,
    state: "ready",
  });
  await instance.app.events.emit("app:mount", {
    appId: instance.app.id,
    state: "ready",
  });
  await instance.app.events.emit("app:stop", {
    appId: instance.app.id,
    state: "ready",
  });
  expect(store.inspect("Events").rows).toHaveLength(2);
  expect(inspectRuntime(instance.app, "Commands").rows[0]).toContain("save");
  expect(inspectRuntime(instance.app, "Theme").rows).toContain(
    `id: ${instance.app.theme.id}`,
  );
  instance.app.services.register("primitive", 42);
  instance.app.services.register("named", { name: "service-name" });
  const routes = instance.app.extensions["routes"];
  const workflows = instance.app.extensions["workflows"];
  const operationExecutors = instance.app.extensions["operationExecutors"];
  if (!routes || !workflows || !operationExecutors) {
    throw new Error("Expected runtime extension registries");
  }
  routes.register(null);
  routes.register("route-string");
  routes.register(function routeHandler() {});
  routes.register(() => undefined);
  routes.register(7);
  routes.register({ id: "route-id" });
  routes.register({ title: "route-title" });
  routes.register({});
  workflows.register({ status: "running" });
  operationExecutors.register({ path: "/operation" });
  instance.app.focus.registerNode({
    id: "focus-node",
    label: "Focus node",
    order: 0,
    disabled: false,
    hidden: false,
  });
  instance.app.focus.focus("focus-node");
  instance.app.layout.upsert({
    id: "pointer-node",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    clip: { x: 0, y: 0, width: 1, height: 1 },
    zIndex: 0,
    focusable: true,
    pointerEvents: "auto",
    semantics: { role: "button", label: "Pointer node" },
  });
  instance.app.hotkeys.register({
    keys: "ctrl+s",
    title: "Save handler",
    handler: () => undefined,
  });
  await instance.app.hotkeys.dispatch("s", { ctrl: true });
  expect(inspectRuntime(instance.app, "Plugins").rows[0]).toContain(
    "inspected",
  );
  for (const panel of devtoolsPanels) {
    expect(inspectRuntime(instance.app, panel).panel).toBe(panel);
  }
  expect(inspectRuntime(instance.app, "Routes").rows).toEqual([
    "null",
    "route-string",
    "routeHandler",
    "function",
    "7",
    "route-id",
    "route-title",
    "Object",
  ]);
  expect(inspectRuntime(instance.app, "Workflows").rows).toEqual(["running"]);
  expect(inspectRuntime(instance.app, "Operations").rows).toEqual([
    "/operation",
  ]);
  expect(() => new DevtoolsStore(instance.app, { maxEvents: 0 })).toThrow(
    "positive integer",
  );
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  const version = store.version();
  store.refresh();
  expect(store.version()).toBe(version + 1);
  expect(notifications).toBe(1);
  unsubscribe();
  store.dispose();
  store.refresh();
  store.dispose();
  await instance.cleanup();
});

test("renders and toggles the optional overlay", async () => {
  const instance = renderTuil(
    createElement(
      Fragment,
      null,
      createElement(Text, null, "application"),
      createElement(TuilDevtools),
    ),
  );
  await instance.ready;
  expect(instance.screen.frame()).not.toContain("tuil Devtools");
  await instance.user.press("\u0004");
  expect(instance.screen.frame()).toContain("tuil Devtools");
  await instance.user.press("arrowRight");
  expect(instance.screen.frame()).toContain("Services");
  await instance.user.press("arrowLeft");
  expect(instance.screen.frame()).toContain("Application Lifecycle");
  await instance.user.press("tab");
  expect(instance.screen.frame()).toContain("Services");
  await instance.user.press("unhandled");
  await instance.user.press("\u0004");
  expect(instance.screen.frame()).not.toContain("tuil Devtools");
  await instance.cleanup();
});

test("refreshes an open panel when runtime registries change", async () => {
  const instance = renderTuil(
    createElement(TuilDevtools, {
      initiallyOpen: true,
      refreshIntervalMs: 16,
    }),
  );
  await instance.ready;
  await instance.user.press("arrowRight");
  await instance.user.press("arrowRight");
  expect(instance.screen.frame()).toContain("Commands Keymaps");
  const registration = instance.app.commands.register(
    defineCommand({
      id: "dynamic",
      title: "Dynamic command",
      execute() {},
    }),
  );
  await Bun.sleep(20);
  expect(instance.screen.frame()).toContain("Dynamic command");
  await registration.dispose();
  await instance.cleanup();
});

test("discovers lifecycle-owned editor, log, and streaming resources", async () => {
  const editorInstance = renderTuil(
    createElement(TuilDevtools, {
      initiallyOpen: true,
      refreshIntervalMs: 16,
    }),
  );
  await editorInstance.ready;
  const editor = editorInstance.app.createEditorSession({
    value: "inspect me",
  });
  await editorInstance.user.press("/");
  await editorInstance.user.press("editor state");
  await editorInstance.user.press("enter");
  expect(editorInstance.screen.frame()).toContain("editor-session-1");
  expect(editorInstance.screen.frame()).toContain("inspect me");
  editor.dispose();
  await editorInstance.cleanup();

  const logInstance = renderTuil(
    createElement(TuilDevtools, { initiallyOpen: true }),
  );
  await logInstance.ready;
  const logs = logInstance.app.createLogPipeline();
  const streaming = logInstance.app.createStreamingPipeline({
    format: "text",
  });
  logs.ingest("inspect log");
  await streaming.write("inspect stream");
  await logInstance.user.press("/");
  await logInstance.user.press("log state");
  await logInstance.user.press("enter");
  expect(logInstance.screen.frame()).toContain("log-pipeline-1");
  expect(logInstance.screen.frame()).toContain("inspect log");
  expect(logInstance.screen.frame()).toContain("streaming-pipeline-1");
  expect(logInstance.screen.frame()).toContain("inspect stream");
  await logInstance.cleanup();
});

test("renders panels contributed through the plugin extension point", async () => {
  const instance = renderTuil(
    createElement(TuilDevtools, { initiallyOpen: true }),
    {
      plugins: [
        createPlugin({
          id: "devtools-panel",
          version: "1.0.0",
          setup({ devtoolsPanels }) {
            return devtoolsPanels.register({
              id: "cache",
              title: "Cache",
              inspect: () => ({ entries: 3, status: "ready" }),
            });
          },
        }),
      ],
    },
  );
  await instance.ready;
  for (let index = 0; index < builtInDevtoolsPanelIds.length; index += 1) {
    await instance.user.press("arrowRight");
  }
  expect(instance.screen.frame()).toContain("Cache");
  expect(instance.screen.frame()).toContain("entries: 3");
  await instance.cleanup();
});

test("mirrors dynamic plugin panels without disposing plugin-owned resources", async () => {
  let contributionDisposals = 0;
  const instance = renderTuil(
    createElement(TuilDevtools, {
      initiallyOpen: true,
      refreshIntervalMs: 16,
    }),
  );
  await instance.ready;
  const registration = instance.app.extensions.devtoolsPanels.register({
    id: "dynamic-cache",
    title: "Dynamic Cache",
    inspect: () => ({ entries: 2 }),
    dispose: () => {
      contributionDisposals += 1;
    },
  });

  await Bun.sleep(20);
  await instance.user.press("/");
  await instance.user.press("dynamic cache");
  await instance.user.press("enter");
  expect(instance.screen.frame()).toContain("Dynamic Cache");
  expect(instance.screen.frame()).toContain("entries: 2");

  await registration.dispose();
  await Bun.sleep(20);
  expect(instance.screen.frame()).not.toContain("Dynamic Cache");
  expect(contributionDisposals).toBe(0);

  await instance.cleanup();
  expect(contributionDisposals).toBe(0);
});

test("executes development actions and renders audited history", async () => {
  let executions = 0;
  const instance = renderTuil(
    createElement(TuilDevtools, { initiallyOpen: true }),
    {
      plugins: [
        createPlugin({
          id: "devtools-action",
          version: "1.0.0",
          setup({ devtoolsPanels }) {
            return devtoolsPanels.register({
              id: "clear-cache",
              title: "Clear cache",
              kind: "action",
              permissions: new Set(["write"]),
              serialization: "json",
              run() {
                executions += 1;
              },
            });
          },
        }),
      ],
    },
  );
  await instance.ready;
  expect(instance.screen.frame()).toContain("16 actions · 0 audited");
  await instance.user.press("arrowUp");
  await instance.user.press("a");
  await Bun.sleep(5);
  expect(executions).toBe(1);
  expect(instance.screen.frame()).toContain("Clear cache succeeded");
  expect(instance.screen.frame()).toContain("16 actions · 1 audited");
  await instance.cleanup();
});

test("passes the full current theme to theme factory actions", async () => {
  const instance = renderTuil(
    createElement(TuilDevtools, { initiallyOpen: true }),
  );
  await instance.ready;
  const actionBases: (typeof instance.app.theme)[] = [];
  instance.app.extensions.themes.register((base) => {
    actionBases.push(base);
    return {
      ...base,
      id: `${base.id}-alternate`,
      colors: {
        ...base.colors,
        primary: {
          ...base.colors.primary,
          foreground: base.colors.foreground,
        },
      },
    };
  });
  actionBases.length = 0;

  for (let index = 0; index < 3; index += 1) {
    await instance.user.press("arrowDown");
  }
  await instance.user.press("a");
  await Bun.sleep(5);

  expect(actionBases.at(-1)?.colors.foreground).toBeDefined();
  expect(instance.screen.frame()).toContain("toggle theme succeeded");
  await instance.cleanup();
});

test("log actions operate only on lifecycle-owned log pipelines", async () => {
  let serviceClears = 0;
  let serviceReplays = 0;
  const instance = renderTuil(
    createElement(TuilDevtools, { initiallyOpen: true }),
  );
  await instance.ready;
  instance.app.services.register("unrelated-cache", {
    clear() {
      serviceClears += 1;
    },
    replay() {
      serviceReplays += 1;
    },
  });
  const pipeline = instance.app.createLogPipeline();
  pipeline.ingest("before clear");

  for (let index = 0; index < 10; index += 1) {
    await instance.user.press("arrowDown");
  }
  await instance.user.press("a");
  await Bun.sleep(5);
  expect(pipeline.buffer.records()).toEqual([]);
  expect(serviceClears).toBe(0);

  await instance.user.press("arrowDown");
  await instance.user.press(":");
  await instance.user.press("replayed fixture");
  await instance.user.press("enter");
  await instance.user.press("a");
  await Bun.sleep(5);
  expect(pipeline.buffer.records().at(-1)?.body).toBe("replayed fixture");
  expect(serviceReplays).toBe(0);
  await instance.cleanup();
});

test("routes keyboard editing, built-in actions, search, and workspace pins", async () => {
  let commandRuns = 0;
  const instance = renderTuil(
    createElement(TuilDevtools, { initiallyOpen: true }),
  );
  await instance.ready;
  instance.app.focus.registerNode({
    id: "focus-node",
    label: "Focus node",
    order: 0,
    disabled: false,
    hidden: false,
  });
  instance.app.commands.register(
    defineCommand({
      id: "focus-node",
      title: "Focus command",
      execute() {
        commandRuns += 1;
      },
    }),
  );

  await instance.user.press(":");
  await instance.user.press("focus-node");
  await instance.user.press("enter");
  await instance.user.press("a");
  await Bun.sleep(5);
  expect(instance.app.focus.focusedId).toBe("focus-node");
  expect(instance.screen.frame()).toContain("focus component succeeded");

  await instance.user.press("arrowDown");
  await instance.user.press("a");
  await Bun.sleep(5);
  expect(commandRuns).toBe(1);
  expect(instance.screen.frame()).toContain("execute command succeeded");

  await instance.user.press("p");
  expect(instance.screen.frame()).toContain("pinned");
  await instance.user.press("/");
  await instance.user.press("Services");
  await instance.user.press("backspace");
  await instance.user.press("s");
  await instance.user.press("enter");
  expect(instance.screen.frame()).toContain("Services");
  await instance.cleanup();
});

test("is a hook-free no-op in production", () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = environment["NODE_ENV"];
  environment["NODE_ENV"] = "production";
  try {
    expect(TuilDevtools({})).toBeNull();
  } finally {
    if (previous === undefined) {
      delete environment["NODE_ENV"];
    } else {
      environment["NODE_ENV"] = previous;
    }
  }
});
