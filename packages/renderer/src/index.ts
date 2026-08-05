import {
  escapeTerminalControlCharacters,
  hasTerminalControlCharacters,
  type RenderMode,
  type SemanticMetadata,
  type TerminalBounds,
  type TerminalCapabilities,
  type TerminalPlatform,
  terminalTextWidth,
  truncateTerminalText,
} from "@mwillbanks/tuil-core";
/*
 * Keep public renderer contracts on Web/Bun primitives. No Node stream,
 * Buffer, or process types cross this package boundary.
 */

export interface ClipRect extends TerminalBounds {}

export interface LayoutNode {
  readonly id: string;
  readonly parentId?: string;
  readonly children: readonly string[];
  readonly bounds: TerminalBounds;
  readonly clip: ClipRect;
  readonly zIndex: number;
  readonly focusable: boolean;
  readonly pointerEvents: "auto" | "none";
  readonly scrollContainerId?: string;
  readonly semantics: SemanticMetadata;
}

export type LayoutNodeInput = Omit<LayoutNode, "children"> & {
  readonly children?: readonly string[];
};

function intersects(left: TerminalBounds, right: TerminalBounds): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function validateLayoutNode(input: LayoutNodeInput): void {
  if (!input.id.trim()) throw new Error("Layout node id cannot be empty");
  if (input.bounds.width < 0 || input.bounds.height < 0) {
    throw new Error(`Layout node "${input.id}" has invalid bounds`);
  }
}

function freezeLayoutNode(
  input: LayoutNodeInput,
  children: readonly string[],
): LayoutNode {
  return Object.freeze({
    ...input,
    bounds: Object.freeze({ ...input.bounds }),
    clip: Object.freeze({ ...input.clip }),
    semantics: Object.freeze({ ...input.semantics }),
    children: Object.freeze([...new Set(children)]),
  });
}

export class LayoutProjection {
  readonly #nodes = new Map<string, LayoutNode>();
  #version = 0;

  get version(): number {
    return this.#version;
  }

  upsert(input: LayoutNodeInput): LayoutNode {
    validateLayoutNode(input);
    this.#assertParent(input.id, input.parentId);
    const previous = this.#nodes.get(input.id);
    const knownChildren = [...this.#nodes.values()].flatMap((candidate) =>
      candidate.parentId === input.id ? [candidate.id] : [],
    );
    const node = freezeLayoutNode(input, [
      ...(input.children ?? previous?.children ?? []),
      ...knownChildren,
    ]);
    this.#nodes.set(input.id, node);
    this.#reconcileParentage(input, previous);
    this.#version += 1;
    return node;
  }

  #reconcileParentage(
    input: LayoutNodeInput,
    previous: LayoutNode | undefined,
  ): void {
    if (previous?.parentId && previous.parentId !== input.parentId) {
      this.#setChildren(
        previous.parentId,
        this.#nodes
          .get(previous.parentId)
          ?.children.filter((id) => id !== input.id) ?? [],
      );
    }
    if (input.parentId) {
      const parent = this.#nodes.get(input.parentId);
      if (parent && !parent.children.includes(input.id)) {
        this.#setChildren(input.parentId, [...parent.children, input.id]);
      }
    }
  }

  reconcile(inputs: readonly LayoutNodeInput[]): readonly LayoutNode[] {
    this.#validateReconciliation(inputs);
    const nextIds = new Set(inputs.map((input) => input.id));
    for (const node of this.nodes()) {
      if (!nextIds.has(node.id)) this.remove(node.id);
    }
    return Object.freeze(inputs.map((input) => this.upsert(input)));
  }

  #validateReconciliation(inputs: readonly LayoutNodeInput[]): void {
    const parents = new Map<string, string | undefined>();
    for (const input of inputs) {
      validateLayoutNode(input);
      if (parents.has(input.id)) {
        throw new Error(`Layout node "${input.id}" is duplicated`);
      }
      parents.set(input.id, input.parentId);
    }
    for (const [id, parentId] of parents) {
      if (parentId && !parents.has(parentId)) {
        throw new Error(
          `Layout node "${id}" references missing parent "${parentId}"`,
        );
      }
      const visited = new Set([id]);
      let current = parentId;
      while (current) {
        if (visited.has(current)) {
          throw new Error(`Layout node "${id}" would create a parent cycle`);
        }
        visited.add(current);
        current = parents.get(current);
      }
    }
  }

  remove(id: string): void {
    const node = this.#nodes.get(id);
    if (!node) return;
    for (const childId of [...node.children]) this.remove(childId);
    this.#nodes.delete(id);
    if (node.parentId) {
      this.#setChildren(
        node.parentId,
        this.#nodes
          .get(node.parentId)
          ?.children.filter((childId) => childId !== id) ?? [],
      );
    }
    this.#version += 1;
  }

  get(id: string): LayoutNode | undefined {
    return this.#nodes.get(id);
  }

  nodes(): readonly LayoutNode[] {
    return Object.freeze(
      [...this.#nodes.values()].sort(
        (left, right) =>
          left.zIndex - right.zIndex || left.id.localeCompare(right.id),
      ),
    );
  }

  roots(): readonly LayoutNode[] {
    return Object.freeze(this.nodes().filter((node) => !node.parentId));
  }

  hitTest(x: number, y: number): readonly LayoutNode[] {
    return Object.freeze(
      this.nodes()
        .filter(
          (node) =>
            node.pointerEvents === "auto" &&
            intersects(node.bounds, node.clip) &&
            x >= Math.max(node.bounds.x, node.clip.x) &&
            y >= Math.max(node.bounds.y, node.clip.y) &&
            x <
              Math.min(
                node.bounds.x + node.bounds.width,
                node.clip.x + node.clip.width,
              ) &&
            y <
              Math.min(
                node.bounds.y + node.bounds.height,
                node.clip.y + node.clip.height,
              ),
        )
        .sort(
          (left, right) =>
            right.zIndex - left.zIndex || right.id.localeCompare(left.id),
        ),
    );
  }

  snapshot(): LayoutSnapshot {
    return Object.freeze({
      version: this.#version,
      nodes: this.nodes(),
    });
  }

  #setChildren(id: string, children: readonly string[]): void {
    const parent = this.#nodes.get(id);
    if (!parent) return;
    this.#nodes.set(
      id,
      Object.freeze({ ...parent, children: Object.freeze([...children]) }),
    );
  }

  #assertParent(id: string, parentId: string | undefined): void {
    if (!parentId) return;
    if (parentId === id) {
      throw new Error(`Layout node "${id}" cannot parent itself`);
    }
    const visited = new Set([id]);
    let current = this.#nodes.get(parentId);
    while (current) {
      if (visited.has(current.id)) {
        throw new Error(`Layout node "${id}" would create a parent cycle`);
      }
      visited.add(current.id);
      current = current.parentId
        ? this.#nodes.get(current.parentId)
        : undefined;
    }
  }
}

export interface LayoutSnapshot {
  readonly version: number;
  readonly nodes: readonly LayoutNode[];
}

export interface RendererFrame {
  readonly width: number;
  readonly height: number;
  readonly sequence: number;
  readonly timestamp: number;
  /**
   * The output mode used to produce this frame. Backends use the frame-owned
   * value during diffing so concurrent render calls cannot leak mode through
   * mutable backend state.
   */
  readonly mode?: RenderMode;
  readonly payload: unknown;
  readonly cursor?: {
    readonly x: number;
    readonly y: number;
    readonly visible: boolean;
    readonly shape?: "block" | "line" | "underline";
  };
}

export interface RendererOutput {
  readonly bytes: Uint8Array;
  /**
   * Whether `bytes` describes the complete owned surface or only changed
   * regions. Output sessions use this to repaint main-screen frames without
   * invalidating coordinate-based deltas.
   */
  readonly fullFrame?: boolean;
  readonly changedCells: number;
  readonly changedRows: readonly number[];
  readonly dirtyRects: readonly TerminalBounds[];
}

export interface RendererContext {
  readonly capabilities: TerminalCapabilities;
  readonly mode: RenderMode;
  readonly layout: LayoutProjection;
  readonly signal: AbortSignal;
}

export interface RendererScene {
  readonly lines: readonly string[];
  readonly styledLines?: readonly (readonly RendererTextRun[])[];
  readonly semantics?: readonly SemanticMetadata[];
  readonly cursor?: RendererFrame["cursor"];
}

export type RendererNamedColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "grey"
  | "bright-black"
  | "bright-red"
  | "bright-green"
  | "bright-yellow"
  | "bright-blue"
  | "bright-magenta"
  | "bright-cyan"
  | "bright-white";

export type ResolvedRendererColor =
  | { readonly kind: "default" }
  | { readonly kind: "indexed"; readonly value: number }
  | {
      readonly kind: "rgb";
      readonly red: number;
      readonly green: number;
      readonly blue: number;
    };

export type RendererColor = RendererNamedColor | ResolvedRendererColor;

const namedRendererColors: Readonly<Record<RendererNamedColor, number>> =
  Object.freeze({
    black: 0,
    red: 1,
    green: 2,
    yellow: 3,
    blue: 4,
    magenta: 5,
    cyan: 6,
    white: 7,
    gray: 8,
    grey: 8,
    "bright-black": 8,
    "bright-red": 9,
    "bright-green": 10,
    "bright-yellow": 11,
    "bright-blue": 12,
    "bright-magenta": 13,
    "bright-cyan": 14,
    "bright-white": 15,
  });

function assertColorChannel(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${label} must be an integer from 0 through 255`);
  }
}

export function resolveRendererColor(
  color: RendererColor,
): ResolvedRendererColor {
  if (typeof color === "string") {
    const index = namedRendererColors[color as RendererNamedColor];
    if (index === undefined) {
      throw new TypeError(`Unsupported renderer color "${color}"`);
    }
    return Object.freeze({ kind: "indexed", value: index });
  }
  switch (color.kind) {
    case "default":
      return Object.freeze({ kind: "default" });
    case "indexed":
      assertColorChannel(color.value, "Indexed renderer color");
      return Object.freeze({ kind: "indexed", value: color.value });
    case "rgb":
      assertColorChannel(color.red, "Renderer red channel");
      assertColorChannel(color.green, "Renderer green channel");
      assertColorChannel(color.blue, "Renderer blue channel");
      return Object.freeze({ ...color });
    default:
      throw new TypeError(
        `Unsupported renderer color kind "${String((color as { kind?: unknown }).kind)}"`,
      );
  }
}

export interface RendererTextStyle {
  readonly foreground?: RendererColor;
  readonly background?: RendererColor;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
  readonly strike?: boolean;
}

export interface RendererTextRun {
  readonly text: string;
  readonly style?: RendererTextStyle;
  readonly link?: string;
}

const safeHyperlinkProtocols = new Set(["file:", "http:", "https:", "mailto:"]);

/**
 * Validates a terminal hyperlink before either backend emits OSC 8. Unsafe
 * schemes are rejected even when hyperlinks are unavailable, while safe links
 * are omitted when the terminal cannot render them.
 */
export function normalizeRendererHyperlink(
  link: string | undefined,
  hyperlinks: boolean,
): string | undefined {
  if (link === undefined) return undefined;
  if (hasTerminalControlCharacters(link)) {
    throw new TypeError("Renderer links cannot contain terminal controls");
  }
  if (link.length > 4_096)
    throw new TypeError("Renderer links cannot exceed 4096 characters");
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    throw new TypeError("Renderer links must be absolute URLs");
  }
  if (!safeHyperlinkProtocols.has(parsed.protocol)) {
    throw new TypeError(
      `Renderer link scheme "${parsed.protocol || "unknown"}" is unsafe`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("Renderer links cannot contain credentials");
  }
  return hyperlinks ? link : undefined;
}

function validateRendererStyle(style: RendererTextStyle | undefined): void {
  if (style?.foreground !== undefined) resolveRendererColor(style.foreground);
  if (style?.background !== undefined) resolveRendererColor(style.background);
}

function normalizeStyledLine(
  line: string,
  runs: readonly RendererTextRun[],
  width: number,
  hyperlinks: boolean,
): readonly RendererTextRun[] {
  if (runs.map((run) => run.text).join("") !== line) {
    throw new TypeError(
      "Renderer styled line text must match its corresponding plain line",
    );
  }
  const normalized: RendererTextRun[] = [];
  let remaining = width;
  for (const run of runs) {
    validateRendererStyle(run.style);
    const link = normalizeRendererHyperlink(run.link, hyperlinks);
    const safe = escapeTerminalControlCharacters(run.text);
    const text = truncateTerminalText(safe, remaining);
    if (text) {
      normalized.push(
        Object.freeze({
          text,
          style: run.style ? Object.freeze({ ...run.style }) : undefined,
          link,
        }),
      );
      remaining -= terminalTextWidth(text);
    }
    if (remaining === 0) break;
  }
  return Object.freeze(normalized);
}

/**
 * Validates and clips the shared scene contract before a backend projects it.
 * This is the parity boundary: backends receive the same safe rows, styles,
 * links, semantics, and cursor geometry.
 */
export function normalizeRendererScene(
  scene: RendererScene,
  width: number,
  height: number,
  hyperlinks = true,
): RendererScene {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new RangeError("Renderer dimensions must be positive integers");
  }
  validateRendererCursor(scene.cursor, width, height);
  if (scene.styledLines && scene.styledLines.length > scene.lines.length) {
    throw new TypeError("Renderer styled lines cannot exceed plain lines");
  }
  const lines = scene.lines
    .slice(0, height)
    .map((line) =>
      truncateTerminalText(escapeTerminalControlCharacters(line), width),
    );
  const styledLines = scene.styledLines
    ? lines.map((_line, index) => {
        const sourceLine = scene.lines[index] ?? "";
        const runs = scene.styledLines?.[index];
        return runs
          ? normalizeStyledLine(sourceLine, runs, width, hyperlinks)
          : Object.freeze([
              Object.freeze({
                text: lines[index] ?? "",
              }),
            ]);
      })
    : undefined;
  return Object.freeze({
    lines: Object.freeze(lines),
    styledLines: styledLines ? Object.freeze(styledLines) : undefined,
    semantics: scene.semantics
      ? Object.freeze(scene.semantics.map((item) => Object.freeze({ ...item })))
      : undefined,
    cursor: scene.cursor ? Object.freeze({ ...scene.cursor }) : undefined,
  });
}

export interface RendererApplication {
  readonly kind: "tuil-renderer-application";
  project(context: RendererContext): RendererScene | Promise<RendererScene>;
  input?(input: string): void | Promise<void>;
  resize?(width: number, height: number): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface RendererComponentContext<TState extends object> {
  readonly state: Readonly<TState>;
  readonly renderer: RendererContext;
}

export type RendererComponent<TState extends object> = (
  context: RendererComponentContext<TState>,
) => RendererScene | Promise<RendererScene>;

export interface RendererComponentRuntimeOptions<TState extends object> {
  readonly initialState: TState;
  readonly component: RendererComponent<TState>;
  readonly input?: (
    state: Readonly<TState>,
    input: string,
  ) => TState | undefined | Promise<TState | undefined>;
  readonly resize?: (
    state: Readonly<TState>,
    width: number,
    height: number,
  ) => TState | undefined | Promise<TState | undefined>;
  readonly dispose?: (state: Readonly<TState>) => void | Promise<void>;
}

export interface RendererComponentRuntime<TState extends object>
  extends RendererApplication {
  snapshot(): Readonly<TState>;
  update(
    update: TState | ((state: Readonly<TState>) => TState),
  ): Readonly<TState>;
}

/**
 * Creates the renderer-neutral state and behavior boundary used by both Ink
 * and cell backends. Components project the same scene and semantic/layout
 * contracts regardless of the selected output backend.
 */
export function createRendererComponentRuntime<TState extends object>(
  options: RendererComponentRuntimeOptions<TState>,
): RendererComponentRuntime<TState> {
  let state = Object.freeze({ ...options.initialState }) as Readonly<TState>;
  const replace = (next: TState | undefined): void => {
    if (next !== undefined) {
      state = Object.freeze({ ...next }) as Readonly<TState>;
    }
  };
  return Object.freeze({
    kind: "tuil-renderer-application" as const,
    project: (renderer: RendererContext) =>
      options.component({ state, renderer }),
    async input(value: string) {
      replace(await options.input?.(state, value));
    },
    async resize(width: number, height: number) {
      replace(await options.resize?.(state, width, height));
    },
    dispose: () => options.dispose?.(state),
    snapshot: () => state,
    update(update: TState | ((value: Readonly<TState>) => TState)) {
      const next =
        typeof update === "function"
          ? (update as (value: Readonly<TState>) => TState)(state)
          : update;
      replace(next);
      return state;
    },
  });
}

export function defineRendererApplication(
  application: Omit<RendererApplication, "kind">,
): RendererApplication {
  return Object.freeze({
    kind: "tuil-renderer-application" as const,
    ...application,
  });
}

export function isRendererApplication(
  value: unknown,
): value is RendererApplication {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as RendererApplication).kind === "tuil-renderer-application" &&
    typeof (value as RendererApplication).project === "function"
  );
}

export interface RendererBackend<TTree = unknown> {
  readonly id: string;
  readonly capabilities: ReadonlySet<RendererCapability>;
  render(
    tree: TTree,
    context: RendererContext,
  ): RendererFrame | Promise<RendererFrame>;
  diff(
    previous: RendererFrame | undefined,
    current: RendererFrame,
  ): RendererOutput;
  dispose?(): void | Promise<void>;
}

export type RendererCapability =
  | "cells"
  | "ink"
  | "renderer-application"
  | "react-ink-components"
  | "pointer"
  | "scroll"
  | "clipboard"
  | "alternate-screen"
  | "inline"
  | "static"
  | "json"
  | "silent"
  | "embedded";

export class RendererRegistry {
  readonly #backends = new Map<string, RendererBackend>();
  #defaultId?: string;

  register(
    backend: RendererBackend,
    options: { readonly default?: boolean; readonly replace?: boolean } = {},
  ): () => void {
    if (!backend.id.trim()) throw new Error("Renderer id cannot be empty");
    if (this.#backends.has(backend.id) && !options.replace) {
      throw new Error(`Renderer "${backend.id}" is already registered`);
    }
    this.#backends.set(backend.id, backend);
    if (options.default || !this.#defaultId) this.#defaultId = backend.id;
    return () => {
      if (this.#backends.get(backend.id) !== backend) return;
      this.#backends.delete(backend.id);
      if (this.#defaultId === backend.id) {
        this.#defaultId = this.#backends.keys().next().value;
      }
    };
  }

  resolve(id = this.#defaultId): RendererBackend {
    const backend = id ? this.#backends.get(id) : undefined;
    if (!backend)
      throw new Error(`Renderer "${id ?? "default"}" is not registered`);
    return backend;
  }

  list(): readonly RendererBackend[] {
    return Object.freeze([...this.#backends.values()]);
  }
}

export interface FrameClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}

export function validateRendererCursor(
  cursor: RendererFrame["cursor"] | undefined,
  width: number,
  height: number,
): void {
  if (!cursor) return;
  if (
    !Number.isSafeInteger(cursor.x) ||
    !Number.isSafeInteger(cursor.y) ||
    cursor.x < 0 ||
    cursor.y < 0 ||
    cursor.x >= width ||
    cursor.y >= height
  ) {
    throw new RangeError(
      `Cursor (${cursor.x}, ${cursor.y}) is outside ${width}x${height}`,
    );
  }
}

const systemClock: FrameClock = {
  now: () => performance.now(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

export interface FrameStatistics {
  readonly requested: number;
  readonly rendered: number;
  readonly cancelled: number;
  readonly dropped: number;
  readonly lastDurationMs: number;
  readonly averageDurationMs: number;
  readonly idle: boolean;
}

export class FrameScheduler {
  readonly #clock: FrameClock;
  readonly #render: (signal: AbortSignal) => void | Promise<void>;
  readonly #onError: (error: unknown) => void | Promise<void>;
  readonly #targetInterval: number;
  readonly #maximumInterval: number;
  #cancelTimer?: () => void;
  #active?: AbortController;
  #pending = false;
  #requested = 0;
  #rendered = 0;
  #cancelled = 0;
  #dropped = 0;
  #lastDuration = 0;
  #totalDuration = 0;
  #lastFrameAt = Number.NEGATIVE_INFINITY;

  constructor(
    render: (signal: AbortSignal) => void | Promise<void>,
    options: {
      readonly targetFps?: number;
      readonly maximumFps?: number;
      readonly clock?: FrameClock;
      readonly onError?: (error: unknown) => void | Promise<void>;
    } = {},
  ) {
    this.#render = render;
    this.#onError = options.onError ?? (() => {});
    this.#clock = options.clock ?? systemClock;
    const targetFps = options.targetFps ?? 60;
    const maximumFps = options.maximumFps ?? targetFps;
    if (targetFps <= 0 || maximumFps <= 0 || maximumFps < targetFps) {
      throw new Error(
        "Frame rates must be positive and maximumFps >= targetFps",
      );
    }
    this.#targetInterval = 1000 / targetFps;
    this.#maximumInterval = 1000 / maximumFps;
  }

  request(): void {
    this.#requested += 1;
    if (this.#pending) {
      this.#dropped += 1;
      return;
    }
    this.#pending = true;
    if (this.#active) {
      this.#dropped += 1;
      return;
    }
    this.#schedule();
  }

  #schedule(): void {
    const delay = Math.max(
      0,
      this.#lastFrameAt +
        Math.max(this.#targetInterval, this.#maximumInterval) -
        this.#clock.now(),
    );
    this.#cancelTimer = this.#clock.schedule(() => {
      this.#cancelTimer = undefined;
      void this.#step();
    }, delay);
  }

  cancel(reason: unknown = new Error("Frame cancelled")): void {
    if (this.#cancelTimer) {
      this.#cancelTimer();
      this.#cancelTimer = undefined;
      this.#pending = false;
      this.#cancelled += 1;
    }
    if (this.#active) {
      this.#active.abort(reason);
      this.#cancelled += 1;
    }
  }

  statistics(): FrameStatistics {
    return Object.freeze({
      requested: this.#requested,
      rendered: this.#rendered,
      cancelled: this.#cancelled,
      dropped: this.#dropped,
      lastDurationMs: this.#lastDuration,
      averageDurationMs:
        this.#rendered === 0 ? 0 : this.#totalDuration / this.#rendered,
      idle: !this.#pending && !this.#active,
    });
  }

  async #step(): Promise<void> {
    if (!this.#pending || this.#active) return;
    this.#pending = false;
    const controller = new AbortController();
    this.#active = controller;
    const started = this.#clock.now();
    try {
      await this.#render(controller.signal);
      if (!controller.signal.aborted) {
        this.#lastDuration = this.#clock.now() - started;
        this.#totalDuration += this.#lastDuration;
        this.#rendered += 1;
        this.#lastFrameAt = this.#clock.now();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        try {
          await this.#onError(error);
        } catch {
          // Error observers are an isolation boundary. The renderer owner keeps
          // the original failure and exposes it through its lifecycle contract.
        }
      }
    } finally {
      this.#active = undefined;
      if (this.#pending) this.#schedule();
    }
  }
}

export type ScreenOwnership =
  | "alternate"
  | "main"
  | "inline"
  | "split-footer"
  | "embedded";

export interface OutputTarget {
  write(data: string | Uint8Array): boolean | Promise<boolean>;
  drain?(): void | Promise<void>;
  flush?(): void | Promise<void>;
}

export interface TerminalOutputSessionOptions {
  readonly rows?: number;
  readonly splitFooterRows?: number;
  readonly inlineRows?: number;
  /**
   * `capture` keeps bytes in memory, `passthrough` writes only to the target,
   * and `tee` does both. This applies only to embedded ownership.
   */
  readonly embeddedOutput?: "capture" | "passthrough" | "tee";
  /** Maximum retained bytes for capture and tee modes. */
  readonly embeddedCaptureLimitBytes?: number;
  /** @deprecated Use `embeddedOutput`. */
  readonly embeddedPassthrough?: boolean;
}

function positiveRowCount(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Terminal row counts must be positive integers");
  }
  return value;
}

function positiveByteCount(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Capture limits must be positive integers");
  }
  return value;
}

export interface EmbeddedCaptureSnapshot {
  readonly bytes: Uint8Array;
  readonly limitBytes: number;
  readonly droppedBytes: number;
  readonly truncated: boolean;
}

const defaultEmbeddedCaptureLimitBytes = 1_048_576;

function inlineCoordinate(
  value: string | undefined,
  label: "column" | "row",
  maximum?: number,
): number {
  const coordinate = Number(value || 1);
  if (
    !Number.isSafeInteger(coordinate) ||
    coordinate < 1 ||
    (maximum !== undefined && coordinate > maximum)
  ) {
    const boundary =
      maximum === undefined ? "its surface" : `its ${maximum}-row surface`;
    throw new RangeError(
      `Inline cursor ${label} ${coordinate} escapes ${boundary}`,
    );
  }
  return coordinate;
}

function inlineRelativeOutput(
  bytes: Uint8Array,
  ownedRows: number,
): Uint8Array {
  const source = new TextDecoder().decode(bytes);
  let found = false;
  const output = source.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CUP is the renderer output grammar.
    /\u001b\[(\d*)(?:;(\d*))?[Hf]/gu,
    (_sequence, rowValue: string, columnValue: string | undefined) => {
      found = true;
      const row = inlineCoordinate(rowValue, "row", ownedRows);
      const column = inlineCoordinate(columnValue, "column");
      const vertical = row > 1 ? `\u001b[${row - 1}B` : "";
      const horizontal = column > 1 ? `\u001b[${column - 1}C` : "";
      return `\u001b8${vertical}${horizontal}`;
    },
  );
  return found ? new TextEncoder().encode(output) : bytes;
}

export class TerminalOutputSession {
  readonly #target: OutputTarget;
  readonly #rows: number;
  readonly #ownedRows: number;
  readonly #embeddedOutput: "capture" | "passthrough" | "tee";
  readonly #captureLimitBytes: number;
  readonly #captureBuffer?: Uint8Array;
  readonly ownership: ScreenOwnership;
  #entered = false;
  #closed = false;
  #lastFrame?: Uint8Array;
  #capturedBytes = 0;
  #droppedBytes = 0;

  constructor(
    target: OutputTarget,
    ownership: ScreenOwnership,
    options: TerminalOutputSessionOptions = {},
  ) {
    this.#target = target;
    this.ownership = ownership;
    this.#rows = positiveRowCount(options.rows, 24);
    const requestedOwnedRows =
      ownership === "split-footer"
        ? positiveRowCount(options.splitFooterRows, 4)
        : positiveRowCount(options.inlineRows, 1);
    this.#ownedRows = Math.min(requestedOwnedRows, this.#rows);
    this.#embeddedOutput =
      options.embeddedOutput ??
      (options.embeddedPassthrough === false
        ? "capture"
        : options.embeddedPassthrough === true
          ? "tee"
          : "passthrough");
    this.#captureLimitBytes = positiveByteCount(
      options.embeddedCaptureLimitBytes,
      defaultEmbeddedCaptureLimitBytes,
    );
    if (ownership === "embedded" && this.#embeddedOutput !== "passthrough") {
      this.#captureBuffer = new Uint8Array(this.#captureLimitBytes);
    }
  }

  get viewportHeight(): number {
    return this.ownership === "split-footer" || this.ownership === "inline"
      ? this.#ownedRows
      : this.#rows;
  }

  capturedOutput(): Uint8Array {
    return this.captureSnapshot().bytes;
  }

  captureSnapshot(): EmbeddedCaptureSnapshot {
    return Object.freeze({
      bytes:
        this.#captureBuffer?.slice(0, this.#capturedBytes) ?? new Uint8Array(),
      limitBytes: this.#captureLimitBytes,
      droppedBytes: this.#droppedBytes,
      truncated: this.#droppedBytes > 0,
    });
  }

  async enter(): Promise<void> {
    if (this.#closed) throw new Error("Output session is closed");
    if (this.#entered) return;
    if (this.ownership === "alternate") {
      await this.#write("\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l");
    } else if (this.ownership === "split-footer") {
      const footerStart = this.#rows - this.#ownedRows + 1;
      await this.#write(
        `\u001b[?25l\u001b[${footerStart};${this.#rows}r\u001b[?6h\u001b[H`,
      );
    } else if (this.ownership === "inline") {
      await this.#write("\u001b7\u001b[?25l");
    } else if (this.ownership === "main") {
      await this.#write("\u001b[?25l");
    }
    this.#entered = true;
  }

  async flush(
    output: RendererOutput,
    repaint: RendererOutput = output,
  ): Promise<void> {
    if (!this.#entered) await this.enter();
    if (this.ownership === "inline") await this.#write("\u001b8");
    await this.#write(this.#prepareOutput(output));
    this.#lastFrame = this.#prepareOutput(repaint).slice();
    await this.#target.flush?.();
  }

  async commitScrollback(content: string): Promise<void> {
    if (!this.#entered) await this.enter();
    const safeContent = content
      .split("\n")
      .map(escapeTerminalControlCharacters)
      .join("\n");
    const line = safeContent.endsWith("\n") ? safeContent : `${safeContent}\n`;
    if (this.ownership === "alternate") {
      await this.#write("\u001b[?1049l\u001b[?25h");
      await this.#write(line);
      await this.#write("\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l");
      await this.#repaint();
      return;
    }
    if (this.ownership === "main") {
      await this.#write("\u001b7\u001b[?25h\u001b[999;1H");
      await this.#write(line);
      await this.#write("\u001b8\u001b[?25l");
      await this.#repaint();
      return;
    }
    if (this.ownership === "split-footer") {
      const footerStart = this.#rows - this.#ownedRows + 1;
      const scrollbackEnd = Math.max(1, footerStart - 1);
      await this.#write(
        `\u001b[?6l\u001b[1;${scrollbackEnd}r\u001b[${scrollbackEnd};1H`,
      );
      await this.#write(line);
      await this.#write(
        `\u001b[${footerStart};${this.#rows}r\u001b[?6h\u001b[H`,
      );
      await this.#repaint();
      return;
    }
    if (this.ownership === "inline") {
      await this.#write(`\u001b8${this.#eraseOwnedLines()}\u001b[?25h`);
      await this.#write(line);
      await this.#write("\u001b7\u001b[?25l");
      await this.#repaint();
      return;
    }
    await this.#write(line);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#entered) {
      if (this.ownership === "alternate") {
        await this.#write("\u001b[?25h\u001b[?1049l");
      } else if (this.ownership === "split-footer") {
        await this.#write("\u001b[?6l\u001b[r\u001b[?25h");
      } else if (this.ownership === "inline") {
        await this.#write(`\u001b8${this.#eraseOwnedLines()}\u001b[?25h`);
      } else if (this.ownership === "main") {
        await this.#write("\u001b[?25h");
      }
    }
    this.#closed = true;
    await this.#target.flush?.();
  }

  async #write(data: string | Uint8Array): Promise<void> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data.slice();
    if (
      this.ownership === "embedded" &&
      this.#embeddedOutput !== "passthrough"
    ) {
      this.#capture(bytes);
    }
    if (this.ownership === "embedded" && this.#embeddedOutput === "capture")
      return;
    const accepted = await this.#target.write(data);
    if (!accepted) {
      if (!this.#target.drain) {
        throw new Error(
          "Terminal output backpressure requires a drain contract",
        );
      }
      await this.#target.drain();
    }
  }

  #prepareOutput(output: RendererOutput): Uint8Array {
    const bytes =
      this.ownership === "inline"
        ? inlineRelativeOutput(output.bytes, this.#ownedRows)
        : output.bytes;
    if (this.ownership !== "main" || !output.fullFrame || bytes.length === 0) {
      return bytes;
    }
    const prefix = new TextEncoder().encode("\u001b[H\u001b[2J\u001b[H");
    const prepared = new Uint8Array(prefix.length + bytes.length);
    prepared.set(prefix);
    prepared.set(bytes, prefix.length);
    return prepared;
  }

  #capture(bytes: Uint8Array): void {
    const available = this.#captureLimitBytes - this.#capturedBytes;
    const retainedBytes = Math.min(bytes.length, Math.max(0, available));
    if (retainedBytes > 0 && this.#captureBuffer) {
      this.#captureBuffer.set(
        bytes.subarray(0, retainedBytes),
        this.#capturedBytes,
      );
      this.#capturedBytes += retainedBytes;
    }
    this.#droppedBytes += bytes.length - retainedBytes;
  }

  async #repaint(): Promise<void> {
    if (this.#lastFrame?.length) await this.#write(this.#lastFrame);
    await this.#target.flush?.();
  }

  #eraseOwnedLines(): string {
    let output = "\u001b[2K";
    for (let row = 1; row < this.#ownedRows; row += 1) {
      output += "\u001b[1B\u001b[2K";
    }
    if (this.#ownedRows > 1) output += `\u001b[${this.#ownedRows - 1}A`;
    return `${output}\r`;
  }
}

export interface RendererDriverFrame {
  readonly renderer: string;
  readonly durationMs: number;
  readonly frame: RendererFrame;
  readonly output: RendererOutput;
  readonly timestamp: number;
}

export interface RendererApplicationDriverOptions {
  readonly application: RendererApplication;
  readonly backend: RendererBackend<RendererScene>;
  readonly session: TerminalOutputSession;
  readonly context: (signal: AbortSignal) => RendererContext;
  readonly paused?: () => boolean;
  readonly onFrame?: (frame: RendererDriverFrame) => void | Promise<void>;
}

/**
 * Owns renderer-independent application projection, state transitions, backend
 * rendering, diffing, output, and cleanup. UI adapters may produce a
 * RendererApplication, but backends never own application state or input.
 */
export class RendererApplicationDriver {
  readonly #options: RendererApplicationDriverOptions;
  #previous?: RendererFrame;
  #disposed = false;

  constructor(options: RendererApplicationDriverOptions) {
    this.#options = options;
  }

  draw = async (signal: AbortSignal): Promise<void> => {
    this.#assertActive();
    if (this.#options.paused?.()) return;
    const started = performance.now();
    const context = this.#options.context(signal);
    const scene = await this.#options.application.project(context);
    if (signal.aborted) throw signal.reason;
    const frame = await this.#options.backend.render(scene, context);
    if (signal.aborted) throw signal.reason;
    const output = this.#options.backend.diff(this.#previous, frame);
    const repaint = this.#options.backend.diff(undefined, frame);
    await this.#options.session.flush(output, repaint);
    this.#previous = frame;
    const timestamp = performance.now();
    await this.#options.onFrame?.(
      Object.freeze({
        renderer: this.#options.backend.id,
        durationMs: timestamp - started,
        frame,
        output,
        timestamp,
      }),
    );
  };

  async input(value: string): Promise<void> {
    this.#assertActive();
    await this.#options.application.input?.(value);
  }

  async resize(width: number, height: number): Promise<void> {
    this.#assertActive();
    await this.#options.application.resize?.(width, height);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const failures: unknown[] = [];
    for (const cleanup of [
      () => this.#options.session.close(),
      () => this.#options.backend.dispose?.(),
      () => this.#options.application.dispose?.(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Renderer driver cleanup failed");
    }
  }

  #assertActive(): void {
    if (this.#disposed)
      throw new Error("Renderer application driver is closed");
  }
}

export interface TerminalControlAdapter {
  readClipboard?(): Promise<string | undefined>;
  writeClipboard?(value: string): Promise<void>;
  notify?(title: string, body?: string): Promise<void>;
  suspend?(): Promise<void>;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0),
  );
}

export function osc52Write(value: string): string {
  return `\u001b]52;c;${encodeBase64(value)}\u0007`;
}

export function parseOsc52Response(input: string): string | undefined {
  const prefix = "\u001b]52;";
  const start = input.indexOf(prefix);
  if (start < 0) return undefined;
  const payloadStart = input.indexOf(";", start + prefix.length);
  if (payloadStart < 0) return undefined;
  const belEnd = input.indexOf("\u0007", payloadStart + 1);
  const stringEnd = input.indexOf("\u001b\\", payloadStart + 1);
  const end =
    belEnd < 0
      ? stringEnd
      : stringEnd < 0
        ? belEnd
        : Math.min(belEnd, stringEnd);
  if (end < 0) return undefined;
  const payload = input.slice(payloadStart + 1, end);
  if (!/^[A-Za-z0-9+/=]*$/.test(payload)) return undefined;
  try {
    return decodeBase64(payload);
  } catch {
    return undefined;
  }
}

function sanitizeOsc(value: string): string {
  return value.replaceAll("\u0007", "").replaceAll("\u001b", "");
}

export function terminalTitle(title: string): string {
  return `\u001b]0;${sanitizeOsc(title)}\u0007`;
}

export function terminalNotification(title: string, body = ""): string {
  return `\u001b]777;notify;${sanitizeOsc(title)};${sanitizeOsc(body)}\u0007`;
}

export function bracketedPaste(enabled: boolean): string {
  return enabled ? "\u001b[?2004h" : "\u001b[?2004l";
}

export function focusReporting(enabled: boolean): string {
  return enabled ? "\u001b[?1004h" : "\u001b[?1004l";
}

export function kittyKeyboard(enabled: boolean): string {
  return enabled ? "\u001b[>1u" : "\u001b[<u";
}

export function terminalInputModes(
  capabilities: TerminalCapabilities,
  enabled: boolean,
): string {
  const sequences: string[] = [];
  if (capabilities.bracketedPaste) sequences.push(bracketedPaste(enabled));
  if (capabilities.focusReporting) sequences.push(focusReporting(enabled));
  if (capabilities.kittyKeyboard) sequences.push(kittyKeyboard(enabled));
  return sequences.join("");
}

export interface PlatformClipboardCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly input?: string;
}

export type PlatformClipboardExecutor = (
  command: PlatformClipboardCommand,
) => Promise<string>;

export function createPlatformClipboardAdapter(
  platform: TerminalPlatform,
  execute: PlatformClipboardExecutor,
): Required<Pick<TerminalControlAdapter, "readClipboard" | "writeClipboard">> {
  const readCommand: PlatformClipboardCommand =
    platform === "darwin"
      ? { command: "pbpaste", args: [] }
      : platform === "win32"
        ? {
            command: "powershell",
            args: ["-NoProfile", "-Command", "Get-Clipboard"],
          }
        : { command: "xclip", args: ["-selection", "clipboard", "-o"] };
  const write = (value: string): PlatformClipboardCommand =>
    platform === "darwin"
      ? { command: "pbcopy", args: [], input: value }
      : platform === "win32"
        ? {
            command: "powershell",
            args: ["-NoProfile", "-Command", "Set-Clipboard"],
            input: value,
          }
        : {
            command: "xclip",
            args: ["-selection", "clipboard", "-i"],
            input: value,
          };
  return Object.freeze({
    readClipboard: () => execute(readCommand),
    async writeClipboard(value: string) {
      await execute(write(value));
    },
  });
}

export interface TerminalCapabilityDiagnostic {
  readonly capability: string;
  readonly supported: boolean;
  readonly reason: string;
}

export function terminalCapabilityDiagnostics(
  capabilities: TerminalCapabilities,
): readonly TerminalCapabilityDiagnostic[] {
  const values: readonly [string, boolean, string][] = [
    [
      "alternate-screen",
      capabilities.alternateScreen,
      capabilities.alternateScreen ? "TTY terminal" : "static/main output",
    ],
    [
      "pointer",
      capabilities.mouse,
      capabilities.mouse ? "SGR tracking enabled" : "keyboard fallback",
    ],
    [
      "bracketed-paste",
      capabilities.bracketedPaste ?? capabilities.tty,
      capabilities.tty ? "interactive terminal" : "plain input fallback",
    ],
    [
      "osc52-clipboard",
      capabilities.clipboard === "osc52",
      capabilities.clipboard ?? "not detected",
    ],
    [
      "focus-reporting",
      capabilities.focusReporting ?? false,
      capabilities.focusReporting
        ? "terminal mode available"
        : "internal focus",
    ],
    [
      "kitty-keyboard",
      capabilities.kittyKeyboard ?? false,
      capabilities.kittyKeyboard ? "kitty protocol detected" : "legacy keys",
    ],
    [
      "notifications",
      capabilities.notifications ?? false,
      capabilities.notifications ? "terminal OSC notifications" : "disabled",
    ],
  ];
  return Object.freeze(
    values.map(([capability, supported, reason]) =>
      Object.freeze({ capability, supported, reason }),
    ),
  );
}

export interface RendererConformanceFixture<TTree = unknown> {
  readonly id: string;
  readonly tree: TTree;
  readonly assertFrame: (frame: RendererFrame) => void;
}

export interface RendererConformanceResult {
  readonly backendId: string;
  readonly fixtures: readonly string[];
  readonly capabilities: readonly RendererCapability[];
}

export async function runRendererConformance<TTree>(
  backend: RendererBackend<TTree>,
  fixtures: readonly RendererConformanceFixture<TTree>[],
  context: RendererContext,
): Promise<RendererConformanceResult> {
  let previous: RendererFrame | undefined;
  for (const fixture of fixtures) {
    if (context.signal.aborted) throw context.signal.reason;
    const current = await backend.render(fixture.tree, context);
    if (
      current.width !== context.capabilities.width ||
      current.height !== context.capabilities.height
    ) {
      throw new Error(
        `Renderer "${backend.id}" violated viewport conformance for "${fixture.id}"`,
      );
    }
    fixture.assertFrame(current);
    backend.diff(previous, current);
    previous = current;
  }
  return Object.freeze({
    backendId: backend.id,
    fixtures: Object.freeze(fixtures.map((fixture) => fixture.id)),
    capabilities: Object.freeze([...backend.capabilities]),
  });
}
