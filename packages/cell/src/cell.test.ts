import { expect, test } from "bun:test";
import {
  LayoutProjection,
  runRendererConformance,
  TerminalOutputSession,
} from "@mwillbanks/tuil-renderer";
import {
  CellBuffer,
  type CellFrame,
  CellRendererBackend,
  composeCellScene,
  diffCellFrames,
  emptyCell,
  encodeCellOutput,
  loadNativeCellAccelerator,
  loadOptionalCellAccelerator,
  typescriptCellAccelerator,
} from "./index.ts";

const interactiveCapabilities = Object.freeze({
  width: 24,
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
});

test("cell buffers preserve grapheme clusters and wide-cell continuation", () => {
  const buffer = new CellBuffer(8, 2);
  expect(buffer.write(0, 0, "A界e\u0301")).toBe(4);
  const frame = buffer.frame();
  expect(frame.cells[1]?.grapheme).toBe("界");
  expect(frame.cells[2]?.continuation).toBe(true);
  expect(frame.cells[3]?.grapheme).toBe("e\u0301");
});

test("cell composition, clipping, borders, and fills stay bounded", () => {
  const target = new CellBuffer(6, 4);
  target.fill(
    { x: 1, y: 1, width: 2, height: 2 },
    { ...emptyCell, grapheme: "." },
  );
  target.border({ x: 0, y: 0, width: 6, height: 4 });
  target.write(0, 1, "overflow", {}, { x: 1, y: 1, width: 3, height: 1 });
  expect(target.get(0, 1)?.grapheme).toBe("│");
  expect(target.get(1, 1)?.grapheme).toBe("v");
  expect(target.frame().cells).toHaveLength(24);
  target.erase({ x: 1, y: 1, width: 1, height: 1 });
  expect(target.get(1, 1)?.grapheme).toBe(" ");
  target.clear({ ...emptyCell, grapheme: "-" });
  expect(target.get(5, 3)?.grapheme).toBe("-");
  const source = new CellBuffer(2, 1);
  source.write(0, 0, "ok");
  target.composite(source.frame(), 2, 2);
  expect(target.get(2, 2)?.grapheme).toBe("o");
});

test("cell scene composes flex, absolute overlays, portals, and measured layout", () => {
  const layout = new LayoutProjection();
  const frame = composeCellScene(
    {
      id: "root",
      kind: "box",
      direction: "row",
      children: [
        {
          id: "sidebar",
          kind: "box",
          width: 4,
          border: true,
          children: [{ id: "nav", kind: "text", text: "N" }],
        },
        {
          id: "content",
          kind: "text",
          text: "body",
          pointerEvents: "auto",
          semantics: { role: "status", label: "Content", valueText: "body" },
        },
        {
          id: "overlay",
          kind: "text",
          text: "!",
          position: "portal",
          x: 9,
          y: 0,
          width: 1,
          height: 1,
          zIndex: 10,
        },
      ],
    },
    10,
    3,
    layout,
  );
  expect(frame.cells[9]?.grapheme).toBe("!");
  expect(layout.get("sidebar")?.bounds.width).toBe(4);
  expect(layout.get("content")?.bounds).toMatchObject({ x: 4, width: 6 });
  expect(layout.hitTest(5, 0)[0]?.id).toBe("content");
  expect(layout.get("overlay")?.parentId).toBe("root");
  expect(layout.get("content")?.semantics).toEqual({
    id: "content",
    role: "status",
    label: "Content",
    valueText: "body",
  });
  expect(frame.semantics).toContainEqual(layout.get("content")?.semantics);
});

test("cell scene covers column flow, margins, clipping, fills, and absolute layers", () => {
  const frame = composeCellScene(
    {
      id: "root",
      kind: "box",
      direction: "column",
      style: { background: { kind: "indexed", value: 1 } },
      children: [
        {
          id: "first",
          kind: "text",
          text: "one\ntwo",
          height: 2,
          margin: 1,
        },
        {
          id: "second",
          kind: "box",
          padding: 1,
          clip: false,
        },
        {
          id: "absolute",
          kind: "text",
          text: "A",
          position: "absolute",
          x: 5,
          y: 2,
          width: 1,
          height: 1,
          zIndex: 2,
        },
      ],
    },
    8,
    5,
  );
  expect(frame.cells[0]?.background).toEqual({ kind: "indexed", value: 1 });
  expect(frame.cells[2 * 8 + 5]?.grapheme).toBe("A");
});

test("cell diffs cover resize invalidation, cursor hiding, and identical frames", () => {
  const small = new CellBuffer(2, 1).frame();
  const large = new CellBuffer(3, 2).frame();
  expect(diffCellFrames(small, large).changedCells).toBe(6);
  expect(diffCellFrames(large, large).changedCells).toBe(0);
  const hidden = new CellBuffer(2, 1);
  hidden.setCursor({ x: 0, y: 0, visible: false });
  expect(
    new TextDecoder().decode(diffCellFrames(undefined, hidden.frame()).bytes),
  ).toContain("?25l");
  expect(() => hidden.setCursor({ x: 2, y: 0, visible: true })).toThrow(
    "outside 2x1",
  );
  expect(() =>
    diffCellFrames(undefined, {
      ...hidden.frame(),
      cursor: { x: Number.NaN, y: 0, visible: true },
    }),
  ).toThrow("outside 2x1");
});

test("renderer scenes preserve named, indexed, and RGB cell colors", async () => {
  const backend = new CellRendererBackend();
  const frame = await backend.render(
    {
      lines: ["named indexed rgb"],
      styledLines: [
        [
          { text: "named ", style: { foreground: "bright-red" } },
          {
            text: "indexed ",
            style: { foreground: { kind: "indexed", value: 123 } },
          },
          {
            text: "rgb",
            style: {
              foreground: { kind: "rgb", red: 1, green: 2, blue: 3 },
            },
          },
        ],
      ],
    },
    {
      capabilities: {
        width: 24,
        height: 2,
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
    },
  );
  const cells = (frame.payload as { cells: readonly { foreground: unknown }[] })
    .cells;
  expect(cells[0]?.foreground).toEqual({ kind: "indexed", value: 9 });
  expect(cells[6]?.foreground).toEqual({ kind: "indexed", value: 123 });
  expect(cells[14]?.foreground).toEqual({
    kind: "rgb",
    red: 1,
    green: 2,
    blue: 3,
  });
});

test("cell renderer rejects unsupported and out-of-range renderer colors", async () => {
  const backend = new CellRendererBackend();
  const context = {
    capabilities: {
      ...interactiveCapabilities,
      width: 8,
      height: 1,
    },
    mode: "interactive" as const,
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  await expect(
    backend.render(
      {
        lines: ["invalid"],
        styledLines: [
          [{ text: "invalid", style: { foreground: "orange" as never } }],
        ],
      },
      context,
    ),
  ).rejects.toThrow("Unsupported renderer color");
  await expect(
    backend.render(
      {
        lines: ["invalid"],
        styledLines: [
          [
            {
              text: "invalid",
              style: { foreground: { kind: "indexed", value: -1 } },
            },
          ],
        ],
      },
      context,
    ),
  ).rejects.toThrow("0 through 255");
});

test("cell public contracts reject malformed direct colors, links, and frames", async () => {
  const buffer = new CellBuffer(2, 1);
  expect(() =>
    buffer.write(0, 0, "x", {
      foreground: { kind: "indexed", value: 999 },
    }),
  ).toThrow("0 through 255");
  expect(() =>
    buffer.write(0, 0, "x", {
      link: "https://example.test/\u001b]52;c;unsafe",
    }),
  ).toThrow("terminal controls");
  expect(() =>
    buffer.write(0, 0, "x", {
      link: "data:text/plain,unsafe",
    }),
  ).toThrow('scheme "data:" is unsafe');

  const backend = new CellRendererBackend({
    accelerator: typescriptCellAccelerator,
  });
  const directCell = { ...emptyCell, grapheme: "x" };
  const directFrame = await backend.render(
    { width: 1, height: 1, cells: [directCell] },
    {
      capabilities: { ...interactiveCapabilities, width: 1, height: 1 },
      mode: "interactive",
      layout: new LayoutProjection(),
      signal: new AbortController().signal,
    },
  );
  directCell.grapheme = "mutated";
  expect((directFrame.payload as CellFrame).cells[0]?.grapheme).toBe("x");
  expect(Object.isFrozen((directFrame.payload as CellFrame).cells[0])).toBe(
    true,
  );
  await expect(
    backend.render(
      {
        width: 2,
        height: 1,
        cells: [emptyCell],
      },
      {
        capabilities: { ...interactiveCapabilities, width: 2, height: 1 },
        mode: "interactive",
        layout: new LayoutProjection(),
        signal: new AbortController().signal,
      },
    ),
  ).rejects.toThrow("complete rectangular");
});

test("cell backend suppresses safe hyperlinks when capability support is absent", async () => {
  const backend = new CellRendererBackend({
    accelerator: typescriptCellAccelerator,
  });
  const frame = await backend.render(
    {
      lines: ["link"],
      styledLines: [[{ text: "link", link: "https://example.test/path" }]],
    },
    {
      capabilities: {
        ...interactiveCapabilities,
        hyperlinks: false,
        width: 8,
        height: 1,
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

test("cell diff uses frame-owned mode instead of mutable backend state", async () => {
  const backend = new CellRendererBackend({
    accelerator: typescriptCellAccelerator,
  });
  const base = {
    capabilities: { ...interactiveCapabilities, width: 4, height: 1 },
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  const json = await backend.render(
    { lines: ["json"], semantics: [{ role: "status", label: "JSON" }] },
    { ...base, mode: "json" },
  );
  await backend.render({ lines: ["ansi"] }, { ...base, mode: "interactive" });
  const output = new TextDecoder().decode(backend.diff(undefined, json).bytes);
  expect(JSON.parse(output)).toEqual(
    expect.objectContaining({
      width: 4,
      semantics: [{ role: "status", label: "JSON" }],
    }),
  );
});

test("frame diff tracks dirty cells, rows, regions, links, and cursor", () => {
  const previous = new CellBuffer(4, 2).frame();
  const current = new CellBuffer(4, 2);
  current.write(1, 0, "x", { link: "https://example.test" });
  current.setCursor({ x: 2, y: 1, visible: true, shape: "line" });
  const output = diffCellFrames(previous, current.frame());
  const ansi = new TextDecoder().decode(output.bytes);
  expect(output.changedCells).toBe(1);
  expect(output.changedRows).toEqual([0]);
  expect(output.dirtyRects).toEqual([{ x: 1, y: 0, width: 1, height: 1 }]);
  expect(ansi).toContain("https://example.test");
  expect(ansi).toContain("?25h");
  expect(ansi).toContain("[5 q");
  expect(
    new TextDecoder().decode(encodeCellOutput(current.frame(), "json").bytes),
  ).toContain('"width":4');
  expect(encodeCellOutput(current.frame(), "silent").bytes).toHaveLength(0);
});

class InlineCursorEmulator {
  x = 10;
  y = 12;
  savedX = this.x;
  savedY = this.y;
  absoluteCursorMoves = 0;
  readonly printedRows: number[] = [];

  write(data: string | Uint8Array): boolean {
    const value =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    const tokens =
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI output is the emulator input grammar.
      /\u001b7|\u001b8|\u001b\[(\d+)([ABCD])|\u001b\[\d+;\d+[Hf]|\u001b\[[0-9;? ]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|[^\u001b]+/gu;
    for (const match of value.matchAll(tokens)) this.#apply(match);
    return true;
  }

  #apply(match: RegExpMatchArray): void {
    const token = match[0];
    if (this.#applySavedCursor(token)) return;
    if (this.#applyRelativeMove(match)) return;
    if (token.startsWith("\u001b")) {
      if (/^\[\d+;\d+[Hf]$/u.test(token.slice(1)))
        this.absoluteCursorMoves += 1;
      return;
    }
    this.#print(token);
  }

  #applySavedCursor(token: string): boolean {
    if (token === "\u001b7") {
      [this.savedX, this.savedY] = [this.x, this.y];
      return true;
    }
    if (token === "\u001b8") {
      [this.x, this.y] = [this.savedX, this.savedY];
      return true;
    }
    return false;
  }

  #applyRelativeMove(match: RegExpMatchArray): boolean {
    if (!match[1] || !match[2]) return false;
    const amount = Number(match[1]);
    if (match[2] === "A") this.y -= amount;
    else if (match[2] === "B") this.y += amount;
    else if (match[2] === "C") this.x += amount;
    else this.x -= amount;
    return true;
  }

  #print(token: string): void {
    for (const character of token) {
      if (character === "\r") this.x = this.savedX;
      else if (character === "\n") {
        this.x = this.savedX;
        this.y += 1;
      } else {
        this.printedRows.push(this.y);
        this.x += 1;
      }
    }
  }
}

test("inline sessions translate cell CUP output into owned-origin-relative moves", async () => {
  const buffer = new CellBuffer(4, 2);
  buffer.write(3, 1, "x");
  const output = diffCellFrames(undefined, buffer.frame());
  const emulator = new InlineCursorEmulator();
  const session = new TerminalOutputSession(emulator, "inline", {
    rows: 24,
    inlineRows: 2,
  });
  await session.flush(output);
  expect(emulator.absoluteCursorMoves).toBe(0);
  expect(new Set(emulator.printedRows)).toEqual(new Set([12, 13]));
  expect(Math.max(...emulator.printedRows)).toBe(13);
  await session.close();
  expect([emulator.x, emulator.y]).toEqual([10, 12]);
});

test("cell static, JSON, and silent output modes preserve their contracts", () => {
  const buffer = new CellBuffer(8, 1);
  buffer.write(0, 0, "ready");
  const frame = Object.freeze({
    ...buffer.frame(),
    semantics: Object.freeze([{ role: "status" as const, label: "Ready" }]),
  });
  const staticOutput = new TextDecoder().decode(
    encodeCellOutput(frame, "static").bytes,
  );
  expect(staticOutput).toStartWith("ready");
  expect(staticOutput).not.toContain("\u001b[");
  const json = JSON.parse(
    new TextDecoder().decode(encodeCellOutput(frame, "json").bytes),
  ) as { readonly semantics?: readonly unknown[] };
  expect(json.semantics).toEqual([{ role: "status", label: "Ready" }]);
  const silent = encodeCellOutput(frame, "silent");
  expect(silent.bytes).toHaveLength(0);
  expect(silent.changedCells).toBe(0);
});

test("cell output visibly escapes untrusted terminal control sequences", async () => {
  const buffer = new CellBuffer(40, 1);
  buffer.write(0, 0, "before\u001b]52;c;c2VjcmV0\u0007after");
  const ansi = new TextDecoder().decode(
    encodeCellOutput(buffer.frame(), "ansi").bytes,
  );
  expect(ansi).not.toContain("\u001b]52");
  expect(ansi).toContain("\\u001b]52");

  const backend = new CellRendererBackend();
  const frame = await backend.render(
    {
      lines: ["\u001b[2Junsafe"],
      semantics: [{ role: "status", label: "safe" }],
    },
    {
      capabilities: {
        width: 40,
        height: 2,
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
    },
  );
  expect((frame.payload as { semantics?: unknown }).semantics).toEqual([
    { role: "status", label: "safe" },
  ]);
  expect(
    new TextDecoder().decode(backend.diff(undefined, frame).bytes),
  ).not.toContain("\u001b[2Junsafe");
});

test("cell backend and optional acceleration use pure Bun fallback", async () => {
  const backend = new CellRendererBackend();
  const controller = new AbortController();
  const frame = await backend.render(
    (buffer) => {
      buffer.write(0, 0, "ready");
    },
    {
      capabilities: {
        width: 10,
        height: 2,
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
      layout: new (
        await import("@mwillbanks/tuil-renderer")
      ).LayoutProjection(),
      signal: controller.signal,
    },
  );
  expect((frame.payload as { cells: readonly unknown[] }).cells).toHaveLength(
    20,
  );
  expect(
    (
      await loadOptionalCellAccelerator(async () => {
        throw new Error("missing");
      })
    ).id,
  ).toBe("typescript");
});

test("native accelerator discovers an artifact and preserves TypeScript diff bytes and counts", async () => {
  const previous = new CellBuffer(4, 2).frame();
  const current = new CellBuffer(4, 2);
  current.write(1, 0, "x", {
    foreground: { kind: "rgb", red: 20, green: 40, blue: 60 },
  });
  current.write(3, 1, "y");
  let openedPath: string | undefined;
  const accelerator = await loadNativeCellAccelerator({
    libraryPaths: ["/opt/tuil/libtuil_cell.test"],
    exists: (path) => path.endsWith(".test"),
    open: (path) => {
      openedPath = path;
      return {
        countChangedCells(left, right, length) {
          let changed = 0;
          for (let index = 0; index < length; index += 1) {
            if (left[index] !== right[index]) changed += 1;
          }
          return changed;
        },
      };
    },
  });
  expect(openedPath).toBe("/opt/tuil/libtuil_cell.test");
  expect(accelerator?.id).toBe("zig-ffi");
  const expected = diffCellFrames(previous, current.frame());
  const actual = accelerator?.diff(previous, current.frame());
  expect(actual?.bytes).toEqual(expected.bytes);
  expect(actual?.changedCells).toBe(expected.changedCells);
  expect(actual?.changedRows).toEqual(expected.changedRows);
  expect(actual?.dirtyRects).toEqual(expected.dirtyRects);
});

test("published native prototype loads only when requested through Bun FFI", async () => {
  const accelerator = await loadNativeCellAccelerator();
  expect(accelerator?.id).toBe("zig-ffi");
  const before = new CellBuffer(2, 1).frame();
  const after = new CellBuffer(2, 1);
  after.write(0, 0, "x");
  expect(accelerator?.diff(before, after.frame()).changedCells).toBe(1);
});

test("cell backend selects its configured accelerator for interactive diffs", async () => {
  let calls = 0;
  const backend = new CellRendererBackend({
    accelerator: {
      id: "test-native",
      available: true,
      diff(previous, current) {
        calls += 1;
        return diffCellFrames(previous, current);
      },
    },
  });
  const context = {
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
    mode: "interactive" as const,
    layout: new LayoutProjection(),
    signal: new AbortController().signal,
  };
  const first = await backend.render({ lines: ["one"] }, context);
  const second = await backend.render({ lines: ["two"] }, context);
  expect(backend.diff(first, second).changedCells).toBe(3);
  expect(calls).toBe(1);
});

test("native accelerator ignores missing and incompatible optional artifacts", async () => {
  expect(
    await loadNativeCellAccelerator({
      libraryPaths: ["/missing/native"],
      exists: () => false,
      open: () => {
        throw new Error("unreachable");
      },
    }),
  ).toBeUndefined();
  expect(
    await loadNativeCellAccelerator({
      libraryPaths: ["/broken/native"],
      exists: () => true,
      open: () => {
        throw new Error("wrong architecture");
      },
    }),
  ).toBeUndefined();
});

test("cell backend passes the shared renderer conformance fixtures", async () => {
  const controller = new AbortController();
  const result = await runRendererConformance(
    new CellRendererBackend(),
    [
      {
        id: "layout-focus-semantics-pointer-keyboard-scroll-static",
        tree: (buffer: CellBuffer) => {
          buffer.write(0, 0, "Save");
        },
        assertFrame(frame) {
          expect(
            (frame.payload as { cells: readonly unknown[] }).cells,
          ).toHaveLength(80 * 24);
        },
      },
      {
        id: "resize-overlay-form-editor-stream-cleanup",
        tree: (buffer: CellBuffer) => {
          buffer.border({ x: 0, y: 0, width: 20, height: 4 });
          buffer.write(1, 1, "Text field");
        },
        assertFrame(frame) {
          expect(frame.width).toBe(80);
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
  expect(result.backendId).toBe("cell");
});
