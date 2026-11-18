import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { LayoutProjection } from "@mwillbanks/tuil-renderer";
import {
  CellBuffer,
  CellRendererBackend,
  diffCellFrames,
  emptyCell,
  encodeCellOutput,
  type CellFrame,
} from "./index.ts";
let restoreClock: () => void;
beforeEach(() => {
  const clock = spyOn(performance, "now").mockReturnValue(0);
  restoreClock = () => clock.mockRestore();
});
afterEach(() => restoreClock());
test("cell buffers reject invalid dimensions and ignore nonintegral coordinates", () => {
  for (const dimension of [0, -1, 1.5, NaN, Infinity]) {
    expect(() => new CellBuffer(dimension, 1)).toThrow("positive");
    expect(() => new CellBuffer(1, dimension)).toThrow("positive");
  }
  const buffer = new CellBuffer(2, 1);
  buffer.set(0.5, 0, { ...emptyCell, grapheme: "x" });
  expect(buffer.get(0.5, 0)).toBeUndefined();
  expect(buffer.get(2, 0)).toBeUndefined();
  expect(buffer.frame().cells.map((cell) => cell.grapheme)).toEqual([" ", " "]);
});
test("cell writes preserve emoji clusters and ignore unattached marks and tiny borders", () => {
  const buffer = new CellBuffer(8, 2);
  expect(buffer.write(0, 0, "👩‍💻🇺🇸é")).toBe(5);
  expect(buffer.get(0, 0)?.grapheme).toBe("👩‍💻");
  expect(buffer.get(1, 0)?.continuation).toBe(true);
  expect(buffer.get(2, 0)?.grapheme).toBe("🇺🇸");
  buffer.write(0, 1, "\u0301");
  expect(buffer.get(0, 1)?.grapheme).toBe(" ");
  buffer.border({ x: 0, y: 1, width: 1, height: 1 });
  expect(buffer.get(0, 1)?.grapheme).toBe(" ");
});
test("frame delta shrink erases removed columns and emits complete styles and cursor geometry", () => {
  const previous = new CellBuffer(4, 2);
  previous.write(0, 0, "long");
  const current = new CellBuffer(2, 2);
  current.write(0, 0, "x", {
    foreground: { kind: "rgb", red: 1, green: 2, blue: 3 },
    background: { kind: "indexed", value: 8 },
    attributes: {
      dim: true,
      italic: true,
      underline: true,
      inverse: true,
      strike: true,
    },
    link: "mailto:help@example.test",
  });
  current.setCursor({ x: 1, y: 1, visible: true, shape: "underline" });
  const output = diffCellFrames(previous.frame(), current.frame());
  const text = new TextDecoder().decode(output.bytes);
  expect(text).toContain("\x1b[1;3H  ");
  expect(text).toContain("38;2;1;2;3;48;5;8;2;3;4;7;9");
  expect(text).toContain("\x1b[3 q");
  expect(text).toContain("mailto:help@example.test");
  current.setCursor({ x: 0, y: 0, visible: true, shape: "line" });
  expect(
    new TextDecoder().decode(diffCellFrames(undefined, current.frame()).bytes),
  ).toContain("\x1b[5 q");
});
test("frame normalization validates rectangular buffers, cell types and channel ranges", async () => {
  const backend = new CellRendererBackend();
  const controller = new AbortController();
  const context = {
    capabilities: {
      width: 2,
      height: 1,
      colorDepth: 24 as const,
      unicode: true,
      hyperlinks: false,
      interactive: true,
      tty: true,
      alternateScreen: true,
      mouse: false,
      images: false,
      reducedMotion: false,
      platform: "linux" as const,
    },
    mode: "interactive" as const,
    layout: new LayoutProjection(),
    signal: controller.signal,
  };
  const valid = new CellBuffer(2, 1).frame();
  await expect(
    backend.render({ ...valid, cells: [] }, context),
  ).rejects.toThrow("rectangular");
  await expect(
    backend.render(
      { ...valid, cells: [{ ...emptyCell, grapheme: 1 } as never, emptyCell] },
      context,
    ),
  ).rejects.toThrow("string");
  await expect(
    backend.render(
      {
        ...valid,
        cells: [
          { ...emptyCell, foreground: { kind: "indexed", value: 256 } },
          emptyCell,
        ],
      },
      context,
    ),
  ).rejects.toThrow("foreground");
  const withLink: CellFrame = {
    ...valid,
    cells: [
      { ...emptyCell, grapheme: "x", link: "https://example.test" },
      emptyCell,
    ],
  };
  const frame = await backend.render(withLink, context);
  expect((frame.payload as CellFrame).cells[0]?.link).toBeUndefined();
  expect(
    new TextDecoder().decode(
      encodeCellOutput(frame.payload as CellFrame, "static").bytes,
    ),
  ).toBe("x");
  controller.abort(new Error("stopped"));
  await expect(backend.render(valid, context)).rejects.toThrow("stopped");
});
