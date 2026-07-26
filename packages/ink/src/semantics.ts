import { deleteOnDispose, type SemanticMetadata } from "@mwillbanks/tuil-core";
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

  constructor() {
    this.#nodes = new Map();
    this.#observers = new Set();
  }

  register(node: SemanticNode): () => void {
    this.#nodes.set(node.key, Object.freeze({ ...node }));
    this.#notify();
    return deleteOnDispose(this.#nodes, node.key, this.#notify.bind(this));
  }

  update(node: SemanticNode): void {
    this.#nodes.set(node.key, Object.freeze({ ...node }));
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
