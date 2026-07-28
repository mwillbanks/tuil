import { useApp } from "@mwillbanks/tuil";
import type {
  PointerEventType,
  PointerListener,
  PointerRouter,
  TuilPointerEvent,
} from "@mwillbanks/tuil-pointer";
import { useCallback, useEffect, useEffectEvent, useMemo } from "react";

export interface PointerEventBinding {
  readonly id: string;
  readonly type: PointerEventType;
  readonly listener: PointerListener;
  readonly capture?: boolean;
  readonly enabled?: boolean;
}

function registerPointerBindings(
  pointer: PointerRouter,
  bindings: readonly PointerEventBinding[],
): () => void {
  const disposers = bindings.flatMap((binding) =>
    binding.enabled === false
      ? []
      : [
          pointer.on(binding.id, binding.type, binding.listener, {
            capture: binding.capture,
          }),
        ],
  );
  return () => {
    for (const dispose of disposers) dispose();
  };
}

export function usePointerEvents(
  bindings: readonly PointerEventBinding[],
): void {
  const app = useApp();
  useEffect(
    () => registerPointerBindings(app.pointer, bindings),
    [app.pointer, bindings],
  );
}

function registerPointerEvent(
  pointer: PointerRouter,
  id: string,
  type: PointerEventType,
  listener: PointerListener,
  capture: boolean | undefined,
): () => void {
  return pointer.on(id, type, listener, { capture });
}

export function usePointerEvent(
  id: string,
  type: PointerEventType,
  listener: PointerListener,
  options: { readonly capture?: boolean; readonly enabled?: boolean } = {},
): void {
  const app = useApp();
  const onPointer = useEffectEvent((event: TuilPointerEvent) =>
    listener(event),
  );
  useEffect(() => {
    if (options.enabled === false) return;
    return registerPointerEvent(
      app.pointer,
      id,
      type,
      onPointer,
      options.capture,
    );
  }, [app.pointer, id, options.capture, options.enabled, type]);
}

export function usePointerCapture(id: string): {
  readonly capture: () => void;
  readonly release: () => void;
} {
  const app = useApp();
  const capture = useCallback(() => app.pointer.capture(id), [app.pointer, id]);
  const release = useCallback(
    () => app.pointer.releaseCapture(id),
    [app.pointer, id],
  );
  return useMemo(() => ({ capture, release }), [capture, release]);
}
