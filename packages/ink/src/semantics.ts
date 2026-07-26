import type { SemanticMetadata } from "@mwillbanks/tuil-core";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react";

export interface SemanticNode extends SemanticMetadata {
  readonly key: string;
  readonly text?: string;
}

export class SemanticRegistry {
  readonly #nodes = new Map<string, SemanticNode>();
  readonly #observers = new Set<() => void>();

  register(node: SemanticNode): () => void {
    this.#nodes.set(node.key, Object.freeze({ ...node }));
    this.#notify();
    return () => {
      this.#nodes.delete(node.key);
      this.#notify();
    };
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
    return () => this.#observers.delete(observer);
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
