import { terminalTextWidth } from "@mwillbanks/tuil-core";
import {
  normalizeRendererScene,
  type RendererBackend,
  type RendererColor,
  type RendererContext,
  type RendererFrame,
  type RendererOutput,
  type RendererScene,
  type RendererTextStyle,
  resolveRendererColor,
} from "@mwillbanks/tuil-renderer";

export type InkRendererTree = RendererScene;

function rendererColorCode(color: RendererColor, background: boolean): string {
  const resolved = resolveRendererColor(color);
  if (resolved.kind === "default") return String(background ? 49 : 39);
  const base = background ? 48 : 38;
  return resolved.kind === "indexed"
    ? `${base};5;${resolved.value}`
    : `${base};2;${resolved.red};${resolved.green};${resolved.blue}`;
}

function rendererStyleCode(style: RendererTextStyle | undefined): string {
  if (!style) return "\u001b[0m";
  const codes = ["0"];
  if (style.foreground) codes.push(rendererColorCode(style.foreground, false));
  if (style.background) codes.push(rendererColorCode(style.background, true));
  const attributes = [
    [style.bold, "1"],
    [style.dim, "2"],
    [style.italic, "3"],
    [style.underline, "4"],
    [style.inverse, "7"],
    [style.strike, "9"],
  ] as const;
  codes.push(
    ...attributes.flatMap(([enabled, code]) => (enabled ? [code] : [])),
  );
  return `\u001b[${codes.join(";")}m`;
}

function styledFrameText(tree: InkRendererTree): string {
  if (!tree.styledLines) return tree.lines.join("\n");
  return tree.styledLines
    .map((line) =>
      line
        .map((run) => {
          const openLink = run.link ? `\u001b]8;;${run.link}\u0007` : "";
          const closeLink = run.link ? "\u001b]8;;\u0007" : "";
          return `${rendererStyleCode(run.style)}${openLink}${run.text}${closeLink}`;
        })
        .join(""),
    )
    .join("\u001b[0m\n");
}

function cursorOutput(cursor: RendererFrame["cursor"] | undefined): string {
  if (!cursor) return "";
  if (!cursor.visible) return "\u001b[?25l";
  const shape = {
    block: 2,
    line: 6,
    underline: 4,
  }[cursor.shape ?? "block"];
  return `\u001b[${cursor.y + 1};${cursor.x + 1}H\u001b[${shape} q\u001b[?25h`;
}

function frameText(tree: InkRendererTree): string {
  return tree.lines.join("\n");
}

function changedRows(
  before: string | undefined,
  after: string,
): readonly number[] {
  const previous = before?.split("\n") ?? [];
  const current = after.split("\n");
  const count = Math.max(previous.length, current.length);
  const rows: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (previous[index] !== current[index]) rows.push(index);
  }
  return Object.freeze(rows);
}

function outputBytes(
  mode: RendererContext["mode"],
  payload: unknown,
  rendered: string,
  changed: number,
): Uint8Array {
  if (changed === 0 || mode === "silent") return new Uint8Array();
  const output = mode === "json" ? JSON.stringify(payload) : rendered;
  return new TextEncoder().encode(output);
}

function dirtyOutput(
  previousFrame: string | undefined,
  current: RendererFrame,
  frame: string,
  rows: readonly number[],
): Pick<RendererOutput, "changedRows" | "dirtyRects"> {
  if (rows.length === 0)
    return { changedRows: Object.freeze([]), dirtyRects: Object.freeze([]) };
  const before = previousFrame?.split("\n") ?? [];
  const after = frame.split("\n");
  return {
    changedRows: rows,
    dirtyRects: Object.freeze(
      rows.map((row) => ({
        x: 0,
        y: row,
        width: Math.min(
          current.width,
          Math.max(
            terminalTextWidth(before[row] ?? ""),
            terminalTextWidth(after[row] ?? ""),
          ),
        ),
        height: 1,
      })),
    ),
  };
}

interface InkFramePayload {
  readonly frame: string;
  readonly rendered?: string;
  readonly semantics?: unknown;
}

function rendererChangeRows(
  before: InkFramePayload | undefined,
  after: InkFramePayload,
  unchanged: boolean,
): readonly number[] {
  if (unchanged) return Object.freeze([]);
  const rows = changedRows(before?.frame, after.frame);
  if (rows.length > 0) return rows;
  return Object.freeze(
    Array.from(
      { length: Math.max(1, after.frame.split("\n").length) },
      (_, index) => index,
    ),
  );
}

function changedCellCount(
  before: InkFramePayload | undefined,
  after: InkFramePayload,
  rows: readonly number[],
  mode: RendererContext["mode"],
): number {
  if (mode === "json") return JSON.stringify(after).length;
  const beforeLines = before?.frame?.split("\n") ?? [];
  const afterLines = after.frame.split("\n");
  return rows.reduce(
    (total, row) =>
      total +
      Math.max(
        terminalTextWidth(beforeLines[row] ?? ""),
        terminalTextWidth(afterLines[row] ?? ""),
      ),
    0,
  );
}

export class InkRendererBackend implements RendererBackend<InkRendererTree> {
  readonly id = "ink";
  readonly capabilities = new Set([
    "ink",
    "renderer-application",
    "react-ink-components",
    "pointer",
    "scroll",
    "clipboard",
    "alternate-screen",
    "inline",
    "static",
    "json",
    "silent",
    "embedded",
  ] as const);
  #sequence: number;

  constructor() {
    this.#sequence = 0;
  }

  render(tree: InkRendererTree, context: RendererContext): RendererFrame {
    if (context.signal.aborted) throw context.signal.reason;
    const scene = normalizeRendererScene(
      tree,
      context.capabilities.width,
      context.capabilities.height,
      context.capabilities.hyperlinks,
    );
    const frame = frameText(scene);
    return Object.freeze({
      width: context.capabilities.width,
      height: context.capabilities.height,
      sequence: ++this.#sequence,
      timestamp: performance.now(),
      mode: context.mode,
      payload: Object.freeze({
        frame,
        rendered:
          context.mode === "interactive"
            ? `${styledFrameText(scene)}\u001b[0m${cursorOutput(scene.cursor)}`
            : frame,
        semantics: scene.semantics,
      }),
      cursor: scene.cursor,
    });
  }

  diff(
    previous: RendererFrame | undefined,
    current: RendererFrame,
  ): RendererOutput {
    const before = previous?.payload as InkFramePayload | undefined;
    const after = current.payload as InkFramePayload & {
      readonly rendered: string;
    };
    const mode = current.mode ?? "interactive";
    const unchanged =
      mode === "json"
        ? JSON.stringify(before) === JSON.stringify(after)
        : before?.rendered === after.rendered;
    const rows = rendererChangeRows(before, after, unchanged);
    const changed = unchanged ? 0 : changedCellCount(before, after, rows, mode);
    const dirty = dirtyOutput(before?.frame, current, after.frame, rows);
    return Object.freeze({
      bytes: outputBytes(mode, current.payload, after.rendered, changed),
      changedCells: mode === "silent" ? 0 : changed,
      ...dirty,
    });
  }
}
