import { Virtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import sliceAnsi from "slice-ansi";
import stringWidth from "string-width";

export interface TerminalVirtualRange {
  readonly offset: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly indexes: readonly number[];
  readonly before: number;
  readonly after: number;
  readonly totalSize: number;
}

export interface TerminalVirtualizerOptions {
  readonly count: number;
  readonly viewportSize: number;
  readonly scrollOffset: number;
  readonly itemSize?: number;
  readonly overscan?: number;
}

export function getVisibleTerminalIndexes(
  range: TerminalVirtualRange,
): readonly number[] {
  if (range.endIndex < range.startIndex) return [];
  return Array.from(
    { length: range.endIndex - range.startIndex + 1 },
    (_value, index) => range.startIndex + index,
  );
}

interface NormalizedOptions {
  readonly count: number;
  readonly viewportSize: number;
  readonly scrollOffset: number;
  readonly itemSize: number;
  readonly overscan: number;
}

function normalizeOptions(
  options: TerminalVirtualizerOptions,
): NormalizedOptions {
  const count = Math.max(0, Math.floor(options.count));
  const viewportSize = Math.max(1, Math.floor(options.viewportSize));
  const itemSize = Math.max(1, Math.floor(options.itemSize ?? 1));
  const maximumOffset = Math.max(0, count * itemSize - viewportSize);
  return {
    count,
    viewportSize,
    scrollOffset: Math.min(
      maximumOffset,
      Math.max(0, Math.floor(options.scrollOffset)),
    ),
    itemSize,
    overscan: Math.max(0, Math.floor(options.overscan ?? 1)),
  };
}

type RectListener = (rect: {
  readonly width: number;
  readonly height: number;
}) => void;
type OffsetListener = (offset: number, isScrolling: boolean) => void;

/**
 * Adapts TanStack Virtual's measurement engine to terminal cells. The fake
 * scroll element is intentionally opaque: all measurement and scrolling enter
 * through the supplied terminal observers.
 */
export class TerminalVirtualizerAdapter {
  readonly #scrollElement = Object.freeze({});
  readonly #virtualizer: Virtualizer<never, never>;
  #options: NormalizedOptions;
  #rectListener?: RectListener;
  #offsetListener?: OffsetListener;
  #dispose: () => void;

  constructor(options: TerminalVirtualizerOptions) {
    this.#options = normalizeOptions(options);
    this.#virtualizer = new Virtualizer<never, never>(
      this.#virtualizerOptions(),
    );
    this.#dispose = this.#virtualizer._didMount();
    this.#virtualizer._willUpdate();
  }

  #virtualizerOptions() {
    return {
      count: this.#options.count,
      getScrollElement: () => this.#scrollElement as never,
      estimateSize: () => this.#options.itemSize,
      initialRect: {
        width: 1,
        height: this.#options.viewportSize,
      },
      initialOffset: this.#options.scrollOffset,
      overscan: this.#options.overscan,
      observeElementRect: (
        _instance: Virtualizer<never, never>,
        listener: RectListener,
      ) => {
        this.#rectListener = listener;
        listener({ width: 1, height: this.#options.viewportSize });
        return () => {
          if (this.#rectListener === listener) this.#rectListener = undefined;
        };
      },
      observeElementOffset: (
        _instance: Virtualizer<never, never>,
        listener: OffsetListener,
      ) => {
        this.#offsetListener = listener;
        listener(this.#options.scrollOffset, false);
        return () => {
          if (this.#offsetListener === listener) {
            this.#offsetListener = undefined;
          }
        };
      },
      scrollToFn: (offset: number) => {
        this.#offsetListener?.(offset, false);
      },
    };
  }

  measure(options: TerminalVirtualizerOptions): TerminalVirtualRange {
    this.#options = normalizeOptions(options);
    this.#virtualizer.setOptions(this.#virtualizerOptions());
    this.#rectListener?.({
      width: 1,
      height: this.#options.viewportSize,
    });
    this.#offsetListener?.(this.#options.scrollOffset, false);
    const range = this.#virtualizer.range;
    const indexes = Object.freeze(
      this.#virtualizer.getVirtualItems().map((item) => item.index),
    );
    const startIndex = range?.startIndex ?? 0;
    const endIndex = range?.endIndex ?? -1;
    const totalSize = this.#virtualizer.getTotalSize();
    return Object.freeze({
      offset: this.#options.scrollOffset,
      startIndex,
      endIndex,
      indexes,
      before: startIndex * this.#options.itemSize,
      after:
        endIndex < 0
          ? 0
          : Math.max(0, totalSize - (endIndex + 1) * this.#options.itemSize),
      totalSize,
    });
  }

  dispose(): void {
    this.#dispose();
    this.#dispose = () => {};
  }
}

export function useTerminalVirtualizer(
  options: TerminalVirtualizerOptions,
): TerminalVirtualRange {
  const adapter = useRef<TerminalVirtualizerAdapter>(undefined);
  if (!adapter.current) {
    adapter.current = new TerminalVirtualizerAdapter(options);
  }
  useEffect(
    () => () => {
      adapter.current?.dispose();
    },
    [],
  );
  return adapter.current.measure(options);
}

export function fitTerminalText(
  value: string,
  width: number,
  align: "left" | "center" | "right" = "left",
): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) return "";
  const ellipsis = safeWidth > 1 ? "…" : "";
  const fitted =
    stringWidth(value) > safeWidth
      ? `${sliceAnsi(value, 0, safeWidth - stringWidth(ellipsis))}${ellipsis}`
      : value;
  const remaining = Math.max(0, safeWidth - stringWidth(fitted));
  if (align === "right") return `${" ".repeat(remaining)}${fitted}`;
  if (align === "center") {
    const left = Math.floor(remaining / 2);
    return `${" ".repeat(left)}${fitted}${" ".repeat(remaining - left)}`;
  }
  return `${fitted}${" ".repeat(remaining)}`;
}
