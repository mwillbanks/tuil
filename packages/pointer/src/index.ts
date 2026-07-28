import type { LayoutNode, LayoutProjection } from "@mwillbanks/tuil-renderer";

export type PointerButton =
  | "none"
  | "primary"
  | "middle"
  | "secondary"
  | "wheel";
export type PointerEventType =
  | "move"
  | "enter"
  | "leave"
  | "down"
  | "up"
  | "click"
  | "wheel"
  | "dragstart"
  | "drag"
  | "dragend";

export interface PointerModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
}

export interface ParsedPointerInput {
  readonly x: number;
  readonly y: number;
  readonly button: PointerButton;
  readonly pressed: boolean;
  readonly motion: boolean;
  readonly wheelX: number;
  readonly wheelY: number;
  readonly modifiers: PointerModifiers;
}

const sgrPattern = /^\[<(\d+);(\d+);(\d+)([Mm])$/;
const sgrPrefixPattern = /^\[<(\d+);(\d+);(\d+)([Mm])/;

function pointerButton(code: number): PointerButton {
  if ((code & 64) !== 0) return "wheel";
  return (
    (["primary", "middle", "secondary", "none"] as const)[code & 3] ?? "none"
  );
}

function pointerModifiers(code: number): PointerModifiers {
  return Object.freeze({
    shift: (code & 4) !== 0,
    alt: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
  });
}

function wheelOffset(code: number): readonly [number, number] {
  if ((code & 64) === 0) return [0, 0];
  const direction = (code & 1) === 0 ? -1 : 1;
  return (code & 128) !== 0 ? [direction, 0] : [0, direction];
}

export function parseSgrPointer(input: string): ParsedPointerInput | undefined {
  const sequence = input.startsWith("\u001b") ? input.slice(1) : input;
  const match = sgrPattern.exec(sequence);
  if (!match) return undefined;
  const code = Number(match[1]);
  const x = Number(match[2]) - 1;
  const y = Number(match[3]) - 1;
  if (x < 0 || y < 0) return undefined;
  const button = pointerButton(code);
  const [wheelX, wheelY] = wheelOffset(code);
  return Object.freeze({
    x,
    y,
    button,
    pressed: match[4] === "M" && button !== "wheel",
    motion: (code & 32) !== 0,
    wheelX,
    wheelY,
    modifiers: pointerModifiers(code),
  });
}

export interface DecodedPointerInput {
  readonly events: readonly ParsedPointerInput[];
  readonly passthrough: string;
}

function incompleteSgrStart(value: string): number {
  const start = value.lastIndexOf("\u001b[<");
  if (start < 0) return -1;
  const suffix = value.slice(start);
  return suffix.startsWith("\u001b") && /^\[<[0-9;]*$/u.test(suffix.slice(1))
    ? start
    : -1;
}

/**
 * Stateful decoder for terminal input streams. It extracts every complete SGR
 * pointer sequence while returning all keyboard/text bytes unchanged and
 * retaining only a genuinely incomplete pointer suffix for the next chunk.
 */
export class SgrPointerDecoder {
  #pending = "";

  push(chunk: string): DecodedPointerInput {
    const input = this.#pending + chunk;
    this.#pending = "";
    const events: ParsedPointerInput[] = [];
    let passthrough = "";
    let offset = 0;
    while (offset < input.length) {
      const markerIndex = input.indexOf("\u001b[<", offset);
      if (markerIndex < 0) {
        passthrough += input.slice(offset);
        break;
      }
      passthrough += input.slice(offset, markerIndex);
      const match = sgrPrefixPattern.exec(input.slice(markerIndex + 1));
      if (!match) {
        const incomplete = incompleteSgrStart(input.slice(markerIndex));
        if (incomplete === 0) {
          this.#pending = input.slice(markerIndex);
          break;
        }
        passthrough += input[markerIndex];
        offset = markerIndex + 1;
        continue;
      }
      const sequence = `\u001b${match[0]}`;
      const parsed = parseSgrPointer(sequence);
      if (parsed) events.push(parsed);
      else passthrough += sequence;
      offset = markerIndex + sequence.length;
    }
    return Object.freeze({
      events: Object.freeze(events),
      passthrough,
    });
  }

  flush(): string {
    const pending = this.#pending;
    this.#pending = "";
    return pending;
  }
}

export function pointerTracking(enabled: boolean): string {
  return enabled
    ? "\u001b[?1000h\u001b[?1002h\u001b[?1003h\u001b[?1006h"
    : "\u001b[?1006l\u001b[?1003l\u001b[?1002l\u001b[?1000l";
}

export interface PointerEventInit extends ParsedPointerInput {
  readonly type: PointerEventType;
  readonly targetId?: string;
  readonly currentTargetId?: string;
  readonly clickCount?: number;
  readonly captured?: boolean;
}

export class TuilPointerEvent {
  readonly type: PointerEventType;
  readonly x: number;
  readonly y: number;
  readonly button: PointerButton;
  readonly pressed: boolean;
  readonly motion: boolean;
  readonly wheelX: number;
  readonly wheelY: number;
  readonly modifiers: PointerModifiers;
  readonly targetId?: string;
  readonly currentTargetId?: string;
  readonly clickCount: number;
  readonly captured: boolean;
  #defaultPrevented = false;
  #propagationStopped = false;

  constructor(init: PointerEventInit) {
    Object.assign(this, init);
    this.type = init.type;
    this.x = init.x;
    this.y = init.y;
    this.button = init.button;
    this.pressed = init.pressed;
    this.motion = init.motion;
    this.wheelX = init.wheelX;
    this.wheelY = init.wheelY;
    this.modifiers = init.modifiers;
    this.targetId = init.targetId;
    this.currentTargetId = init.currentTargetId;
    this.clickCount = init.clickCount ?? 0;
    this.captured = init.captured ?? false;
  }

  get defaultPrevented(): boolean {
    return this.#defaultPrevented;
  }

  get propagationStopped(): boolean {
    return this.#propagationStopped;
  }

  preventDefault(): void {
    this.#defaultPrevented = true;
  }

  stopPropagation(): void {
    this.#propagationStopped = true;
  }
}

export type PointerListener = (event: TuilPointerEvent) => void;

interface PointerListenerSet {
  readonly capture: Set<PointerListener>;
  readonly bubble: Set<PointerListener>;
}

export interface PointerRouterOptions {
  readonly focus?: (id: string) => boolean | undefined;
  readonly now?: () => number;
  readonly clickIntervalMs?: number;
  readonly dragThreshold?: number;
}

export class PointerRouter {
  readonly #layout: LayoutProjection;
  readonly #listeners = new Map<
    string,
    Map<PointerEventType, PointerListenerSet>
  >();
  readonly #focus?: (id: string) => boolean | undefined;
  readonly #now: () => number;
  readonly #clickInterval: number;
  readonly #dragThreshold: number;
  #captureId?: string;
  #hoverId?: string;
  #pressedId?: string;
  #pressedAt?: { x: number; y: number };
  #dragging = false;
  #lastClick?: { id: string; button: PointerButton; at: number; count: number };

  constructor(layout: LayoutProjection, options: PointerRouterOptions = {}) {
    this.#layout = layout;
    this.#focus = options.focus;
    this.#now = options.now ?? Date.now;
    this.#clickInterval = options.clickIntervalMs ?? 400;
    this.#dragThreshold = options.dragThreshold ?? 1;
  }

  on(
    id: string,
    type: PointerEventType,
    listener: PointerListener,
    options: { readonly capture?: boolean } = {},
  ): () => void {
    const byType = this.#listeners.get(id) ?? new Map();
    const listeners = byType.get(type) ?? {
      capture: new Set(),
      bubble: new Set(),
    };
    (options.capture ? listeners.capture : listeners.bubble).add(listener);
    byType.set(type, listeners);
    this.#listeners.set(id, byType);
    return () => {
      listeners.capture.delete(listener);
      listeners.bubble.delete(listener);
    };
  }

  capture(id: string): void {
    if (!this.#layout.get(id))
      throw new Error(`Cannot capture unknown pointer node "${id}"`);
    this.#captureId = id;
  }

  releaseCapture(id?: string): void {
    if (!id || this.#captureId === id) this.#captureId = undefined;
  }

  dispatch(input: ParsedPointerInput): readonly TuilPointerEvent[] {
    const target = this.#target(input);
    const events: TuilPointerEvent[] = [];
    if (input.motion) this.#dispatchMotion(input, target, events);
    else if (input.wheelX !== 0 || input.wheelY !== 0) {
      events.push(...this.#emit("wheel", input, target));
    } else if (input.pressed) this.#dispatchPress(input, target, events);
    else this.#dispatchRelease(input, target, events);
    return Object.freeze(events);
  }

  #target(input: ParsedPointerInput): LayoutNode | undefined {
    return this.#captureId
      ? this.#layout.get(this.#captureId)
      : this.#layout.hitTest(input.x, input.y)[0];
  }

  #dispatchMotion(
    input: ParsedPointerInput,
    target: LayoutNode | undefined,
    events: TuilPointerEvent[],
  ): void {
    this.#updateHover(input, target, events);
    this.#updateDrag(input, events);
    events.push(...this.#emit("move", input, target));
  }

  #updateHover(
    input: ParsedPointerInput,
    target: LayoutNode | undefined,
    events: TuilPointerEvent[],
  ): void {
    if (this.#captureId || target?.id === this.#hoverId) return;
    if (this.#hoverId) {
      events.push(
        ...this.#emit("leave", input, this.#layout.get(this.#hoverId)),
      );
    }
    if (target) events.push(...this.#emit("enter", input, target));
    this.#hoverId = target?.id;
  }

  #updateDrag(input: ParsedPointerInput, events: TuilPointerEvent[]): void {
    if (!this.#pressedId || !this.#pressedAt) return;
    const distance =
      Math.abs(input.x - this.#pressedAt.x) +
      Math.abs(input.y - this.#pressedAt.y);
    if (!this.#dragging && distance >= this.#dragThreshold) {
      this.#dragging = true;
      this.#captureId = this.#pressedId;
      events.push(
        ...this.#emit("dragstart", input, this.#layout.get(this.#pressedId)),
      );
    }
    if (this.#dragging) {
      events.push(
        ...this.#emit("drag", input, this.#layout.get(this.#pressedId)),
      );
    }
  }

  #dispatchPress(
    input: ParsedPointerInput,
    target: LayoutNode | undefined,
    events: TuilPointerEvent[],
  ): void {
    this.#pressedId = target?.id;
    this.#pressedAt = { x: input.x, y: input.y };
    this.#dragging = false;
    if (target?.focusable) this.#focus?.(target.id);
    events.push(...this.#emit("down", input, target));
  }

  #dispatchRelease(
    input: ParsedPointerInput,
    target: LayoutNode | undefined,
    events: TuilPointerEvent[],
  ): void {
    events.push(...this.#emit("up", input, target));
    if (this.#dragging && this.#pressedId) {
      events.push(
        ...this.#emit("dragend", input, this.#layout.get(this.#pressedId)),
      );
    } else if (target?.id && target.id === this.#pressedId) {
      const count = this.#nextClickCount(target.id, input.button);
      events.push(...this.#emit("click", input, target, count));
    }
    this.#pressedId = undefined;
    this.#pressedAt = undefined;
    this.#dragging = false;
    this.#captureId = undefined;
  }

  #nextClickCount(id: string, button: PointerButton): number {
    const now = this.#now();
    const previous = this.#lastClick;
    const repeated =
      previous?.id === id &&
      previous.button === button &&
      now - previous.at <= this.#clickInterval;
    const count = repeated ? previous.count + 1 : 1;
    this.#lastClick = { id, button, at: now, count };
    return count;
  }

  #path(target: LayoutNode): readonly LayoutNode[] {
    const path = [target];
    let current = target;
    while (current.parentId) {
      const parent = this.#layout.get(current.parentId);
      if (!parent) break;
      path.unshift(parent);
      current = parent;
    }
    return path;
  }

  #emit(
    type: PointerEventType,
    input: ParsedPointerInput,
    target: LayoutNode | undefined,
    clickCount = 0,
  ): readonly TuilPointerEvent[] {
    if (!target) return [];
    const path = this.#path(target);
    const emitted: TuilPointerEvent[] = [];
    const invoke = (node: LayoutNode, capture: boolean): boolean => {
      const event = new TuilPointerEvent({
        ...input,
        type,
        targetId: target.id,
        currentTargetId: node.id,
        clickCount,
        captured: this.#captureId === target.id,
      });
      emitted.push(event);
      const set = this.#listeners.get(node.id)?.get(type);
      for (const listener of capture
        ? (set?.capture ?? [])
        : (set?.bubble ?? [])) {
        listener(event);
        if (event.propagationStopped) return false;
      }
      return true;
    };
    for (const node of path) if (!invoke(node, true)) return emitted;
    for (const node of [...path].reverse())
      if (!invoke(node, false)) return emitted;
    return emitted;
  }
}

export function semanticPointerFixture(
  type: PointerEventType,
  targetId: string,
  overrides: Partial<ParsedPointerInput> = {},
): TuilPointerEvent {
  return new TuilPointerEvent({
    type,
    targetId,
    currentTargetId: targetId,
    x: 0,
    y: 0,
    button: "primary",
    pressed: type === "down",
    motion: type === "move" || type.startsWith("drag"),
    wheelX: 0,
    wheelY: 0,
    modifiers: { shift: false, alt: false, ctrl: false },
    ...overrides,
  });
}
