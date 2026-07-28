export type ScrollAlignment = "start" | "center" | "end" | "nearest";
export type ScrollAxis = "vertical" | "horizontal";

export interface ScrollViewport {
  readonly width: number;
  readonly height: number;
}

export interface ScrollExtent {
  readonly width: number;
  readonly height: number;
}

export interface ScrollPosition {
  readonly x: number;
  readonly y: number;
}

export interface ScrollSnapshot {
  readonly id: string;
  readonly position: ScrollPosition;
  readonly viewport: ScrollViewport;
  readonly extent: ScrollExtent;
  readonly atTop: boolean;
  readonly atBottom: boolean;
  readonly atLeft: boolean;
  readonly atRight: boolean;
}

export interface ScrollAreaOptions {
  readonly id: string;
  readonly viewport: ScrollViewport;
  readonly extent: ScrollExtent;
  readonly parentId?: string;
  readonly sticky?: Partial<
    Record<"top" | "bottom" | "left" | "right", boolean>
  >;
  readonly followFocus?: boolean;
}

function integer(value: number, minimum = 0): number {
  return Math.max(
    minimum,
    Math.floor(Number.isFinite(value) ? value : minimum),
  );
}

function normalizeMeasurements(measurements: readonly number[]): number[] {
  return measurements.map((value) => {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("Scroll measurements must be finite and nonnegative");
    }
    return value;
  });
}

function visibleMeasurementInterval(
  sizes: readonly number[],
  offset: number,
  viewportSize: number,
): { start: number; end: number } {
  let cursor = 0;
  let start = 0;
  while (start < sizes.length && cursor + (sizes[start] ?? 0) <= offset) {
    cursor += sizes[start] ?? 0;
    start += 1;
  }
  let end = start;
  while (end < sizes.length && cursor < offset + viewportSize) {
    cursor += sizes[end] ?? 0;
    end += 1;
  }
  return { start, end };
}

export class ScrollAreaState {
  readonly id: string;
  readonly parentId?: string;
  readonly sticky: Readonly<
    Partial<Record<"top" | "bottom" | "left" | "right", boolean>>
  >;
  readonly followFocus: boolean;
  #viewport: ScrollViewport;
  #extent: ScrollExtent;
  #x = 0;
  #y = 0;
  readonly #observers = new Set<(snapshot: ScrollSnapshot) => void>();

  constructor(options: ScrollAreaOptions) {
    if (!options.id.trim()) throw new Error("Scroll area id cannot be empty");
    this.id = options.id;
    this.parentId = options.parentId;
    this.sticky = Object.freeze({ ...options.sticky });
    this.followFocus = options.followFocus ?? true;
    this.#viewport = this.#normalizeViewport(options.viewport);
    this.#extent = this.#normalizeExtent(options.extent);
    this.#clamp();
  }

  subscribe(observer: (snapshot: ScrollSnapshot) => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  snapshot(): ScrollSnapshot {
    const maximumX = this.#maxX();
    const maximumY = this.#maxY();
    return Object.freeze({
      id: this.id,
      position: Object.freeze({ x: this.#x, y: this.#y }),
      viewport: Object.freeze({ ...this.#viewport }),
      extent: Object.freeze({ ...this.#extent }),
      atTop: this.#y === 0,
      atBottom: this.#y === maximumY,
      atLeft: this.#x === 0,
      atRight: this.#x === maximumX,
    });
  }

  resize(viewport: ScrollViewport, extent = this.#extent): void {
    const before = this.snapshot();
    this.#viewport = this.#normalizeViewport(viewport);
    this.#extent = this.#normalizeExtent(extent);
    this.#finishExtentChange(before);
  }

  setExtent(
    extent: ScrollExtent,
    options: { readonly insertedBefore?: number } = {},
  ): void {
    const before = this.snapshot();
    this.#extent = this.#normalizeExtent(extent);
    if (options.insertedBefore && !(this.sticky.top && before.atTop)) {
      this.#y += integer(options.insertedBefore);
    }
    this.#finishExtentChange(before);
  }

  scrollTo(position: Partial<ScrollPosition>): ScrollSnapshot {
    if (position.x !== undefined) this.#x = integer(position.x);
    if (position.y !== undefined) this.#y = integer(position.y);
    this.#clamp();
    this.#notify();
    return this.snapshot();
  }

  move(
    direction:
      | "lineUp"
      | "lineDown"
      | "lineLeft"
      | "lineRight"
      | "pageUp"
      | "pageDown"
      | "pageLeft"
      | "pageRight"
      | "top"
      | "bottom"
      | "left"
      | "right",
    amount = 1,
  ): ScrollSnapshot {
    const step = integer(amount, 1);
    const lineDeltas = {
      lineUp: [0, -step],
      lineDown: [0, step],
      lineLeft: [-step, 0],
      lineRight: [step, 0],
      pageUp: [0, -this.#viewport.height * step],
      pageDown: [0, this.#viewport.height * step],
      pageLeft: [-this.#viewport.width * step, 0],
      pageRight: [this.#viewport.width * step, 0],
    } as const;
    const delta = lineDeltas[direction as keyof typeof lineDeltas];
    if (delta) [this.#x, this.#y] = [this.#x + delta[0], this.#y + delta[1]];
    else this.#moveToEdge(direction);
    this.#clamp();
    this.#notify();
    return this.snapshot();
  }

  wheel(deltaX: number, deltaY: number): ScrollSnapshot {
    return this.scrollTo({ x: this.#x + deltaX, y: this.#y + deltaY });
  }

  scrollIntoView(
    bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    alignment: ScrollAlignment = "nearest",
  ): ScrollSnapshot {
    const align = (
      start: number,
      size: number,
      offset: number,
      viewportSize: number,
    ): number => {
      if (alignment === "start") return start;
      if (alignment === "center")
        return start - Math.floor((viewportSize - size) / 2);
      if (alignment === "end") return start + size - viewportSize;
      if (start < offset) return start;
      if (start + size > offset + viewportSize)
        return start + size - viewportSize;
      return offset;
    };
    return this.scrollTo({
      x: align(bounds.x, bounds.width, this.#x, this.#viewport.width),
      y: align(bounds.y, bounds.height, this.#y, this.#viewport.height),
    });
  }

  visibleRange(
    axis: ScrollAxis,
    measurements: readonly number[],
    overscan = 0,
  ): {
    readonly start: number;
    readonly end: number;
    readonly before: number;
    readonly after: number;
  } {
    const sizes = normalizeMeasurements(measurements);
    const offset = axis === "vertical" ? this.#y : this.#x;
    const size =
      axis === "vertical" ? this.#viewport.height : this.#viewport.width;
    const { start, end } = visibleMeasurementInterval(sizes, offset, size);
    const safeOverscan = integer(overscan);
    const first = Math.max(0, start - safeOverscan);
    const last = Math.min(
      sizes.length - 1,
      Math.max(start, end - 1 + safeOverscan),
    );
    const before = sizes.slice(0, first).reduce((sum, value) => sum + value, 0);
    const included = sizes
      .slice(first, last + 1)
      .reduce((sum, value) => sum + value, 0);
    const total = sizes.reduce((sum, value) => sum + value, 0);
    return Object.freeze({
      start: first,
      end: last,
      before,
      after: Math.max(0, total - before - included),
    });
  }

  #finishExtentChange(before: ScrollSnapshot): void {
    if (this.sticky.top && before.atTop) this.#y = 0;
    if (this.sticky.bottom && before.atBottom) this.#y = this.#maxY();
    if (this.sticky.left && before.atLeft) this.#x = 0;
    if (this.sticky.right && before.atRight) this.#x = this.#maxX();
    this.#clamp();
    this.#notify();
  }

  #moveToEdge(direction: string): void {
    const positions: Readonly<Record<string, readonly [number, number]>> = {
      top: [this.#x, 0],
      bottom: [this.#x, this.#maxY()],
      left: [0, this.#y],
      right: [this.#maxX(), this.#y],
    };
    const position = positions[direction];
    if (position) [this.#x, this.#y] = position;
  }

  staticProjection(
    content: readonly string[],
    mode: "all" | "viewport" = "all",
  ): readonly string[] {
    if (mode === "all") return Object.freeze([...content]);
    return Object.freeze(
      content.slice(this.#y, this.#y + this.#viewport.height),
    );
  }

  #normalizeViewport(viewport: ScrollViewport): ScrollViewport {
    return Object.freeze({
      width: integer(viewport.width, 1),
      height: integer(viewport.height, 1),
    });
  }

  #normalizeExtent(extent: ScrollExtent): ScrollExtent {
    return Object.freeze({
      width: integer(extent.width),
      height: integer(extent.height),
    });
  }

  #maxX(): number {
    return Math.max(0, this.#extent.width - this.#viewport.width);
  }

  #maxY(): number {
    return Math.max(0, this.#extent.height - this.#viewport.height);
  }

  #clamp(): void {
    this.#x = Math.max(0, Math.min(this.#maxX(), this.#x));
    this.#y = Math.max(0, Math.min(this.#maxY(), this.#y));
  }

  #notify(): void {
    const snapshot = this.snapshot();
    for (const observer of this.#observers) observer(snapshot);
  }
}

export class ScrollManager {
  readonly #areas = new Map<string, ScrollAreaState>();
  readonly #restoration = new Map<string, ScrollPosition>();

  register(area: ScrollAreaState): () => void {
    if (this.#areas.has(area.id))
      throw new Error(`Scroll area "${area.id}" is already registered`);
    if (area.parentId && !this.#areas.has(area.parentId)) {
      throw new Error(
        `Parent scroll area "${area.parentId}" is not registered`,
      );
    }
    this.#areas.set(area.id, area);
    const restored = this.#restoration.get(area.id);
    if (restored) area.scrollTo(restored);
    return () => {
      this.#restoration.set(area.id, area.snapshot().position);
      this.#areas.delete(area.id);
    };
  }

  get(id: string): ScrollAreaState | undefined {
    return this.#areas.get(id);
  }

  routeWheel(
    id: string,
    deltaX: number,
    deltaY: number,
  ): ScrollSnapshot | undefined {
    let current = this.#areas.get(id);
    while (current) {
      const before = current.snapshot();
      const after = current.wheel(deltaX, deltaY);
      if (
        before.position.x !== after.position.x ||
        before.position.y !== after.position.y
      )
        return after;
      current = current.parentId
        ? this.#areas.get(current.parentId)
        : undefined;
    }
    return undefined;
  }

  focus(
    id: string,
    bounds: Parameters<ScrollAreaState["scrollIntoView"]>[0],
  ): ScrollSnapshot | undefined {
    const area = this.#areas.get(id);
    return area?.followFocus ? area.scrollIntoView(bounds) : area?.snapshot();
  }

  snapshots(): readonly ScrollSnapshot[] {
    return Object.freeze(
      [...this.#areas.values()].map((area) => area.snapshot()),
    );
  }
}

export function scrollbar(
  viewportSize: number,
  extentSize: number,
  offset: number,
): { readonly start: number; readonly size: number } {
  const viewport = integer(viewportSize, 1);
  const extent = Math.max(viewport, integer(extentSize, 1));
  const size = Math.max(1, Math.floor((viewport * viewport) / extent));
  const maximumOffset = Math.max(1, extent - viewport);
  const start = Math.min(
    viewport - size,
    Math.floor((integer(offset) / maximumOffset) * (viewport - size)),
  );
  return Object.freeze({ start, size });
}
