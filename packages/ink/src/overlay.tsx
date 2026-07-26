import { FocusTrap } from "@mwillbanks/tuil-focus";
import { HotkeyLayer, useHotkey } from "@mwillbanks/tuil-hotkeys";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { TerminalInputLayer, useTerminalInput } from "./index.ts";

interface OverlaySnapshot {
  readonly ids: readonly string[];
  readonly topId?: string;
}

interface OverlayEntry {
  readonly id: string;
  readonly parentId?: string;
  readonly sequence: number;
}

class OverlayManager {
  readonly #entries = new Map<string, OverlayEntry>();
  readonly #observers = new Set<() => void>();
  #snapshot: OverlaySnapshot = Object.freeze({ ids: [] });
  #sequence = 0;

  register(id: string, parentId?: string): () => void {
    if (this.#entries.has(id)) {
      throw new Error(`Duplicate overlay "${id}"`);
    }
    this.#entries.set(id, {
      id,
      parentId,
      sequence: this.#sequence,
    });
    this.#sequence += 1;
    this.#update();
    return () => {
      this.#entries.delete(id);
      this.#update();
    };
  }

  subscribe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  snapshot(): OverlaySnapshot {
    return this.#snapshot;
  }

  #update(): void {
    const depth = (entry: OverlayEntry): number => {
      const seen = new Set<string>([entry.id]);
      let current = entry;
      let result = 0;
      while (current.parentId) {
        if (seen.has(current.parentId)) break;
        seen.add(current.parentId);
        const parent = this.#entries.get(current.parentId);
        if (!parent) break;
        result += 1;
        current = parent;
      }
      return result;
    };
    const ids = [...this.#entries.values()]
      .sort(
        (left, right) =>
          depth(left) - depth(right) || left.sequence - right.sequence,
      )
      .map((entry) => entry.id);
    this.#snapshot = Object.freeze({
      ids: Object.freeze(ids),
      topId: ids.at(-1),
    });
    for (const observer of this.#observers) observer();
  }
}

const OverlayContext = createContext<OverlayManager | undefined>(undefined);
const OverlayLayerContext = createContext<string | undefined>(undefined);

export function OverlayProvider(props: {
  readonly children?: ReactNode;
}): ReactNode {
  const manager = useMemo(() => new OverlayManager(), []);
  return (
    <OverlayContext.Provider value={manager}>
      {props.children}
    </OverlayContext.Provider>
  );
}

export interface OverlayStatus {
  readonly active: boolean;
  readonly count: number;
  readonly topId?: string;
  readonly getTopId: () => string | undefined;
}

export function useOverlayStatus(): OverlayStatus {
  const manager = useContext(OverlayContext);
  if (!manager) {
    throw new Error("useOverlayStatus must be used inside OverlayProvider");
  }
  const snapshot = useSyncExternalStore(
    (notify) => manager.subscribe(notify),
    () => manager.snapshot(),
    () => manager.snapshot(),
  );
  return {
    active: snapshot.ids.length > 0,
    count: snapshot.ids.length,
    topId: snapshot.topId,
    getTopId: () => manager.snapshot().topId,
  };
}

export interface OverlayProps {
  readonly id: string;
  readonly open: boolean;
  readonly dismissOnEscape?: boolean;
  readonly onDismiss?: () => void | Promise<void>;
  readonly children?: ReactNode;
}

export function Overlay({
  id,
  open,
  dismissOnEscape = true,
  onDismiss,
  children,
}: OverlayProps): ReactNode {
  const manager = useContext(OverlayContext);
  const parentId = useContext(OverlayLayerContext);
  if (!manager) {
    throw new Error("Overlay must be used inside OverlayProvider");
  }
  useEffect(() => {
    if (!open) return;
    return manager.register(id, parentId);
  }, [id, manager, open, parentId]);
  useTerminalInput(
    async (input, key) => {
      if (manager.snapshot().topId !== id) return false;
      if ((key.escape || input === "\u001b") && dismissOnEscape) {
        await onDismiss?.();
        return true;
      }
      if (
        key.return ||
        key.tab ||
        key.upArrow ||
        key.downArrow ||
        key.leftArrow ||
        key.rightArrow ||
        key.pageUp ||
        key.pageDown ||
        input === " "
      ) {
        return false;
      }
      return true;
    },
    {
      enabled: open,
      priority: 1_000,
      layerId: id,
    },
  );
  useHotkey("escape", () => onDismiss?.(), {
    scope: "overlay",
    scopeId: id,
    priority: 10_000,
    enabled: () => open && dismissOnEscape && manager.snapshot().topId === id,
    title: "Dismiss overlay",
  });
  if (!open) return null;
  return (
    <FocusTrap id={`overlay:${id}`} active>
      <OverlayLayerContext.Provider value={id}>
        <TerminalInputLayer id={id}>
          <HotkeyLayer scope="overlay" scopeId={id}>
            {children}
          </HotkeyLayer>
        </TerminalInputLayer>
      </OverlayLayerContext.Provider>
    </FocusTrap>
  );
}

export function DismissableLayer(props: OverlayProps): ReactNode {
  return <Overlay {...props} />;
}
