import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { createPlugin } from "@mwillbanks/tuil-plugin";
import {
  cleanup,
  renderTuil,
  type TuilTestInstance,
} from "@mwillbanks/tuil-testing-ink";
import {
  DevtoolsStore,
  TuilDevtools,
} from "../../packages/devtools/src/index.tsx";

afterEach(cleanup);
async function open() {
  const instance = renderTuil(
    createElement(TuilDevtools, { initiallyOpen: true }),
  );
  await instance.ready;
  return instance;
}
async function action(instance: TuilTestInstance, index: number) {
  for (let n = 0; n < index; n++) await instance.user.press("arrowDown");
}
async function argument(instance: TuilTestInstance, input: string) {
  await instance.user.press(":");
  await instance.user.press(input);
  await instance.user.press("enter");
}
test("route actions parse structured arguments, invoke navigation, and report failures", async () => {
  const instance = await open();
  let received: unknown;
  instance.app.extensions["routes"]!.register({
    id: "route-a",
    navigate(input: unknown) {
      received = input;
    },
  });
  await action(instance, 2);
  await argument(instance, '{"id":"route-a"}');
  await instance.user.press("a");
  expect(received).toEqual({ id: "route-a" });
  expect(instance.screen.frame()).toContain("open route succeeded");
  await instance.user.press(":");
  for (let n = 0; n < '{"id":"route-a"}'.length; n++)
    await instance.user.press("backspace");
  await instance.user.press("{bad");
  await instance.user.press("escape");
  await instance.user.press("a");
  expect(instance.screen.frame()).toContain("cannot be opened");
  await instance.cleanup();
});
test("render actions pause, resume, resize, and dump live renderer state", async () => {
  const instance = await open();
  await action(instance, 4);
  await instance.user.press("a");
  expect(instance.app.renderTelemetry.snapshot().paused).toBe(true);
  await instance.user.press("arrowDown");
  await instance.user.press("a");
  expect(instance.app.renderTelemetry.snapshot().paused).toBe(false);
  await instance.user.press("arrowDown");
  await argument(instance, '{"width":92,"height":30}');
  await instance.user.press("a");
  expect(instance.screen.frame()).toContain("force resize succeeded");
  for (const title of ["dump frame", "dump semantics", "dump layout"]) {
    await instance.user.press("arrowDown");
    await instance.user.press("a");
    expect(instance.screen.frame()).toContain(
      title === "dump frame"
        ? "No rendered frame is available"
        : title + " succeeded",
    );
  }
  await instance.cleanup();
});
test("editor reset replaces owned content and workflow inspection invokes snapshots", async () => {
  const instance = await open();
  const editor = instance.app.createEditorSession({ value: "original" });
  await action(instance, 12);
  await argument(instance, '{"text":"replacement"}');
  await instance.user.press("a");
  expect(editor.snapshot().document.text).toBe("replacement");
  expect(instance.screen.frame()).toContain("reset editor succeeded");
  let inspected = 0;
  instance.app.extensions["workflows"]!.register({
    id: "flow",
    snapshot() {
      inspected++;
      return { status: "ready" };
    },
  });
  await instance.user.press("arrowDown");
  await instance.user.press("a");
  expect(inspected).toBe(1);
  expect(instance.screen.frame()).toContain("inspect workflow succeeded");
  editor.dispose();
  await instance.cleanup();
});
test("parser diagnostics call registered providers and skip noncallable entries", async () => {
  const instance = await open();
  const received: unknown[] = [];
  const parser = {
    id: "diagnostic-fixture",
    detect: () => 0,
    parse: () => [],
    diagnostics(input: unknown) {
      received.push(input);
      return { warnings: [] };
    },
  };
  instance.app.extensions["logParsers"]!.register(parser);
  instance.app.extensions["logParsers"]!.register({
    id: "no-method",
    detect: () => 0,
    parse: () => [],
  });
  await action(instance, 14);
  await argument(instance, '{"verbose":true}');
  await instance.user.press("a");
  expect(received).toContainEqual({ verbose: true });
  expect(instance.screen.frame()).toContain(
    "verbose parser diagnostics succeeded",
  );
  await instance.cleanup();
});
test("contributed panels flatten nested, empty, circular, and primitive inspection values", async () => {
  const circular: Record<string, unknown> = {};
  circular["self"] = circular;
  const instance = renderTuil(
    createElement(TuilDevtools, { initiallyOpen: true }),
    {
      plugins: [
        createPlugin({
          id: "shape-inspection",
          version: "1.0.0",
          setup({ devtoolsPanels }) {
            return devtoolsPanels.register({
              id: "shape-fixture",
              title: "Shape fixture",
              inspect: () => ({
                empty: [],
                object: {},
                nil: null,
                list: ["value"],
                circular,
                deep: { a: { b: { c: { d: { e: { f: "leaf" } } } } } },
              }),
            });
          },
        }),
      ],
    },
  );
  await instance.ready;
  await instance.user.press("/");
  await instance.user.press("Shape fixture");
  await instance.user.press("enter");
  const frame = instance.screen.frame();
  expect(frame).toContain("empty: []");
  expect(frame).toContain("object: {}");
  expect(frame).toContain("nil: null");
  expect(frame).toContain("list.0: value");
  expect(frame).toContain("[Circular]");
  await instance.user.press("p");
  expect(instance.screen.frame()).toContain("pinned");
  await instance.user.press("p");
  expect(instance.screen.frame()).not.toContain(" pinned");
  await instance.user.press("\u0004");
  expect(instance.screen.frame()).not.toContain("tuil Devtools");
  await instance.user.press("x");
  expect(instance.screen.frame()).not.toContain("tuil Devtools");
  await instance.user.press("\u0004");
  expect(instance.screen.frame()).toContain("Shape fixture");
  await instance.cleanup();
});

test("telemetry panels surface recorded frame, dirty regions, durations, and pointer regions", async () => {
  const instance = await open();
  instance.app.renderTelemetry.record({
    renderer: "fixture",
    timestamp: 123,
    frame: { cells: ["fixture"] },
    durationMs: 3,
    output: { dirtyRects: [{ x: 1 }], changedCells: 2, changedRows: [1] },
  });
  await action(instance, 7);
  await instance.user.press("a");
  expect(instance.screen.frame()).toContain("dump frame succeeded");
  await instance.user.press("/");
  await instance.user.press("Render Frames");
  await instance.user.press("enter");
  expect(instance.screen.frame()).toContain("renderer: fixture");
  expect(instance.screen.frame()).toContain("sequence: 1");
  await instance.user.press("/");
  for (let n = 0; n < "Render Frames".length; n++)
    await instance.user.press("backspace");
  await instance.user.press("Dirty Regions");
  await instance.user.press("enter");
  expect(instance.screen.frame()).toContain("changedCells: 2");
  await instance.cleanup();
});

for (const [input, expected] of [
  ["{}", "content must be a string"],
  ['{"content":1}', "content must be a string"],
  ['{"content":"x","parserId":1}', "parserId must be a string"],
] as const) {
  test("log replay rejects invalid fixture " + input, async () => {
    const instance = await open();
    await action(instance, 11);
    await argument(instance, input);
    await instance.user.press("a");
    expect(instance.screen.frame()).toContain(expected);
    await instance.cleanup();
  });
}
test("store observes runtime resource lifetimes and detaches every subscription", async () => {
  const instance = await open();
  const store = new DevtoolsStore(instance.app);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications++;
  });
  const changed = (operation: () => void) => {
    const previous = store.version();
    operation();
    expect(store.version()).toBeGreaterThan(previous);
  };
  {
    instance.app.focus.registerNode({
      id: "watched",
      order: 0,
      disabled: false,
      hidden: false,
    });
  }
  changed(() => {
    instance.app.focus.focus("watched");
  });
  instance.app.hotkeys.register({ keys: "ctrl+k", handler() {} });
  const beforeHotkey = store.version();
  await instance.app.hotkeys.dispatch("k", { ctrl: true });
  expect(store.version()).toBeGreaterThan(beforeHotkey);
  changed(() => {
    instance.app.createEditorSession({ value: "watched" });
  });
  changed(() => {
    instance.app.createLogPipeline();
  });
  changed(() => {
    instance.app.createStreamingPipeline({ format: "text" });
  });
  changed(() => {
    instance.app.extensions.devtoolsPanels.register({
      id: "watched",
      title: "Watched",
      inspect: () => null,
    });
  });
  expect(notifications).toBeGreaterThanOrEqual(6);
  unsubscribe();
  store.dispose();
  const stopped = store.version();
  instance.app.focus.focus("watched");
  instance.app.createLogPipeline();
  store.refresh();
  expect(store.version()).toBe(stopped);
  await instance.cleanup();
});
