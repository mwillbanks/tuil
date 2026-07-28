import { useApp } from "@mwillbanks/tuil";
import {
  ScrollAreaState,
  type ScrollExtent,
  type ScrollSnapshot,
  type ScrollViewport,
} from "@mwillbanks/tuil-scroll";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePointerEvent } from "./pointer.ts";

export interface TerminalScrollAreaOptions {
  readonly id: string;
  readonly viewport: ScrollViewport;
  readonly extent: ScrollExtent;
  readonly parentId?: string;
  readonly sticky?: Partial<
    Record<"top" | "bottom" | "left" | "right", boolean>
  >;
  readonly followFocus?: boolean;
  readonly enabled?: boolean;
  readonly initialPosition?: {
    readonly x?: number;
    readonly y?: number;
  };
}

export function useTerminalScrollArea(options: TerminalScrollAreaOptions): {
  readonly state: ScrollAreaState;
  readonly snapshot: ScrollSnapshot;
} {
  const app = useApp();
  const stickyTop = options.sticky?.top;
  const stickyBottom = options.sticky?.bottom;
  const stickyLeft = options.sticky?.left;
  const stickyRight = options.sticky?.right;
  const viewportWidth = options.viewport.width;
  const viewportHeight = options.viewport.height;
  const extentWidth = options.extent.width;
  const extentHeight = options.extent.height;
  const [initialViewport] = useState(options.viewport);
  const [initialExtent] = useState(options.extent);
  const [initialPosition] = useState(options.initialPosition);
  const state = useMemo(() => {
    const area = new ScrollAreaState({
      id: options.id,
      viewport: initialViewport,
      extent: initialExtent,
      parentId: options.parentId,
      sticky: {
        top: stickyTop,
        bottom: stickyBottom,
        left: stickyLeft,
        right: stickyRight,
      },
      followFocus: options.followFocus,
    });
    if (initialPosition) area.scrollTo(initialPosition);
    return area;
  }, [
    initialExtent,
    initialPosition,
    initialViewport,
    options.followFocus,
    options.id,
    options.parentId,
    stickyBottom,
    stickyLeft,
    stickyRight,
    stickyTop,
  ]);
  useEffect(
    () => (options.enabled === false ? undefined : app.scroll.register(state)),
    [app.scroll, options.enabled, state],
  );
  useEffect(() => {
    state.resize(
      { width: viewportWidth, height: viewportHeight },
      { width: extentWidth, height: extentHeight },
    );
  }, [extentHeight, extentWidth, state, viewportHeight, viewportWidth]);
  const [snapshot, setSnapshot] = useState(() => state.snapshot());
  useEffect(() => {
    setSnapshot(state.snapshot());
    return state.subscribe(setSnapshot);
  }, [state]);
  const onWheel = useCallback(
    (event: Parameters<Parameters<typeof usePointerEvent>[2]>[0]) => {
      app.scroll.routeWheel(options.id, event.wheelX, event.wheelY);
      event.preventDefault();
    },
    [app.scroll, options.id],
  );
  usePointerEvent(options.id, "wheel", onWheel, { enabled: options.enabled });
  return { state, snapshot };
}
