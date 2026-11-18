import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import {
  createRendererComponentRuntime,
  defineRendererApplication,
  FrameScheduler,
  LayoutProjection,
  normalizeRendererHyperlink,
  normalizeRendererScene,
  parseOsc52Response,
  RendererApplicationDriver,
  RendererRegistry,
  runRendererConformance,
  TerminalOutputSession,
  type RendererBackend,
  type RendererContext,
  type RendererOutput,
  type RendererScene,
} from "./index.ts";
let restoreClock: () => void;
beforeEach(() => {
  const clock = spyOn(performance, "now").mockReturnValue(0);
  restoreClock = () => clock.mockRestore();
});
afterEach(() => restoreClock());
const capabilities = {
  width: 4,
  height: 2,
  colorDepth: 24 as const,
  unicode: true,
  hyperlinks: true,
  interactive: true,
  tty: true,
  alternateScreen: true,
  mouse: true,
  images: false,
  reducedMotion: false,
  platform: "linux" as const,
};
function context(signal = new AbortController().signal): RendererContext {
  return {
    signal,
    capabilities,
    mode: "interactive",
    layout: new LayoutProjection(),
  };
}
const output: RendererOutput = {
  bytes: new Uint8Array(),
  changedCells: 0,
  changedRows: [],
  dirtyRects: [],
};
function backend(): RendererBackend<RendererScene> {
  return {
    id: "fixture",
    capabilities: new Set(["cells"]),
    render: () => ({
      width: 4,
      height: 2,
      sequence: 1,
      timestamp: 0,
      payload: [],
    }),
    diff: () => output,
  };
}
test("component runtime preserves immutable snapshots and applies input, resize, and direct updates", async () => {
  const disposed: number[] = [];
  const application = createRendererComponentRuntime({
    initialState: { value: 1 },
    component: ({ state }) => ({ lines: [String(state.value)] }),
    input: (state, value) =>
      value ? { value: state.value + value.length } : undefined,
    resize: (_state, width, height) => ({ value: width * height }),
    dispose: (state) => {
      disposed.push(state.value);
    },
  });
  const initial = application.snapshot();
  await application.input?.("");
  expect(application.snapshot()).toBe(initial);
  await application.input?.("ok");
  expect(application.snapshot()).toEqual({ value: 3 });
  await application.resize?.(2, 3);
  expect(application.snapshot()).toEqual({ value: 6 });
  application.update({ value: 8 });
  application.update((state) => ({ value: state.value + 1 }));
  expect(await application.project(context())).toEqual({ lines: ["9"] });
  expect(initial).toEqual({ value: 1 });
  expect(Object.isFrozen(application.snapshot())).toBe(true);
  await application.dispose?.();
  expect(disposed).toEqual([9]);
});
test("renderer registry ignores stale replacement disposers and promotes remaining defaults", () => {
  const registry = new RendererRegistry();
  const first = backend();
  const remove = registry.register(first);
  const replacement = { ...first };
  const removeReplacement = registry.register(replacement, { replace: true });
  registry.register({ ...first, id: "other" });
  remove();
  expect(registry.resolve()).toBe(replacement);
  removeReplacement();
  expect(registry.resolve().id).toBe("other");
  expect(() => registry.register({ ...first, id: " " })).toThrow(
    "cannot be empty",
  );
});
test("scene normalization validates corresponding styles, dimensions, and absolute links", () => {
  expect(
    normalizeRendererHyperlink("https://example.test/page", false),
  ).toBeUndefined();
  expect(normalizeRendererHyperlink("mailto:help@example.test", true)).toBe(
    "mailto:help@example.test",
  );
  expect(() => normalizeRendererHyperlink("relative/page", true)).toThrow(
    "absolute",
  );
  expect(() =>
    normalizeRendererHyperlink("https://user:pass@example.test", true),
  ).toThrow("credentials");
  expect(() =>
    normalizeRendererHyperlink(
      "https://example.test/" + "a".repeat(4096),
      true,
    ),
  ).toThrow("4096");
  expect(() =>
    normalizeRendererScene(
      { lines: ["a"], styledLines: [[{ text: "b" }]] },
      4,
      2,
    ),
  ).toThrow("must match");
  expect(() =>
    normalizeRendererScene({ lines: [], styledLines: [[]] }, 4, 2),
  ).toThrow("cannot exceed");
  expect(() => normalizeRendererScene({ lines: [] }, 0, 2)).toThrow("positive");
  const scene = normalizeRendererScene(
    {
      lines: ["abc"],
      styledLines: [
        [
          { text: "", style: { foreground: "red", background: "blue" } },
          { text: "abc" },
        ],
      ],
    },
    2,
    2,
  );
  expect(scene.lines).toEqual(["ab"]);
  expect(scene.styledLines?.[0]).toEqual([
    { text: "ab", style: undefined, link: undefined },
  ]);
});
test("driver aborts between projection and rendering and rejects operations after teardown", async () => {
  let renders = 0;
  const controller = new AbortController();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const driver = new RendererApplicationDriver({
    application: defineRendererApplication({
      async project() {
        entered.resolve();
        await release.promise;
        return { lines: ["ready"] };
      },
    }),
    backend: {
      ...backend(),
      render() {
        renders++;
        throw new Error("must not render");
      },
    },
    context,
    session: new TerminalOutputSession({ write: () => true }, "embedded"),
  });
  const pending = driver
    .draw(controller.signal)
    .catch((error: unknown) => error);
  await entered.promise;
  controller.abort(new Error("cancelled"));
  release.resolve();
  expect(String(await pending)).toContain("cancelled");
  expect(renders).toBe(0);
  await driver.dispose();
  await driver.dispose();
  await expect(driver.input("x")).rejects.toThrow("closed");
  await expect(driver.resize(4, 2)).rejects.toThrow("closed");
  await expect(driver.draw(context().signal)).rejects.toThrow("closed");
});
test("driver observes pauses, rendering cancellation, frame callbacks, and complete cleanup", async () => {
  let paused = true;
  let frames = 0;
  let projects = 0;
  let cleaning = false;
  const controller = new AbortController();
  const cleanups: string[] = [];
  const renderer = backend();
  const driver = new RendererApplicationDriver({
    paused: () => paused,
    application: defineRendererApplication({
      project() {
        projects++;
        return { lines: ["ready"] };
      },
      dispose() {
        cleanups.push("application");
        throw new Error("application cleanup");
      },
    }),
    backend: {
      ...renderer,
      dispose() {
        cleanups.push("backend");
        throw new Error("backend cleanup");
      },
    },
    context,
    session: new TerminalOutputSession(
      {
        write: () => true,
        flush() {
          if (cleaning) {
            cleanups.push("session");
            throw new Error("session cleanup");
          }
        },
      },
      "embedded",
    ),
    onFrame(frame) {
      expect(frame.durationMs).toBe(0);
      frames++;
    },
  });
  await driver.draw(controller.signal);
  expect(projects).toBe(0);
  paused = false;
  await driver.draw(controller.signal);
  expect(frames).toBe(1);
  cleaning = true;
  const failure = await driver.dispose().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toHaveLength(3);
  expect(cleanups).toEqual(["session", "backend", "application"]);
  const cancelled = new RendererApplicationDriver({
    application: defineRendererApplication({ project: () => ({ lines: [] }) }),
    backend: {
      ...renderer,
      render() {
        controller.abort(new Error("render cancelled"));
        return renderer.render({ lines: [] }, context());
      },
    },
    context,
    session: new TerminalOutputSession({ write: () => true }, "embedded"),
  });
  await expect(cancelled.draw(controller.signal)).rejects.toThrow(
    "render cancelled",
  );
  await cancelled.dispose();
});
test("output sessions drain backpressure and validate viewport and capture capacities", async () => {
  let drains = 0;
  const session = new TerminalOutputSession(
    {
      write: () => false,
      drain() {
        drains++;
      },
    },
    "embedded",
    { embeddedPassthrough: true },
  );
  await session.flush({ ...output, bytes: new TextEncoder().encode("frame") });
  expect(drains).toBe(1);
  expect(new TextDecoder().decode(session.capturedOutput())).toBe("frame");
  await session.resize(24);
  await session.close();
  for (const options of [
    { rows: 0 },
    { inlineRows: -1 },
    { embeddedCaptureLimitBytes: 0 },
  ])
    expect(
      () => new TerminalOutputSession({ write: () => true }, "inline", options),
    ).toThrow("positive");
  expect(parseOsc52Response("\x1b]52;c")).toBeUndefined();
  expect(parseOsc52Response("\x1b]52;c;YQ==")).toBeUndefined();
  expect(parseOsc52Response("\x1b]52;c;/w==\x07")).toBeUndefined();
});
test("conformance rejects aborted runs and viewport mismatches before assertions", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stopped"));
  await expect(
    runRendererConformance(
      backend(),
      [
        {
          id: "fixture",
          tree: { lines: [] },
          assertFrame() {
            throw new Error("must not assert");
          },
        },
      ],
      context(controller.signal),
    ),
  ).rejects.toThrow("stopped");
  await expect(
    runRendererConformance(
      {
        ...backend(),
        render: () => ({
          width: 1,
          height: 1,
          sequence: 1,
          timestamp: 0,
          payload: [],
        }),
      },
      [{ id: "fixture", tree: { lines: [] }, assertFrame() {} }],
      context(),
    ),
  ).rejects.toThrow("viewport conformance");
});
test("scheduler isolates error observers and settles explicit cancellation without real timers", async () => {
  let callback: (() => void) | undefined;
  const ended = Promise.withResolvers<void>();
  const scheduler = new FrameScheduler(
    () => {
      throw new Error("render failed");
    },
    {
      clock: {
        now: () => 0,
        schedule(value) {
          callback = value;
          return () => {
            callback = undefined;
          };
        },
      },
      onError() {
        ended.resolve();
        throw new Error("observer failed");
      },
    },
  );
  scheduler.request();
  callback!();
  await ended.promise;
  await Promise.resolve();
  await Promise.resolve();
  expect(scheduler.statistics().rendered).toBe(0);
  scheduler.request();
  scheduler.cancel();
  expect(callback).toBeUndefined();
  expect(scheduler.statistics().cancelled).toBe(1);
});
