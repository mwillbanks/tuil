import {
  escapeTerminalControlCharacters,
  type SemanticMetadata,
  type TerminalBounds,
} from "@mwillbanks/tuil-core";
import {
  normalizeRendererHyperlink,
  normalizeRendererScene,
  type RendererBackend,
  type RendererColor,
  type RendererContext,
  type RendererFrame,
  type RendererOutput,
  type RendererScene,
  type RendererTextStyle,
  resolveRendererColor,
  validateRendererCursor,
} from "@mwillbanks/tuil-renderer";
import stringWidth from "string-width";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

export type Color =
  | { readonly kind: "default" }
  | { readonly kind: "indexed"; readonly value: number }
  | {
      readonly kind: "rgb";
      readonly red: number;
      readonly green: number;
      readonly blue: number;
    };

export interface CellAttributes {
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
  readonly strike?: boolean;
}

export interface Cell {
  readonly grapheme: string;
  readonly foreground: Color;
  readonly background: Color;
  readonly attributes: CellAttributes;
  readonly link?: string;
  readonly continuation?: boolean;
}

export interface CursorState {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly shape?: "block" | "line" | "underline";
}

export interface CellFrame {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly Cell[];
  readonly cursor?: CursorState;
  readonly semantics?: RendererScene["semantics"];
}

function normalizeCellFrame(frame: CellFrame, hyperlinks = true): CellFrame {
  if (
    !Number.isSafeInteger(frame.width) ||
    !Number.isSafeInteger(frame.height) ||
    frame.width < 1 ||
    frame.height < 1 ||
    frame.cells.length !== frame.width * frame.height
  ) {
    throw new TypeError(
      "Cell frame dimensions must match its complete rectangular cell buffer",
    );
  }
  const cells = frame.cells.map((cell) => normalizeCell(cell, hyperlinks));
  validateRendererCursor(frame.cursor, frame.width, frame.height);
  return Object.freeze({ ...frame, cells: Object.freeze(cells) });
}

export const defaultColor: Color = Object.freeze({ kind: "default" });
export const emptyCell: Cell = Object.freeze({
  grapheme: " ",
  foreground: defaultColor,
  background: defaultColor,
  attributes: Object.freeze({}),
});

function rendererColor(value: RendererColor | undefined): Color | undefined {
  return value === undefined ? undefined : resolveRendererColor(value);
}

function rendererCellStyle(
  style: RendererTextStyle | undefined,
  link: string | undefined,
): Partial<Omit<Cell, "grapheme" | "continuation">> {
  return {
    foreground: rendererColor(style?.foreground),
    background: rendererColor(style?.background),
    attributes: Object.freeze({
      bold: style?.bold,
      dim: style?.dim,
      italic: style?.italic,
      underline: style?.underline,
      inverse: style?.inverse,
      strike: style?.strike,
    }),
    link,
  };
}

function cloneCell(cell: Cell): Cell {
  validateCell(cell);
  return Object.freeze({
    ...cell,
    foreground: Object.freeze({ ...cell.foreground }),
    background: Object.freeze({ ...cell.background }),
    attributes: Object.freeze({ ...cell.attributes }),
  });
}

function validateCellColor(color: Color, label: string): void {
  try {
    resolveRendererColor(color);
  } catch (error) {
    if (error instanceof Error) {
      throw new TypeError(`${label} is invalid: ${error.message}`);
    }
    throw error;
  }
}

function normalizeCell(cell: Cell, hyperlinks: boolean): Cell {
  if (typeof cell.grapheme !== "string") {
    throw new TypeError("Cell grapheme must be a string");
  }
  validateCellColor(cell.foreground, "Cell foreground");
  validateCellColor(cell.background, "Cell background");
  const link = normalizeRendererHyperlink(cell.link, hyperlinks);
  if (
    link === cell.link &&
    Object.isFrozen(cell) &&
    Object.isFrozen(cell.foreground) &&
    Object.isFrozen(cell.background) &&
    Object.isFrozen(cell.attributes)
  ) {
    return cell;
  }
  return Object.freeze({
    ...cell,
    foreground: Object.freeze({ ...cell.foreground }),
    background: Object.freeze({ ...cell.background }),
    attributes: Object.freeze({ ...cell.attributes }),
    link,
  });
}

function validateCell(cell: Cell): void {
  normalizeCell(cell, true);
}

function cellKey(cell: Cell): string {
  return JSON.stringify(cell);
}

function inRect(x: number, y: number, rect: TerminalBounds): boolean {
  return (
    x >= rect.x &&
    y >= rect.y &&
    x < rect.x + rect.width &&
    y < rect.y + rect.height
  );
}

export class CellBuffer {
  readonly width: number;
  readonly height: number;
  readonly #cells: Cell[];
  #cursor?: CursorState;

  constructor(width: number, height: number, fill: Cell = emptyCell) {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1
    ) {
      throw new Error("Cell buffer dimensions must be positive integers");
    }
    this.width = width;
    this.height = height;
    this.#cells = Array.from({ length: width * height }, () => cloneCell(fill));
  }

  get(x: number, y: number): Cell | undefined {
    if (!this.#contains(x, y)) return undefined;
    return this.#cells[y * this.width + x];
  }

  set(x: number, y: number, cell: Cell, clip?: TerminalBounds): void {
    if (!this.#contains(x, y) || (clip && !inRect(x, y, clip))) return;
    if (!cell.continuation) this.#clearWideCellAt(x, y);
    this.#setRaw(x, y, cell);
  }

  write(
    x: number,
    y: number,
    value: string,
    style: Partial<Omit<Cell, "grapheme" | "continuation">> = {},
    clip: TerminalBounds = {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    },
  ): number {
    let cursor = x;
    const safeValue = escapeTerminalControlCharacters(value);
    for (const grapheme of graphemeSegmenter.segment(safeValue)) {
      const width = stringWidth(grapheme.segment);
      if (width === 0) {
        this.#appendZeroWidth(cursor, y, grapheme.segment, clip);
        continue;
      }
      if (cursor + width > clip.x + clip.width || cursor + width > this.width)
        break;
      this.#writeGrapheme(cursor, y, grapheme.segment, width, style, clip);
      cursor += width;
    }
    return cursor;
  }

  fill(rect: TerminalBounds, cell: Cell, clip?: TerminalBounds): void {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1)
        this.set(x, y, cell, clip);
    }
  }

  clear(cell: Cell = emptyCell): void {
    this.#cells.fill(cloneCell(cell));
    this.#cursor = undefined;
  }

  erase(rect: TerminalBounds): void {
    this.fill(rect, emptyCell);
  }

  border(
    rect: TerminalBounds,
    style: Partial<Omit<Cell, "grapheme" | "continuation">> = {},
    glyphs = {
      top: "─",
      bottom: "─",
      left: "│",
      right: "│",
      topLeft: "┌",
      topRight: "┐",
      bottomLeft: "└",
      bottomRight: "┘",
    },
    clip: TerminalBounds = rect,
  ): void {
    if (rect.width < 2 || rect.height < 2) return;
    this.write(
      rect.x,
      rect.y,
      glyphs.topLeft + glyphs.top.repeat(rect.width - 2) + glyphs.topRight,
      style,
      clip,
    );
    this.write(
      rect.x,
      rect.y + rect.height - 1,
      glyphs.bottomLeft +
        glyphs.bottom.repeat(rect.width - 2) +
        glyphs.bottomRight,
      style,
      clip,
    );
    for (let y = rect.y + 1; y < rect.y + rect.height - 1; y += 1) {
      this.write(rect.x, y, glyphs.left, style, clip);
      this.write(rect.x + rect.width - 1, y, glyphs.right, style, clip);
    }
  }

  composite(
    source: CellFrame,
    xOffset = 0,
    yOffset = 0,
    clip?: TerminalBounds,
  ): void {
    const actualClip = clip ?? {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    };
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const cell = source.cells[y * source.width + x];
        if (cell) this.set(x + xOffset, y + yOffset, cell, actualClip);
      }
    }
  }

  setCursor(cursor: CursorState | undefined): void {
    validateRendererCursor(cursor, this.width, this.height);
    this.#cursor = cursor ? Object.freeze({ ...cursor }) : undefined;
  }

  frame(): CellFrame {
    return Object.freeze({
      width: this.width,
      height: this.height,
      cells: Object.freeze(this.#cells.map(cloneCell)),
      cursor: this.#cursor,
    });
  }

  #contains(x: number, y: number): boolean {
    return (
      Number.isSafeInteger(x) &&
      Number.isSafeInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height
    );
  }

  #setRaw(x: number, y: number, cell: Cell): void {
    this.#cells[y * this.width + x] = cloneCell(cell);
  }

  #appendZeroWidth(
    cursor: number,
    y: number,
    grapheme: string,
    clip: TerminalBounds,
  ): void {
    const previous = this.get(cursor - 1, y);
    if (!previous) return;
    this.set(
      cursor - 1,
      y,
      { ...previous, grapheme: previous.grapheme + grapheme },
      clip,
    );
  }

  #writeGrapheme(
    x: number,
    y: number,
    grapheme: string,
    width: number,
    style: Partial<Omit<Cell, "grapheme" | "continuation">>,
    clip: TerminalBounds,
  ): void {
    const cell: Cell = {
      grapheme,
      foreground: style.foreground ?? defaultColor,
      background: style.background ?? defaultColor,
      attributes: style.attributes ?? {},
      link: style.link,
    };
    this.set(x, y, cell, clip);
    for (let offset = 1; offset < width; offset += 1) {
      const continuationX = x + offset;
      if (inRect(continuationX, y, clip)) {
        this.#setRaw(continuationX, y, {
          ...cell,
          grapheme: "",
          continuation: true,
        });
      }
    }
  }

  #clearWideCellAt(x: number, y: number): void {
    const start = this.#wideCellStart(x, y);
    const leading = this.get(start, y);
    if (start !== x || (leading && stringWidth(leading.grapheme) > 1)) {
      this.#setRaw(start, y, emptyCell);
    }
    this.#clearContinuations(start, y);
  }

  #wideCellStart(x: number, y: number): number {
    let start = x;
    while (start > 0 && this.get(start, y)?.continuation) start -= 1;
    return start;
  }

  #clearContinuations(start: number, y: number): void {
    for (
      let column = start + 1;
      column < this.width && this.get(column, y)?.continuation;
      column += 1
    ) {
      this.#setRaw(column, y, emptyCell);
    }
  }
}

export interface CellSceneNode {
  readonly id: string;
  readonly kind: "box" | "text";
  readonly text?: string;
  readonly children?: readonly CellSceneNode[];
  readonly direction?: "row" | "column";
  readonly position?: "flow" | "absolute" | "portal";
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly margin?: number;
  readonly border?: boolean;
  readonly clip?: boolean;
  readonly zIndex?: number;
  readonly focusable?: boolean;
  readonly pointerEvents?: "auto" | "none";
  readonly scrollContainerId?: string;
  readonly semantics?: Omit<SemanticMetadata, "id">;
  readonly style?: Partial<Omit<Cell, "grapheme" | "continuation">>;
}

interface ScenePlacement {
  readonly node: CellSceneNode;
  readonly parentId?: string;
  readonly bounds: TerminalBounds;
  readonly clip: TerminalBounds;
}

interface FlowLayout {
  readonly content: TerminalBounds;
  readonly direction: "row" | "column";
  readonly share: number;
}

function intersectBounds(
  left: TerminalBounds,
  right: TerminalBounds,
): TerminalBounds {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  return {
    x,
    y,
    width: Math.max(
      0,
      Math.min(left.x + left.width, right.x + right.width) - x,
    ),
    height: Math.max(
      0,
      Math.min(left.y + left.height, right.y + right.height) - y,
    ),
  };
}

function placeScene(
  node: CellSceneNode,
  parent: TerminalBounds,
  parentClip: TerminalBounds,
  parentId: string | undefined,
  placements: ScenePlacement[],
): void {
  const bounds = sceneBounds(node, parent);
  const clip = sceneClip(node, bounds, parentClip);
  placements.push({ node, parentId, bounds, clip });
  const flow = flowLayout(node, bounds);
  let cursor = flow.direction === "row" ? flow.content.x : flow.content.y;
  for (const child of node.children ?? []) {
    const childParent = childSceneParent(child, flow, cursor);
    if ((child.position ?? "flow") === "flow") {
      cursor +=
        flow.direction === "row"
          ? (child.width ?? flow.share)
          : (child.height ?? flow.share);
    }
    placeScene(child, childParent, clip, node.id, placements);
  }
}

function sceneBounds(
  node: CellSceneNode,
  parent: TerminalBounds,
): TerminalBounds {
  const margin = Math.max(0, node.margin ?? 0);
  const detached = node.position === "absolute" || node.position === "portal";
  return {
    x: (detached ? (node.x ?? 0) : parent.x) + margin,
    y: (detached ? (node.y ?? 0) : parent.y) + margin,
    width: Math.max(0, (node.width ?? parent.width) - margin * 2),
    height: Math.max(0, (node.height ?? parent.height) - margin * 2),
  };
}

function sceneClip(
  node: CellSceneNode,
  bounds: TerminalBounds,
  parentClip: TerminalBounds,
): TerminalBounds {
  return node.position === "portal" || node.clip === false
    ? parentClip
    : intersectBounds(parentClip, bounds);
}

function flowLayout(node: CellSceneNode, bounds: TerminalBounds): FlowLayout {
  const padding = Math.max(0, node.padding ?? 0) + (node.border ? 1 : 0);
  const content = {
    x: bounds.x + padding,
    y: bounds.y + padding,
    width: Math.max(0, bounds.width - padding * 2),
    height: Math.max(0, bounds.height - padding * 2),
  };
  const flow = (node.children ?? []).filter(
    (child) => (child.position ?? "flow") === "flow",
  );
  const direction = node.direction ?? "column";
  const horizontal = direction === "row";
  const available = horizontal ? content.width : content.height;
  const explicit = flow.reduce(
    (sum, child) =>
      sum + (horizontal ? (child.width ?? 0) : (child.height ?? 0)),
    0,
  );
  const flexible = flow.filter((child) =>
    horizontal ? child.width === undefined : child.height === undefined,
  ).length;
  return {
    content,
    direction,
    share:
      flexible > 0
        ? Math.max(0, Math.floor((available - explicit) / flexible))
        : 0,
  };
}

function childSceneParent(
  child: CellSceneNode,
  flow: FlowLayout,
  cursor: number,
): TerminalBounds {
  if ((child.position ?? "flow") !== "flow") return flow.content;
  return flow.direction === "row"
    ? { ...flow.content, x: cursor, width: child.width ?? flow.share }
    : { ...flow.content, y: cursor, height: child.height ?? flow.share };
}

export function composeCellScene(
  root: CellSceneNode,
  width: number,
  height: number,
  layout?: RendererContext["layout"],
): CellFrame {
  const buffer = new CellBuffer(width, height);
  const viewport = { x: 0, y: 0, width, height };
  const placements: ScenePlacement[] = [];
  placeScene(root, viewport, viewport, undefined, placements);
  const ordered = placements.sort(
    (left, right) => (left.node.zIndex ?? 0) - (right.node.zIndex ?? 0),
  );
  for (const placement of ordered) {
    renderPlacement(buffer, placement);
  }
  layout?.reconcile(ordered.map(layoutNode));
  return Object.freeze({
    ...buffer.frame(),
    semantics: Object.freeze(ordered.map(sceneSemantics)),
  });
}

function sceneSemantics({ node }: ScenePlacement): SemanticMetadata {
  return Object.freeze({
    id: node.id,
    role: node.kind === "text" ? "text" : "application",
    ...node.semantics,
  });
}

function renderPlacement(buffer: CellBuffer, placement: ScenePlacement): void {
  if (placement.node.kind === "box") {
    renderBoxPlacement(buffer, placement);
    return;
  }
  renderTextPlacement(buffer, placement);
}

function renderBoxPlacement(
  buffer: CellBuffer,
  { node, bounds, clip }: ScenePlacement,
): void {
  if (node.style?.background) {
    buffer.fill(
      bounds,
      {
        ...emptyCell,
        background: node.style.background,
        foreground: node.style.foreground ?? defaultColor,
        attributes: node.style.attributes ?? {},
        link: node.style.link,
      },
      clip,
    );
  }
  if (node.border) buffer.border(bounds, node.style, undefined, clip);
}

function renderTextPlacement(
  buffer: CellBuffer,
  { node, bounds, clip }: ScenePlacement,
): void {
  for (const [index, line] of (node.text ?? "").split("\n").entries()) {
    if (index >= bounds.height) break;
    buffer.write(bounds.x, bounds.y + index, line, node.style, clip);
  }
}

function layoutNode(
  placement: ScenePlacement,
): Parameters<NonNullable<RendererContext["layout"]>["upsert"]>[0] {
  const { node, bounds, clip } = placement;
  return {
    id: node.id,
    parentId: placement.parentId,
    bounds,
    clip,
    zIndex: node.zIndex ?? 0,
    focusable: node.focusable ?? false,
    pointerEvents: node.pointerEvents ?? "none",
    scrollContainerId: node.scrollContainerId,
    semantics: sceneSemantics(placement),
  };
}

function colorCode(color: Color, background: boolean): string {
  const base = background ? 48 : 38;
  if (color.kind === "default") return String(background ? 49 : 39);
  if (color.kind === "indexed") return `${base};5;${color.value}`;
  return `${base};2;${color.red};${color.green};${color.blue}`;
}

function styleCode(cell: Cell): string {
  const codes = [
    "0",
    colorCode(cell.foreground, false),
    colorCode(cell.background, true),
  ];
  if (cell.attributes.bold) codes.push("1");
  if (cell.attributes.dim) codes.push("2");
  if (cell.attributes.italic) codes.push("3");
  if (cell.attributes.underline) codes.push("4");
  if (cell.attributes.inverse) codes.push("7");
  if (cell.attributes.strike) codes.push("9");
  return `\u001b[${codes.join(";")}m`;
}

function mergeDirtyCells(
  points: readonly { x: number; y: number }[],
): readonly TerminalBounds[] {
  const rows = new Map<number, number[]>();
  for (const point of points) {
    const columns = rows.get(point.y) ?? [];
    columns.push(point.x);
    rows.set(point.y, columns);
  }
  return Object.freeze(
    [...rows.entries()].map(([y, columns]) => {
      const min = Math.min(...columns);
      const max = Math.max(...columns);
      return Object.freeze({ x: min, y, width: max - min + 1, height: 1 });
    }),
  );
}

export function diffCellFrames(
  previous: CellFrame | undefined,
  current: CellFrame,
): RendererOutput {
  validateRendererCursor(current.cursor, current.width, current.height);
  const changed: { x: number; y: number }[] = [];
  const writer = new CellDiffWriter();
  for (let y = 0; y < current.height; y += 1) {
    for (let x = 0; x < current.width; x += 1) {
      const index = y * current.width + x;
      const cell = current.cells[index] ?? emptyCell;
      const old =
        previous?.width === current.width && previous.height === current.height
          ? previous.cells[index]
          : undefined;
      if (old && cellKey(old) === cellKey(cell)) continue;
      changed.push({ x, y });
      writer.write(cell, x, y);
    }
  }
  writer.eraseRemoved(previous, current);
  const output = writer.finish(current.cursor);
  const changedRows = Object.freeze([
    ...new Set(changed.map((point) => point.y)),
  ]);
  return Object.freeze({
    bytes: new TextEncoder().encode(output),
    fullFrame: false,
    changedCells: changed.length,
    changedRows,
    dirtyRects: mergeDirtyCells(changed),
  });
}

class CellDiffWriter {
  #output = "";
  #activeStyle = "";
  #activeLink?: string;
  #x = -1;
  #y = -1;

  write(cell: Cell, x: number, y: number): void {
    if (cell.continuation) return;
    if (this.#y !== y || this.#x !== x) {
      this.#output += `\u001b[${y + 1};${x + 1}H`;
    }
    const style = styleCode(cell);
    if (style !== this.#activeStyle) {
      this.#output += style;
      this.#activeStyle = style;
    }
    this.#setLink(cell.link);
    const grapheme = escapeTerminalControlCharacters(cell.grapheme);
    this.#output += grapheme || " ";
    this.#x = x + Math.max(1, stringWidth(grapheme));
    this.#y = y;
  }

  finish(cursor: CursorState | undefined): string {
    this.#setLink(undefined);
    this.#output += cursor?.visible
      ? `${cursorShape(cursor.shape)}\u001b[${cursor.y + 1};${cursor.x + 1}H\u001b[?25h`
      : "\u001b[?25l";
    return `${this.#output}\u001b[0m`;
  }

  eraseRemoved(previous: CellFrame | undefined, current: CellFrame): void {
    if (!previous) return;
    if (previous.width > current.width) {
      const removedColumns = " ".repeat(previous.width - current.width);
      for (let y = 0; y < Math.min(previous.height, current.height); y += 1) {
        this.#output += `\u001b[${y + 1};${current.width + 1}H${removedColumns}`;
      }
    }
    for (let y = current.height; y < previous.height; y += 1) {
      this.#output += `\u001b[${y + 1};1H\u001b[2K`;
    }
  }

  #setLink(link: string | undefined): void {
    link = safeHyperlink(link);
    if (link === this.#activeLink) return;
    if (this.#activeLink) this.#output += "\u001b]8;;\u0007";
    if (link) this.#output += `\u001b]8;;${link}\u0007`;
    this.#activeLink = link;
  }
}

function safeHyperlink(link: string | undefined): string | undefined {
  if (!link || hasTerminalControl(link)) return undefined;
  try {
    const protocol = new URL(link).protocol;
    return ["http:", "https:", "mailto:"].includes(protocol) ? link : undefined;
  } catch {
    return undefined;
  }
}

function hasTerminalControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function cursorShape(shape: CursorState["shape"]): string {
  if (shape === "line") return "\u001b[5 q";
  if (shape === "underline") return "\u001b[3 q";
  return "\u001b[1 q";
}

export type CellOutputMode = "ansi" | "static" | "json" | "silent";

function cellFrameText(frame: CellFrame): string {
  return Array.from({ length: frame.height }, (_value, y) =>
    frame.cells
      .slice(y * frame.width, (y + 1) * frame.width)
      .flatMap((cell) =>
        cell.continuation
          ? []
          : [escapeTerminalControlCharacters(cell.grapheme)],
      )
      .join("")
      .trimEnd(),
  )
    .join("\n")
    .replace(/\n+$/u, "");
}

export function encodeCellOutput(
  frame: CellFrame,
  mode: CellOutputMode,
  previous?: CellFrame,
): RendererOutput {
  if (mode === "ansi") return diffCellFrames(previous, frame);
  if (mode === "static") {
    return Object.freeze({
      bytes: new TextEncoder().encode(cellFrameText(frame)),
      fullFrame: true,
      changedCells: frame.cells.length,
      changedRows: Object.freeze(
        Array.from({ length: frame.height }, (_, index) => index),
      ),
      dirtyRects: Object.freeze([
        { x: 0, y: 0, width: frame.width, height: frame.height },
      ]),
    });
  }
  if (mode === "silent") {
    return Object.freeze({
      bytes: new Uint8Array(),
      changedCells: 0,
      changedRows: Object.freeze([]),
      dirtyRects: Object.freeze([]),
    });
  }
  return Object.freeze({
    bytes: new TextEncoder().encode(
      JSON.stringify({
        width: frame.width,
        height: frame.height,
        cells: frame.cells,
        cursor: frame.cursor,
        semantics: frame.semantics,
      }),
    ),
    fullFrame: true,
    changedCells: frame.cells.length,
    changedRows: Object.freeze(
      Array.from({ length: frame.height }, (_, index) => index),
    ),
    dirtyRects: Object.freeze([
      { x: 0, y: 0, width: frame.width, height: frame.height },
    ]),
  });
}

export type CellTree =
  | CellFrame
  | CellSceneNode
  | RendererScene
  | ((buffer: CellBuffer, context: RendererContext) => void | Promise<void>);

export interface CellRendererBackendOptions {
  readonly accelerator?:
    | CellAccelerator
    | Promise<CellAccelerator>
    | (() => CellAccelerator | Promise<CellAccelerator>);
}

export class CellRendererBackend implements RendererBackend<CellTree> {
  readonly id = "cell";
  readonly capabilities = new Set([
    "cells",
    "renderer-application",
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
  #accelerator = typescriptCellAccelerator;
  readonly #acceleratorReady: Promise<void>;
  #sequence = 0;

  constructor(options: CellRendererBackendOptions = {}) {
    const configured = options.accelerator ?? typescriptCellAccelerator;
    this.#acceleratorReady = Promise.resolve(
      typeof configured === "function" ? configured() : configured,
    ).then((accelerator) => {
      this.#accelerator = accelerator;
    });
  }

  async render(
    tree: CellTree,
    context: RendererContext,
  ): Promise<RendererFrame> {
    await this.#acceleratorReady;
    if (context.signal.aborted) throw context.signal.reason;
    const projected =
      typeof tree === "function"
        ? await this.#renderFunction(tree, context)
        : "lines" in tree
          ? this.#renderScene(tree, context)
          : "kind" in tree
            ? composeCellScene(
                tree,
                context.capabilities.width,
                context.capabilities.height,
                context.layout,
              )
            : tree;
    const frame = normalizeCellFrame(
      projected,
      context.capabilities.hyperlinks,
    );
    return Object.freeze({
      width: frame.width,
      height: frame.height,
      sequence: ++this.#sequence,
      timestamp: performance.now(),
      mode: context.mode,
      payload: frame,
      cursor: frame.cursor,
    });
  }

  diff(
    previous: RendererFrame | undefined,
    current: RendererFrame,
  ): RendererOutput {
    const mode = current.mode ?? "interactive";
    if (mode === "interactive") {
      return this.#accelerator.diff(
        previous?.payload as CellFrame | undefined,
        current.payload as CellFrame,
      );
    }
    return encodeCellOutput(
      current.payload as CellFrame,
      mode === "json" ? "json" : mode === "silent" ? "silent" : "static",
      previous?.payload as CellFrame | undefined,
    );
  }

  #renderScene(tree: RendererScene, context: RendererContext): CellFrame {
    const scene = normalizeRendererScene(
      tree,
      context.capabilities.width,
      context.capabilities.height,
      context.capabilities.hyperlinks,
    );
    const buffer = new CellBuffer(
      context.capabilities.width,
      context.capabilities.height,
    );
    for (const [index, line] of scene.lines.entries()) {
      if (index >= buffer.height) break;
      const runs = scene.styledLines?.[index];
      if (!runs || runs.length === 0) {
        buffer.write(0, index, line);
        continue;
      }
      let column = 0;
      for (const run of runs) {
        column = buffer.write(
          column,
          index,
          run.text,
          rendererCellStyle(run.style, run.link),
        );
      }
    }
    buffer.setCursor(scene.cursor);
    return Object.freeze({ ...buffer.frame(), semantics: scene.semantics });
  }

  async #renderFunction(
    tree: (
      buffer: CellBuffer,
      context: RendererContext,
    ) => void | Promise<void>,
    context: RendererContext,
  ): Promise<CellFrame> {
    const buffer = new CellBuffer(
      context.capabilities.width,
      context.capabilities.height,
    );
    await tree(buffer, context);
    if (context.signal.aborted) throw context.signal.reason;
    return buffer.frame();
  }
}

export interface CellAccelerator {
  readonly id: string;
  readonly available: boolean;
  diff(previous: CellFrame | undefined, current: CellFrame): RendererOutput;
}

interface NativeCellDiffLibrary {
  countChangedCells(
    previous: BigUint64Array,
    current: BigUint64Array,
    length: number,
  ): number;
}

export interface NativeCellAcceleratorOptions {
  // Explicit candidates are tried in order before package-local prebuilds.
  readonly libraryPaths?: readonly string[];
  // Test/custom distribution seam; normal callers use Bun.file().exists().
  readonly exists?: (path: string) => boolean | Promise<boolean>;
  // Test/custom distribution seam; normal callers use Bun FFI.
  readonly open?: (
    path: string,
  ) => NativeCellDiffLibrary | Promise<NativeCellDiffLibrary>;
  readonly platform?: string;
  readonly architecture?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export const typescriptCellAccelerator: CellAccelerator = Object.freeze({
  id: "typescript",
  available: true,
  diff: diffCellFrames,
});

function nativeLibraryName(platform: string): string {
  if (platform === "darwin") return "libtuil_cell.dylib";
  if (platform === "win32") return "tuil_cell.dll";
  return "libtuil_cell.so";
}

function nativeLibraryCandidates(
  options: NativeCellAcceleratorOptions,
): readonly string[] {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const name = nativeLibraryName(platform);
  const platformArchitecture = `${platform}-${architecture}`;
  return Object.freeze(
    [
      (options.env ?? process.env)["TUIL_CELL_NATIVE_LIBRARY"],
      new URL(`./prebuilds/${platformArchitecture}/${name}`, import.meta.url)
        .pathname,
      new URL(`../prebuilds/${platformArchitecture}/${name}`, import.meta.url)
        .pathname,
      new URL(`./native/${name}`, import.meta.url).pathname,
      new URL(`../native/${name}`, import.meta.url).pathname,
    ].filter((path): path is string => Boolean(path)),
  );
}

async function openNativeCellLibrary(
  path: string,
): Promise<NativeCellDiffLibrary> {
  const { dlopen, ptr } = await import("bun:ffi");
  const library = dlopen(path, {
    count_changed_cells: {
      args: ["ptr", "ptr", "usize"],
      returns: "usize",
    },
  });
  return Object.freeze({
    countChangedCells(
      previous: BigUint64Array,
      current: BigUint64Array,
      length: number,
    ) {
      return Number(
        library.symbols.count_changed_cells(
          ptr(previous),
          ptr(current),
          length,
        ),
      );
    },
  });
}

function cellFingerprint(cell: Cell): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(cellKey(cell))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

function cellFingerprints(frame: CellFrame): BigUint64Array {
  return BigUint64Array.from(frame.cells, cellFingerprint);
}

function nativeAccelerator(library: NativeCellDiffLibrary): CellAccelerator {
  return Object.freeze({
    id: "zig-ffi",
    available: true,
    diff(previous: CellFrame | undefined, current: CellFrame) {
      const output = diffCellFrames(previous, current);
      if (
        !previous ||
        previous.width !== current.width ||
        previous.height !== current.height ||
        current.cells.length === 0
      ) {
        return output;
      }
      const previousCells = cellFingerprints(previous);
      const currentCells = cellFingerprints(current);
      return Object.freeze({
        ...output,
        changedCells: library.countChangedCells(
          previousCells,
          currentCells,
          currentCells.length,
        ),
      });
    },
  });
}

export async function loadNativeCellAccelerator(
  options: NativeCellAcceleratorOptions = {},
): Promise<CellAccelerator | undefined> {
  const candidates = [
    ...(options.libraryPaths ?? []),
    ...nativeLibraryCandidates(options),
  ];
  const exists = options.exists ?? ((path: string) => Bun.file(path).exists());
  const open = options.open ?? openNativeCellLibrary;
  for (const path of new Set(candidates)) {
    try {
      if (!(await exists(path))) continue;
      return nativeAccelerator(await open(path));
    } catch {
      // An incompatible optional artifact must never prevent Bun fallback.
    }
  }
  return undefined;
}

export async function loadOptionalCellAccelerator(
  loader?: () => Promise<CellAccelerator | undefined>,
): Promise<CellAccelerator> {
  try {
    return (
      (await (loader ? loader() : loadNativeCellAccelerator())) ??
      typescriptCellAccelerator
    );
  } catch {
    return typescriptCellAccelerator;
  }
}
