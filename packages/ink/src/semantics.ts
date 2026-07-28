import { deleteOnDispose, type SemanticMetadata } from "@mwillbanks/tuil-core";
import type {
  LayoutNodeInput,
  LayoutProjection,
} from "@mwillbanks/tuil-renderer";
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export interface SemanticNode extends SemanticMetadata {
  readonly key: string;
  readonly text?: string;
  readonly layout?: Omit<LayoutNodeInput, "id" | "semantics" | "children">;
}

export function resolveSemanticNode(
  defaults: SemanticNode,
  metadata?: SemanticMetadata,
): SemanticNode {
  const definedMetadata = Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([, value]) => value !== undefined),
  );
  return Object.freeze({
    ...defaults,
    ...definedMetadata,
    key: defaults.key,
    id: defaults.id,
  });
}

export interface ExternalSnapshotStore<TSnapshot> {
  subscribe(observer: () => void): () => void;
  snapshot(): TSnapshot;
}

export function useOptionalExternalStore<TSnapshot>(
  store: ExternalSnapshotStore<TSnapshot> | undefined,
  emptySnapshot: TSnapshot,
): TSnapshot {
  const subscribe = useCallback(
    (notify: () => void) => store?.subscribe(notify) ?? (() => undefined),
    [store],
  );
  const getSnapshot = useCallback(
    () => store?.snapshot() ?? emptySnapshot,
    [emptySnapshot, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export class SemanticRegistry {
  readonly #nodes: Map<string, SemanticNode>;
  readonly #observers: Set<() => void>;
  readonly #layout?: LayoutProjection;

  constructor(layout?: LayoutProjection) {
    this.#nodes = new Map();
    this.#observers = new Set();
    this.#layout = layout;
  }

  register(node: SemanticNode): () => void {
    this.#nodes.set(node.key, Object.freeze({ ...node }));
    this.#project(node);
    this.#notify();
    return () => {
      this.#nodes.delete(node.key);
      this.#layout?.remove(node.id ?? node.key);
      this.#notify();
    };
  }

  update(node: SemanticNode): void {
    this.#nodes.set(node.key, Object.freeze({ ...node }));
    this.#project(node);
    this.#notify();
  }

  nodes(): readonly SemanticNode[] {
    return [...this.#nodes.values()];
  }

  observe(observer: () => void): () => void {
    this.#observers.add(observer);
    return deleteOnDispose(this.#observers, observer);
  }

  #notify(): void {
    for (const observer of this.#observers) observer();
  }

  #project(node: SemanticNode): void {
    if (!this.#layout || !node.layout) return;
    this.#layout.upsert({
      id: node.id ?? node.key,
      ...node.layout,
      semantics: node,
    });
  }
}

const SemanticContext = createContext<SemanticRegistry | undefined>(undefined);

export function SemanticProvider(props: {
  readonly registry?: SemanticRegistry;
  readonly children?: ReactNode;
}): ReactNode {
  const registry = useMemo(
    () => props.registry ?? new SemanticRegistry(),
    [props.registry],
  );
  return createElement(
    SemanticContext.Provider,
    { value: registry },
    props.children,
  );
}

export function useSemanticRegistry(): SemanticRegistry {
  const registry = useContext(SemanticContext);
  if (!registry) {
    throw new Error("Semantic components require SemanticProvider");
  }
  return registry;
}

export function useSemanticNode(node: SemanticNode): void {
  const registry = useSemanticRegistry();
  useEffect(() => registry.register(node), [node, registry]);
}
