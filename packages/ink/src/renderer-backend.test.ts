import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createApp } from "@mwillbanks/tuil";
import { CellRendererBackend } from "@mwillbanks/tuil-cell";
import {
  defineRendererApplication,
  LayoutProjection,
  RendererApplicationDriver,
  runRendererConformance,
  TerminalOutputSession,
} from "@mwillbanks/tuil-renderer";
import { Text as InkText } from "ink";
import { createElement, useState } from "react";
import { Button, Text } from "./components.tsx";
import { render, useTerminalInput } from "./index.ts";
import { InkRendererBackend } from "./renderer-backend.ts";
import { VirtualTerminalScreen } from "./vt-screen.ts";

test("Ink backend passes renderer-neutral frame, static, semantics, resize, and cleanup contracts", async () => {
  const controller = new AbortController();
  const result = await runRendererConformance(
    new InkRendererBackend(),
    [
      {
        id: "layout-focus-semantics",
        tree: {
          lines: ["Save"],
          semantics: [{ role: "button", label: "Save" }],
        },
        assertFrame(frame) {
          expect((frame.payload as { frame: string }).frame).toBe("Save");
        },
      },
      {
        id: "static-resize-overlay-form-editor-stream-cleanup",
        tree: { lines: ["Dialog", "Text field", "stream"] },
        assertFrame(frame) {
          expect((frame.payload as { frame: string }).frame).toContain(
            "Text field",
          );
        },
      },
    ],
    {
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
      signal: controller.signal,
    },
  );
  expect(result.backendId).toBe("ink");
  expect(result.fixtures).toHaveLength(2);
});

test("Ink backend handles string frames, unchanged diffs, and cancellation", () => {
  const backend = new InkRendererBackend();
  const context = {
    capabilities: {
      width: 4,
      height: 2,
      colorDepth: 4 as const,
      unicode: true,
      hyperlinks: false,
      interactive: false,
      tty: false,
      alternateScreen: false,
      mouse: false,
      images: false,
      reducedMotion: false,
      platform: "linux" as const,
    },
    mode: "static" as const,
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  const first = backend.render({ lines: ["text"] }, context);
  expect((first.payload as { frame: string }).frame).toBe("text");
  expect(
    backend.diff(undefined, backend.render({ lines: ["a", "b"] }, context)),
  ).toEqual(
    expect.objectContaining({
      changedCells: 2,
      changedRows: [0, 1],
    }),
  );
  expect(backend.diff(first, first).changedCells).toBe(0);
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  expect(() =>
    backend.render({ lines: ["x"] }, { ...context, signal: controller.signal }),
  ).toThrow("cancelled");
});

test("Ink backend repaints complete main-screen frames on a terminal", async () => {
  const screen = new VirtualTerminalScreen(40, 4);
  const output = new TerminalOutputSession(
    {
      write(data) {
        screen.write(
          typeof data === "string" ? data : new TextDecoder().decode(data),
        );
        return true;
      },
    },
    "main",
    { rows: 4 },
  );
  let lines = ["first", "stale"];
  const driver = new RendererApplicationDriver({
    application: defineRendererApplication({
      project: () => ({ lines }),
    }),
    backend: new InkRendererBackend(),
    session: output,
    context: (signal) => ({
      capabilities: {
        width: 40,
        height: 4,
        colorDepth: 24,
        unicode: true,
        hyperlinks: false,
        interactive: true,
        tty: true,
        alternateScreen: false,
        mouse: false,
        images: false,
        reducedMotion: false,
        platform: "linux",
      },
      mode: "interactive",
      layout: new LayoutProjection(),
      signal,
    }),
  });

  await driver.draw(new AbortController().signal);
  expect(screen.snapshot()).toBe("first\nstale");
  lines = ["updated"];
  await driver.draw(new AbortController().signal);
  expect(screen.snapshot()).toBe("updated");
  await driver.dispose();
});

test("Ink backend escapes malicious renderer-neutral scene text", () => {
  const backend = new InkRendererBackend();
  const context = {
    capabilities: {
      width: 40,
      height: 2,
      colorDepth: 4 as const,
      unicode: true,
      hyperlinks: false,
      interactive: false,
      tty: false,
      alternateScreen: false,
      mouse: false,
      images: false,
      reducedMotion: false,
      platform: "linux" as const,
    },
    mode: "static" as const,
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  const frame = backend.render(
    { lines: ["before\u001b]52;c;c2VjcmV0\u0007after"] },
    context,
  );
  const output = (frame.payload as { frame: string }).frame;
  expect(output).not.toContain("\u001b]52");
  expect(output).toContain("\\u001b]52");
});

test("Ink backend validates the shared renderer color contract", () => {
  const backend = new InkRendererBackend();
  const context = {
    capabilities: {
      width: 20,
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
    },
    mode: "interactive" as const,
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  expect(() =>
    backend.render(
      {
        lines: ["nir"],
        styledLines: [
          [
            { text: "n", style: { foreground: "bright-blue" } },
            {
              text: "i",
              style: { foreground: { kind: "indexed", value: 42 } },
            },
            {
              text: "r",
              style: {
                foreground: { kind: "rgb", red: 1, green: 2, blue: 3 },
              },
            },
          ],
        ],
      },
      context,
    ),
  ).not.toThrow();
  expect(() =>
    backend.render(
      {
        lines: ["invalid"],
        styledLines: [
          [{ text: "invalid", style: { foreground: "orange" as never } }],
        ],
      },
      context,
    ),
  ).toThrow("Unsupported renderer color");
});

test("Ink backend preserves shared styles, links, cursor, clipping, and frame-owned modes", () => {
  const backend = new InkRendererBackend();
  const base = {
    capabilities: {
      width: 4,
      height: 1,
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
    },
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  const interactive = backend.render(
    {
      lines: ["styled overflow"],
      styledLines: [
        [
          {
            text: "styled overflow",
            style: { foreground: "bright-blue", bold: true },
            link: "https://example.test",
          },
        ],
      ],
      cursor: { x: 3, y: 0, visible: true, shape: "line" },
    },
    { ...base, mode: "interactive" },
  );
  const json = backend.render(
    { lines: ["json"], semantics: [{ role: "status", label: "JSON" }] },
    { ...base, mode: "json" },
  );
  const interactiveOutput = new TextDecoder().decode(
    backend.diff(undefined, interactive).bytes,
  );
  expect((interactive.payload as { frame: string }).frame).toBe("styl");
  expect(interactiveOutput).toContain("\u001b[0;38;5;12;1m");
  expect(interactiveOutput).toContain("\u001b]8;;https://example.test\u0007");
  expect(interactiveOutput).toContain("\u001b[1;4H\u001b[6 q\u001b[?25h");
  expect(
    JSON.parse(new TextDecoder().decode(backend.diff(undefined, json).bytes)),
  ).toEqual(
    expect.objectContaining({
      frame: "json",
      semantics: [{ role: "status", label: "JSON" }],
    }),
  );
});

test("Ink backend rejects inconsistent styled scenes and unsafe links", () => {
  const backend = new InkRendererBackend();
  const context = {
    capabilities: {
      width: 20,
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
    },
    mode: "interactive" as const,
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  expect(() =>
    backend.render(
      { lines: ["plain"], styledLines: [[{ text: "different" }]] },
      context,
    ),
  ).toThrow("must match");
  expect(() =>
    backend.render(
      {
        lines: ["link"],
        styledLines: [
          [{ text: "link", link: "https://example.test/\u001b]52;c;x" }],
        ],
      },
      context,
    ),
  ).toThrow("terminal controls");
  expect(() =>
    backend.render(
      {
        lines: ["link"],
        styledLines: [[{ text: "link", link: "javascript:alert(1)" }]],
      },
      {
        ...context,
        capabilities: { ...context.capabilities, hyperlinks: false },
      },
    ),
  ).toThrow('scheme "javascript:" is unsafe');
});

test("Ink backend suppresses safe hyperlinks when the terminal lacks support", () => {
  const backend = new InkRendererBackend();
  const frame = backend.render(
    {
      lines: ["link"],
      styledLines: [[{ text: "link", link: "https://example.test/path" }]],
    },
    {
      capabilities: {
        width: 20,
        height: 2,
        colorDepth: 4,
        unicode: true,
        hyperlinks: false,
        interactive: true,
        tty: true,
        alternateScreen: true,
        mouse: false,
        images: false,
        reducedMotion: false,
        platform: "linux",
      },
      mode: "interactive",
      layout: new LayoutProjection(),
      signal: new AbortController().signal,
    },
  );
  expect(
    new TextDecoder().decode(backend.diff(undefined, frame).bytes),
  ).not.toContain("\u001b]8;;");
});

class TestTerminal extends EventEmitter {
  readonly writes: string[] = [];
  columns = 40;
  rows = 8;
  isTTY = true;
  #input: string | null = null;

  write(value: string | Uint8Array): boolean {
    this.writes.push(
      typeof value === "string" ? value : new TextDecoder().decode(value),
    );
    return true;
  }

  setRawMode(): void {}
  setEncoding(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null {
    const input = this.#input;
    this.#input = null;
    return input;
  }

  send(input: string): void {
    this.#input = input;
    this.emit("readable");
    this.emit("data", input);
  }
}

test("cell backend runs native state, input, resize, styles, semantics, and layout without Ink", async () => {
  const output = new TestTerminal();
  const input = new TestTerminal();
  let count = 0;
  let size = { width: output.columns, height: output.rows };
  let disposed = false;
  const app = createApp({
    component: defineRendererApplication({
      project: ({ layout }) => {
        layout.upsert({
          id: "counter",
          bounds: { x: 0, y: 0, width: 8, height: 1 },
          clip: { x: 0, y: 0, width: size.width, height: size.height },
          zIndex: 0,
          focusable: true,
          pointerEvents: "auto",
          semantics: {
            id: "counter",
            role: "button",
            label: `Count ${count}`,
          },
        });
        return {
          lines: [`Count ${count}`, `${size.width}x${size.height}`],
          styledLines: [
            [
              {
                text: `Count ${count}`,
                style: {
                  foreground: { kind: "rgb", red: 205, green: 0, blue: 0 },
                  bold: true,
                },
              },
            ],
            [{ text: `${size.width}x${size.height}` }],
          ],
          semantics: [
            { id: "counter", role: "button", label: `Count ${count}` },
          ],
        };
      },
      input: (value) => {
        if (value === "\r") count += 1;
      },
      resize: (width, height) => {
        size = { width, height };
      },
      dispose: () => {
        disposed = true;
      },
    }),
    renderer: "cell",
    renderers: [new CellRendererBackend()],
    terminal: {
      mode: "interactive",
      capabilities: {
        colorDepth: 24,
        mouse: true,
        width: output.columns,
        height: output.rows,
      },
    },
  });
  const instance = await render(app, {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  expect(instance.ink).toBeUndefined();
  expect(output.writes.join("")).toContain("Count 0");
  expect(output.writes.join("")).toContain("\u001b[0;38;2;205;0;0;49;1m");
  input.send("\r");
  await Bun.sleep(25);
  expect(output.writes.at(-1)).toContain("1");
  output.columns = 60;
  output.rows = 12;
  output.emit("resize");
  await Bun.sleep(25);
  expect(output.writes.at(-1)).toContain("60x12");
  expect(app.layout.get("counter")?.bounds.width).toBeGreaterThan(0);
  expect(app.layout.get("counter")?.semantics.role).toBe("button");
  const rendered = app.renderTelemetry.snapshot().frame as
    | { payload: { semantics?: readonly { id?: string }[] } }
    | undefined;
  expect(rendered?.payload.semantics?.[0]?.id).toBe("counter");
  await instance.unmount();
  expect(disposed).toBe(true);
});

test("cell backend rejects Ink component trees instead of transcoding ANSI", async () => {
  const output = new TestTerminal();
  const input = new TestTerminal();
  let presses = 0;
  function Counter() {
    const [count, setCount] = useState(0);
    return createElement(
      Button,
      {
        autoFocus: true,
        id: "counter",
        onPress: () => {
          presses += 1;
          setCount((value) => value + 1);
        },
      },
      `Count ${count}`,
    );
  }
  const app = createApp({
    component: Counter,
    renderer: "cell",
    renderers: [new CellRendererBackend()],
    terminal: {
      mode: "interactive",
      capabilities: { colorDepth: 24, width: 20, height: 2 },
    },
  });
  await expect(
    render(app, {
      stdin: input as unknown as NodeJS.ReadStream,
      stdout: output as unknown as NodeJS.WriteStream,
    }),
  ).rejects.toThrow("requires a RendererApplication");
  expect(presses).toBe(0);
  expect(output.writes.join("")).not.toContain("Count 0");
});

test("backend input preserves empty Ink input when keyboard flags identify an arrow", async () => {
  const output = new TestTerminal();
  const input = new TestTerminal();
  function ArrowStatus() {
    const [direction, setDirection] = useState("waiting");
    useTerminalInput((_value, key) => {
      if (!key.rightArrow) return false;
      setDirection("right");
      return true;
    });
    return createElement(Text, null, direction);
  }
  const app = createApp({
    component: ArrowStatus,
    renderer: "ink",
    renderers: [new InkRendererBackend()],
    terminal: {
      mode: "interactive",
      capabilities: { colorDepth: 24, width: 20, height: 2 },
    },
  });
  const instance = await render(app, {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  input.send("\u001b[C");
  await Bun.sleep(25);
  expect(output.writes.join("")).toContain("right");
  await instance.unmount();
});

test("JSON renderer emits semantic-only changes", () => {
  const backend = new InkRendererBackend();
  const context = {
    capabilities: {
      width: 20,
      height: 2,
      colorDepth: 24 as const,
      unicode: true,
      hyperlinks: false,
      interactive: false,
      tty: false,
      alternateScreen: false,
      mouse: false,
      images: false,
      reducedMotion: false,
      platform: "linux" as const,
    },
    mode: "json" as const,
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  const first = backend.render(
    {
      lines: ["same"],
      semantics: [{ role: "status", valueText: "a" }],
    },
    context,
  );
  const second = backend.render(
    {
      lines: ["same"],
      semantics: [{ role: "status", valueText: "b" }],
    },
    context,
  );
  expect(backend.diff(first, second).bytes.length).toBeGreaterThan(0);
});

test("default Ink rendering records runtime render telemetry", async () => {
  const output = new TestTerminal();
  const input = new TestTerminal();
  function Observed() {
    return createElement(Text, null, "Observed");
  }
  const app = createApp({
    component: Observed,
    terminal: {
      mode: "interactive",
      capabilities: { width: 20, height: 2, interactive: true, tty: true },
    },
  });
  const instance = await render(app, {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  await Bun.sleep(10);
  const initial = app.renderTelemetry.snapshot();
  expect(initial).toEqual(
    expect.objectContaining({
      durationMs: expect.any(Number),
      renderer: "ink",
      sequence: 1,
    }),
  );
  expect(initial.frame).toEqual(
    expect.objectContaining({
      payload: expect.objectContaining({
        frame: expect.stringContaining("Observed"),
        semantics: expect.arrayContaining([
          expect.objectContaining({ role: "text", text: "Observed" }),
        ]),
      }),
    }),
  );
  expect(initial.output).toEqual(
    expect.objectContaining({
      bytes: expect.any(Uint8Array),
      changedCells: 8,
      changedRows: [0],
      dirtyRects: [{ x: 0, y: 0, width: 8, height: 1 }],
    }),
  );
  instance.ink?.rerender(createElement(InkText, null, "Updated"));
  await instance.ink?.waitUntilRenderFlush();
  await Bun.sleep(10);
  const updated = app.renderTelemetry.snapshot();
  expect(updated.sequence).toBeGreaterThan(initial.sequence);
  expect(
    (updated.frame as { payload: { frame: string } }).payload.frame,
  ).toContain("Updated");
  expect(
    (updated.output as { bytes: Uint8Array }).bytes.length,
  ).toBeGreaterThan(0);
  expect(
    (updated.output as { changedCells: number }).changedCells,
  ).toBeGreaterThan(0);
  await instance.unmount();
});

test("default Ink telemetry reconstructs the full screen for later-line-only updates", async () => {
  const output = new TestTerminal();
  const input = new TestTerminal();
  function Lines() {
    return createElement(Text, null, "first\nsecond");
  }
  const app = createApp({
    component: Lines,
    terminal: {
      mode: "interactive",
      capabilities: { width: 20, height: 4, interactive: true, tty: true },
    },
  });
  const instance = await render(app, {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
  });
  await Bun.sleep(10);
  instance.ink?.rerender(createElement(InkText, null, "first\nupdated"));
  await instance.ink?.waitUntilRenderFlush();
  await Bun.sleep(10);
  const telemetry = app.renderTelemetry.snapshot();
  expect(
    (telemetry.frame as { payload: { frame: string } }).payload.frame,
  ).toBe("first\nupdated");
  expect(telemetry.output).toEqual(
    expect.objectContaining({
      changedRows: [1],
      changedCells: 7,
      dirtyRects: [{ x: 0, y: 1, width: 7, height: 1 }],
    }),
  );
  await instance.unmount();
});
