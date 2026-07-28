import { expect, test } from "bun:test";
import {
  bracketedPaste,
  createPlatformClipboardAdapter,
  createRendererComponentRuntime,
  defineRendererApplication,
  FrameScheduler,
  focusReporting,
  kittyKeyboard,
  LayoutProjection,
  osc52Write,
  parseOsc52Response,
  RendererApplicationDriver,
  RendererRegistry,
  resolveRendererColor,
  TerminalOutputSession,
  terminalCapabilityDiagnostics,
  terminalNotification,
  terminalTitle,
} from "./index.ts";

const interactiveCapabilities = Object.freeze({
  width: 20,
  height: 8,
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
});

function node(id: string, x: number, zIndex = 0, parentId?: string) {
  return {
    id,
    parentId,
    bounds: { x, y: 0, width: 5, height: 5 },
    clip: { x: 0, y: 0, width: 20, height: 20 },
    zIndex,
    focusable: true,
    pointerEvents: "auto" as const,
    semantics: { role: "button" as const, label: id },
  };
}

test("layout projection owns hierarchy, hit testing, semantics, and snapshots", () => {
  const layout = new LayoutProjection();
  layout.upsert(node("root", 0));
  layout.upsert(node("child", 1, 2, "root"));
  expect(layout.version).toBe(2);
  expect(layout.get("root")?.children).toEqual(["child"]);
  expect(layout.hitTest(2, 2).map((item) => item.id)).toEqual([
    "child",
    "root",
  ]);
  expect(layout.snapshot().nodes).toHaveLength(2);
  layout.remove("root");
  expect(layout.nodes()).toEqual([]);
});

test("layout reconciliation rejects incomplete, duplicate, and cyclic trees atomically", () => {
  const layout = new LayoutProjection();
  layout.reconcile([node("stable", 0)]);
  const before = layout.snapshot();
  expect(() =>
    layout.reconcile([{ ...node("orphan", 0), parentId: "missing" }]),
  ).toThrow("missing parent");
  expect(() =>
    layout.reconcile([node("duplicate", 0), node("duplicate", 1)]),
  ).toThrow("duplicated");
  expect(() =>
    layout.reconcile([
      { ...node("left", 0), parentId: "right" },
      { ...node("right", 1), parentId: "left" },
    ]),
  ).toThrow("parent cycle");
  expect(layout.snapshot()).toEqual(before);
});

test("renderer registry prevents accidental backend replacement", () => {
  const registry = new RendererRegistry();
  const backend = {
    id: "cell",
    capabilities: new Set(["cells" as const]),
    render: () => ({
      width: 1,
      height: 1,
      sequence: 1,
      timestamp: 0,
      payload: [],
    }),
    diff: () => ({
      bytes: new Uint8Array(),
      changedCells: 0,
      changedRows: [],
      dirtyRects: [],
    }),
  };
  const dispose = registry.register(backend, { default: true });
  expect(registry.resolve()).toBe(backend);
  expect(() => registry.register(backend)).toThrow("already registered");
  dispose();
  expect(() => registry.resolve()).toThrow("not registered");
});

test("frame scheduler coalesces demand and exposes deterministic statistics", async () => {
  const callbacks: (() => void)[] = [];
  let now = 0;
  let renders = 0;
  const scheduler = new FrameScheduler(
    async () => {
      renders += 1;
      now += 2;
    },
    {
      clock: {
        now: () => now,
        schedule(callback) {
          callbacks.push(callback);
          return () => {
            const index = callbacks.indexOf(callback);
            if (index >= 0) callbacks.splice(index, 1);
          };
        },
      },
    },
  );
  scheduler.request();
  scheduler.request();
  callbacks.shift()?.();
  await Bun.sleep(0);
  callbacks.shift()?.();
  await Bun.sleep(0);
  expect(renders).toBeGreaterThanOrEqual(1);
  expect(scheduler.statistics().requested).toBeGreaterThanOrEqual(2);
});

test("frame scheduler contains render failures and reports them through its owner", async () => {
  const errors: unknown[] = [];
  const scheduler = new FrameScheduler(
    () => {
      throw new Error("frame failed");
    },
    {
      targetFps: 1_000,
      onError: (error) => {
        errors.push(error);
      },
    },
  );
  scheduler.request();
  await Bun.sleep(10);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(Error);
  expect(scheduler.statistics().idle).toBeTrue();
});

test("frame scheduler honors target FPS when maximum FPS permits faster bursts", async () => {
  const scheduled: { callback: () => void; delay: number }[] = [];
  let now = 0;
  const scheduler = new FrameScheduler(
    () => {
      now += 1;
    },
    {
      targetFps: 20,
      maximumFps: 120,
      clock: {
        now: () => now,
        schedule(callback, delay) {
          scheduled.push({ callback, delay });
          return () => {};
        },
      },
    },
  );
  scheduler.request();
  const first = scheduled.shift();
  expect(first?.delay).toBe(0);
  first?.callback();
  await Bun.sleep(0);
  scheduler.request();
  expect(scheduled.at(-1)?.delay).toBeCloseTo(50, 0);
});

test("renderer component runtime shares state, input, resize, and projection", async () => {
  const runtime = createRendererComponentRuntime({
    initialState: { count: 0, width: 0 },
    component: ({ state }) => ({
      lines: [`${state.count}@${state.width}`],
      semantics: [
        { id: "counter", role: "status", valueText: String(state.count) },
      ],
    }),
    input: (state, input) =>
      input === "+" ? { ...state, count: state.count + 1 } : undefined,
    resize: (state, width) => ({ ...state, width }),
  });
  await runtime.input?.("+");
  await runtime.resize?.(80, 24);
  const scene = await runtime.project({
    capabilities: {
      width: 80,
      height: 24,
      colorDepth: 24,
      unicode: true,
      hyperlinks: true,
      interactive: true,
      tty: true,
      alternateScreen: true,
      mouse: true,
      images: false,
      reducedMotion: false,
      platform: "linux",
    },
    mode: "interactive",
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  });
  expect(scene.lines).toEqual(["1@80"]);
  expect(runtime.snapshot()).toEqual({ count: 1, width: 80 });
});

test("renderer colors resolve named, indexed, and RGB values and reject invalid input", () => {
  expect(resolveRendererColor("bright-red")).toEqual({
    kind: "indexed",
    value: 9,
  });
  expect(resolveRendererColor({ kind: "indexed", value: 255 })).toEqual({
    kind: "indexed",
    value: 255,
  });
  expect(
    resolveRendererColor({ kind: "rgb", red: 1, green: 2, blue: 3 }),
  ).toEqual({ kind: "rgb", red: 1, green: 2, blue: 3 });
  expect(() => resolveRendererColor("orange" as never)).toThrow(
    "Unsupported renderer color",
  );
  expect(() => resolveRendererColor({ kind: "indexed", value: 256 })).toThrow(
    "0 through 255",
  );
  expect(() =>
    resolveRendererColor({ kind: "rgb", red: 1.5, green: 0, blue: 0 }),
  ).toThrow("integer");
});

test("renderer application driver owns projection, input, resize, output, and cleanup", async () => {
  const writes: string[] = [];
  const events: string[] = [];
  let value = "initial";
  const application = defineRendererApplication({
    project: () => ({ lines: [value] }),
    input: (input) => {
      value = input;
      events.push(`input:${input}`);
    },
    resize: (width, height) => {
      events.push(`resize:${width}x${height}`);
    },
    dispose: () => {
      events.push("application:dispose");
    },
  });
  const backend = {
    id: "test",
    capabilities: new Set(["static" as const]),
    render: (scene: { readonly lines: readonly string[] }) => ({
      width: 20,
      height: 8,
      sequence: events.length,
      timestamp: 0,
      payload: scene,
    }),
    diff: (_previous: unknown, frame: { readonly payload: unknown }) => ({
      bytes: new TextEncoder().encode(
        (frame.payload as { readonly lines: readonly string[] }).lines[0] ?? "",
      ),
      changedCells: 1,
      changedRows: [0],
      dirtyRects: [{ x: 0, y: 0, width: 1, height: 1 }],
    }),
    dispose: () => {
      events.push("backend:dispose");
    },
  };
  const driver = new RendererApplicationDriver({
    application,
    backend,
    session: new TerminalOutputSession(
      {
        write(data) {
          writes.push(
            typeof data === "string" ? data : new TextDecoder().decode(data),
          );
          return true;
        },
      },
      "embedded",
    ),
    context: (signal) => ({
      capabilities: interactiveCapabilities,
      mode: "interactive",
      layout: new LayoutProjection(),
      signal,
    }),
  });
  await driver.draw(new AbortController().signal);
  await driver.input("updated");
  await driver.resize(40, 10);
  await driver.draw(new AbortController().signal);
  await driver.dispose();
  expect(writes.join("")).toBe("initialupdated");
  expect(events).toEqual([
    "input:updated",
    "resize:40x10",
    "backend:dispose",
    "application:dispose",
  ]);
  await expect(driver.input("closed")).rejects.toThrow("closed");
});

test("output sessions restore alternate screen and expose integration sequences", async () => {
  const writes: string[] = [];
  const session = new TerminalOutputSession(
    {
      write(data) {
        writes.push(
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        return true;
      },
    },
    "alternate",
  );
  await session.enter();
  await session.flush({
    bytes: new TextEncoder().encode("frame"),
    changedCells: 1,
    changedRows: [0],
    dirtyRects: [],
  });
  await session.commitScrollback("snapshot");
  await session.close();
  expect(writes.join("")).toContain("snapshot");
  expect(writes.filter((value) => value === "frame")).toHaveLength(2);
  expect(writes.join("")).toContain("\u001b[2J\u001b[H");
  expect(writes.at(-1)).toContain("?1049l");
  expect(osc52Write("copy")).toContain(btoa("copy"));
  expect(bracketedPaste(true)).toBe("\u001b[?2004h");
  expect(focusReporting(false)).toBe("\u001b[?1004l");
});

test("scrollback commits render terminal controls visibly instead of executing them", async () => {
  const writes: string[] = [];
  const session = new TerminalOutputSession(
    {
      write(data) {
        writes.push(
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        return true;
      },
    },
    "embedded",
    { embeddedOutput: "capture" },
  );
  await session.commitScrollback("safe\u001b]52;c;unsafe\u0007");
  await session.close();
  const captured = new TextDecoder().decode(session.capturedOutput());
  expect(captured).toContain("safe\\u001b]52;c;unsafe\\u0007");
  expect(captured).not.toContain("\u001b]52");
  expect(writes).toEqual([]);
});

test("inline output rejects absolute cursor rows outside its owned surface", async () => {
  const session = new TerminalOutputSession({ write: () => true }, "inline", {
    rows: 24,
    inlineRows: 2,
  });
  await expect(
    session.flush({
      bytes: new TextEncoder().encode("\u001b[3;1Hescape"),
      changedCells: 1,
      changedRows: [2],
      dirtyRects: [{ x: 0, y: 2, width: 1, height: 1 }],
    }),
  ).rejects.toThrow("escapes its 2-row surface");
  await session.close();
});

test("inline output translates CUP defaults relative to its saved origin", async () => {
  const writes: string[] = [];
  const session = new TerminalOutputSession(
    {
      write(data) {
        writes.push(
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        return true;
      },
    },
    "inline",
    { inlineRows: 2 },
  );
  await session.flush({
    bytes: new TextEncoder().encode("\u001b[Hhome\u001b[2Hsecond"),
    changedCells: 10,
    changedRows: [0, 1],
    dirtyRects: [],
  });
  await session.close();
  expect(writes.join("")).not.toContain("\u001b[H");
  expect(writes.join("")).not.toContain("\u001b[2H");
  expect(writes.join("")).toContain("\u001b8home\u001b8\u001b[1Bsecond");
});

class TerminalProtocolEmulator {
  alternate = false;
  origin = false;
  cursorVisible = true;
  scrollRegion: readonly [number, number] | undefined;
  fullDisplayClears = 0;
  savedCursor = false;
  readonly text: string[] = [];

  #applyMode(match: RegExpMatchArray): boolean {
    if (match[1]) {
      this.alternate = match[1] === "h";
      return true;
    }
    if (match[2]) {
      this.origin = match[2] === "h";
      return true;
    }
    if (match[3]) {
      this.cursorVisible = match[3] === "h";
      return true;
    }
    return false;
  }

  #applyRegion(match: RegExpMatchArray): boolean {
    if (match[4] || match[5]) {
      this.scrollRegion = [Number(match[4] || 1), Number(match[5] || 8)];
      return true;
    }
    if (match[0] === "\u001b[2J") {
      this.fullDisplayClears += 1;
      return true;
    }
    return false;
  }

  #applyContent(match: RegExpMatchArray): void {
    if (match[6]) this.savedCursor = match[6] === "7";
    else if (match[7]) this.text.push(match[7]);
  }

  write(data: string | Uint8Array): boolean {
    const value =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    const protocol = new RegExp(
      [
        "\\u001b\\[\\?1049([hl])",
        "\\u001b\\[\\?6([hl])",
        "\\u001b\\[\\?25([hl])",
        "\\u001b\\[(\\d*);?(\\d*)r",
        "\\u001b\\[2J",
        "\\u001b([78])",
        "([^\\u001b]+)",
      ].join("|"),
      "gu",
    );
    for (const match of value.matchAll(protocol)) {
      if (this.#applyMode(match) || this.#applyRegion(match)) continue;
      this.#applyContent(match);
    }
    if (value.includes("\u001b[r")) this.scrollRegion = undefined;
    return true;
  }
}

test("output ownership protocols preserve only their owned terminal surface", async () => {
  const frame = {
    bytes: new TextEncoder().encode("frame"),
    changedCells: 5,
    changedRows: [0],
    dirtyRects: [{ x: 0, y: 0, width: 5, height: 1 }],
  };
  for (const ownership of [
    "alternate",
    "main",
    "split-footer",
    "inline",
  ] as const) {
    const emulator = new TerminalProtocolEmulator();
    const session = new TerminalOutputSession(emulator, ownership, {
      rows: 8,
      splitFooterRows: 2,
      inlineRows: 2,
    });
    expect(session.viewportHeight).toBe(
      ownership === "split-footer" || ownership === "inline" ? 2 : 8,
    );
    await session.flush(frame);
    await session.commitScrollback(`${ownership}-log`);
    await session.close();
    expect(emulator.text.join("")).toContain(`${ownership}-log`);
    expect(emulator.alternate).toBeFalse();
    expect(emulator.origin).toBeFalse();
    expect(emulator.cursorVisible).toBeTrue();
    expect(emulator.scrollRegion).toBeUndefined();
    expect(emulator.fullDisplayClears).toBe(ownership === "alternate" ? 2 : 0);
  }

  const writes: string[] = [];
  const embedded = new TerminalOutputSession(
    {
      write(data) {
        writes.push(
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        return true;
      },
    },
    "embedded",
    { embeddedPassthrough: false },
  );
  await embedded.flush(frame);
  await embedded.commitScrollback("embedded-log");
  await embedded.close();
  expect(writes).toEqual([]);
  expect(new TextDecoder().decode(embedded.capturedOutput())).toBe(
    "frameembedded-log\n",
  );

  const passthroughWrites: string[] = [];
  const passthrough = new TerminalOutputSession(
    {
      write(data) {
        passthroughWrites.push(
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        return true;
      },
    },
    "embedded",
    { embeddedOutput: "passthrough" },
  );
  await passthrough.flush(frame);
  await passthrough.close();
  expect(passthroughWrites).toEqual(["frame"]);
  expect(passthrough.capturedOutput()).toHaveLength(0);

  const teeWrites: string[] = [];
  const tee = new TerminalOutputSession(
    {
      write(data) {
        teeWrites.push(
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        return true;
      },
    },
    "embedded",
    { embeddedOutput: "tee" },
  );
  await tee.flush(frame);
  await tee.close();
  expect(teeWrites).toEqual(["frame"]);
  expect(new TextDecoder().decode(tee.capturedOutput())).toBe("frame");

  const bounded = new TerminalOutputSession({ write: () => true }, "embedded", {
    embeddedOutput: "capture",
    embeddedCaptureLimitBytes: 5,
  });
  await bounded.flush({
    ...frame,
    bytes: new TextEncoder().encode("12345678"),
  });
  const capture = bounded.captureSnapshot();
  expect(new TextDecoder().decode(capture.bytes)).toBe("12345");
  expect(capture).toEqual(
    expect.objectContaining({
      limitBytes: 5,
      droppedBytes: 3,
      truncated: true,
    }),
  );
});

test("terminal integration covers OSC reads, notifications, kitty keys, platform clipboard, and diagnostics", async () => {
  const encoded = btoa("copied");
  expect(parseOsc52Response(`\u001b]52;c;${encoded}\u0007`)).toBe("copied");
  expect(parseOsc52Response("plain")).toBeUndefined();
  expect(terminalTitle("safe\u0007title")).not.toContain("safe\u0007title");
  expect(terminalNotification("Build", "done")).toContain("notify;Build;done");
  expect(kittyKeyboard(true)).toBe("\u001b[>1u");

  const commands: unknown[] = [];
  const clipboard = createPlatformClipboardAdapter(
    "darwin",
    async (command) => {
      commands.push(command);
      return "clipboard";
    },
  );
  expect(await clipboard.readClipboard()).toBe("clipboard");
  await clipboard.writeClipboard("next");
  expect(commands).toEqual([
    { command: "pbpaste", args: [] },
    { command: "pbcopy", args: [], input: "next" },
  ]);

  const diagnostics = terminalCapabilityDiagnostics({
    width: 80,
    height: 24,
    colorDepth: 24,
    unicode: true,
    hyperlinks: true,
    interactive: true,
    tty: true,
    alternateScreen: true,
    mouse: true,
    images: false,
    reducedMotion: false,
    platform: "darwin",
    bracketedPaste: true,
    clipboard: "osc52",
    focusReporting: true,
    kittyKeyboard: true,
    notifications: true,
  });
  expect(diagnostics.every((item) => item.supported)).toBeTrue();
});

test("renderer edge contracts cover validation, replacement, cancellation, and output ownership", async () => {
  const layout = new LayoutProjection();
  expect(() => layout.upsert(node("", 0))).toThrow("cannot be empty");
  expect(() =>
    layout.upsert({
      ...node("invalid", 0),
      bounds: { x: 0, y: 0, width: -1, height: 1 },
    }),
  ).toThrow("invalid bounds");
  layout.upsert(node("parent", 0));
  layout.upsert(node("child", 0, 0, "parent"));
  expect(layout.roots().map((item) => item.id)).toEqual(["parent"]);
  layout.upsert(node("child", 0));
  expect(layout.get("parent")?.children).toEqual([]);

  const registry = new RendererRegistry();
  const backend = {
    id: "one",
    capabilities: new Set(["cells" as const]),
    render: () => ({
      width: 1,
      height: 1,
      sequence: 1,
      timestamp: 0,
      payload: [],
    }),
    diff: () => ({
      bytes: new Uint8Array(),
      changedCells: 0,
      changedRows: [],
      dirtyRects: [],
    }),
  };
  registry.register(backend);
  registry.register({ ...backend, id: "two" });
  expect(registry.list()).toHaveLength(2);
  registry.register({ ...backend }, { replace: true });
  expect(registry.resolve("one").id).toBe("one");

  const callbacks: (() => void)[] = [];
  const scheduler = new FrameScheduler(() => undefined, {
    clock: {
      now: () => 0,
      schedule(callback) {
        callbacks.push(callback);
        return () => callbacks.splice(callbacks.indexOf(callback), 1);
      },
    },
  });
  scheduler.request();
  scheduler.cancel();
  expect(scheduler.statistics().cancelled).toBe(1);
  let systemRenders = 0;
  const systemScheduler = new FrameScheduler(() => {
    systemRenders += 1;
  });
  systemScheduler.request();
  await Bun.sleep(20);
  expect(systemRenders).toBe(1);

  const writes: string[] = [];
  const main = new TerminalOutputSession(
    {
      write(value) {
        writes.push(
          typeof value === "string" ? value : new TextDecoder().decode(value),
        );
        return true;
      },
      flush: () => undefined,
    },
    "main",
  );
  await main.flush({
    bytes: new TextEncoder().encode("frame"),
    changedCells: 1,
    changedRows: [0],
    dirtyRects: [],
  });
  await main.commitScrollback("line\n");
  await main.close();
  await main.close();
  await expect(main.enter()).rejects.toThrow("closed");
  expect(writes.join("")).toContain("frame");

  const blocked = new TerminalOutputSession({ write: () => false }, "inline");
  await expect(
    blocked.enter().then(() => blocked.commitScrollback("x")),
  ).rejects.toThrow("backpressure");
  expect(parseOsc52Response("\u001b]52;c;%%%\u0007")).toBeUndefined();
  expect(parseOsc52Response("\u001b]52;c;YQ==\u001b\\")).toBe("a");
  for (const platform of ["win32", "linux"] as const) {
    const executed: unknown[] = [];
    const adapter = createPlatformClipboardAdapter(
      platform,
      async (command) => {
        executed.push(command);
        return "value";
      },
    );
    expect(await adapter.readClipboard()).toBe("value");
    await adapter.writeClipboard("copy");
    expect(executed).toHaveLength(2);
  }
  expect(
    terminalCapabilityDiagnostics({
      width: 80,
      height: 24,
      colorDepth: 1,
      unicode: false,
      hyperlinks: false,
      interactive: false,
      tty: false,
      alternateScreen: false,
      mouse: false,
      images: false,
      reducedMotion: true,
      platform: "linux",
    }).every((item) => !item.supported),
  ).toBeTrue();
});

test("renderer colors form a closed runtime union", () => {
  expect(() =>
    resolveRendererColor({ kind: "hsl", value: 1 } as never),
  ).toThrow('Unsupported renderer color kind "hsl"');
  expect(() =>
    resolveRendererColor({ kind: "rgb", red: 0, green: 1.5, blue: 2 }),
  ).toThrow("integer");
});
