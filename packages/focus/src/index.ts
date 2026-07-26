import { deleteOnDispose, type TerminalBounds } from "@mwillbanks/tuil-core";
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

export interface FocusNode {
  readonly id: string;
  readonly parentId?: string;
  readonly scopeId?: string;
  readonly disabled: boolean;
  readonly hidden: boolean;
  readonly order: number;
  readonly role?: string;
  readonly label?: string;
  readonly bounds?: TerminalBounds;
}

export type FocusNodeInput = Omit<FocusNode, "order"> & {
  readonly order?: number;
};

export interface FocusScopeDefinition {
  readonly id: string;
  readonly parentId?: string;
  readonly orientation?: "horizontal" | "vertical" | "grid";
  readonly loop?: boolean;
  readonly restoreFocus?: boolean;
  readonly trapped?: boolean;
}

export type FocusDirection =
  | "next"
  | "previous"
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageUp"
  | "pageDown"
  | "home"
  | "end"
  | "parent"
  | "child";

export interface FocusChange {
  readonly previousId?: string;
  readonly currentId?: string;
  readonly reason: string;
}

export class FocusManager {
  readonly #nodes: Map<string, FocusNode>;
  readonly #scopes: Map<string, FocusScopeDefinition>;
  readonly #observers: Set<(change: FocusChange) => void>;
  readonly #history: (string | undefined)[];
  readonly #trapScopeIds: string[];
  #registrationOrder: number;
  #focusedId?: string;
  #activeScopeId?: string;

  constructor() {
    this.#nodes = new Map();
    this.#scopes = new Map();
    this.#observers = new Set();
    this.#history = [];
    this.#trapScopeIds = [];
    this.#registrationOrder = 0;
  }

  get focusedId(): string | undefined {
    return this.#focusedId;
  }

  get activeScopeId(): string | undefined {
    return this.#activeScopeId;
  }

  registerNode(node: FocusNodeInput): () => void {
    if (this.#nodes.has(node.id)) {
      throw new Error(`Focus node "${node.id}" is already registered`);
    }
    const registered = Object.freeze({
      ...node,
      order: node.order ?? this.#registrationOrder++,
    }) as FocusNode;
    this.#nodes.set(node.id, registered);
    const trapScopeId = this.#trapScopeIds.at(-1);
    const focused = this.#focusedId
      ? this.#nodes.get(this.#focusedId)
      : undefined;
    if (
      trapScopeId &&
      this.#belongsToScope(registered, trapScopeId) &&
      (!focused || !this.#belongsToScope(focused, trapScopeId))
    ) {
      this.first();
    }
    return this.#unregisterNode.bind(this, node.id);
  }

  updateNode(id: string, update: Partial<FocusNode>): void {
    const node = this.#nodes.get(id);
    if (!node) {
      throw new Error(`Focus node "${id}" is not registered`);
    }
    this.#nodes.set(id, Object.freeze({ ...node, ...update, id }));
    if (
      this.#focusedId === id &&
      (update.disabled === true || update.hidden === true)
    ) {
      this.next();
    }
  }

  registerScope(scope: FocusScopeDefinition): () => void {
    if (this.#scopes.has(scope.id)) {
      throw new Error(`Focus scope "${scope.id}" is already registered`);
    }
    this.#scopes.set(scope.id, Object.freeze({ ...scope }));
    return this.#unregisterScope.bind(this, scope.id, scope.parentId);
  }

  activateScope(id: string): void {
    if (!this.#scopes.has(id)) {
      throw new Error(`Focus scope "${id}" is not registered`);
    }
    this.#history.push(this.#focusedId);
    this.#activeScopeId = id;
    if (this.#scopes.get(id)?.trapped) {
      this.#removeTrap(id);
      this.#trapScopeIds.push(id);
    }
    const current = this.#focusedId
      ? this.#nodes.get(this.#focusedId)
      : undefined;
    if (!current || !this.#belongsToScope(current, id)) {
      const direct = [...this.#nodes.values()]
        .filter((node) => this.#isFocusable(node) && node.scopeId === id)
        .sort(
          (left, right) =>
            left.order - right.order || left.id.localeCompare(right.id),
        )[0];
      if (!direct || !this.focus(direct.id, "scope")) {
        this.first();
      }
    }
  }

  deactivateScope(id: string): void {
    const scope = this.#scopes.get(id);
    if (!scope) {
      return;
    }
    this.#removeTrap(id);
    this.#activeScopeId = scope.parentId;
    if (scope.restoreFocus) {
      this.restore();
    }
  }

  focus(id: string, reason = "programmatic"): boolean {
    const node = this.#nodes.get(id);
    if (!node || !this.#isFocusable(node)) {
      return false;
    }
    const trapScopeId = this.#trapScopeIds.at(-1);
    if (trapScopeId && !this.#belongsToScope(node, trapScopeId)) {
      return false;
    }
    this.#activeScopeId = node.scopeId ?? this.#activeScopeId;
    this.#setFocused(id, reason);
    return true;
  }

  next(): boolean {
    return this.#moveLinear(1, "next");
  }

  previous(): boolean {
    return this.#moveLinear(-1, "previous");
  }

  first(): boolean {
    const first = this.#candidates()[0];
    return first ? this.focus(first.id, "first") : false;
  }

  last(): boolean {
    const last = this.#candidates().at(-1);
    return last ? this.focus(last.id, "last") : false;
  }

  enter(): boolean {
    if (!this.#focusedId) {
      return false;
    }
    const child = this.#candidates().find(
      (node) => node.parentId === this.#focusedId,
    );
    return child ? this.focus(child.id, "enter") : false;
  }

  exit(): boolean {
    const focused = this.#focusedId
      ? this.#nodes.get(this.#focusedId)
      : undefined;
    if (focused?.parentId && this.focus(focused.parentId, "exit")) {
      return true;
    }
    const scope = focused?.scopeId
      ? this.#scopes.get(focused.scopeId)
      : undefined;
    if (scope?.parentId) {
      this.deactivateScope(scope.id);
      return this.first();
    }
    return false;
  }

  restore(): boolean {
    while (this.#history.length > 0) {
      const id = this.#history.pop();
      if (id && this.focus(id, "restore")) {
        return true;
      }
    }
    return this.first();
  }

  move(direction: FocusDirection, pageSize = 10): boolean {
    if (direction === "next") return this.next();
    if (direction === "previous") return this.previous();
    if (direction === "home") return this.first();
    if (direction === "end") return this.last();
    if (direction === "parent") return this.exit();
    if (direction === "child") return this.enter();
    if (direction === "pageUp" || direction === "pageDown") {
      const candidates = this.#candidates();
      const current = candidates.findIndex(
        (node) => node.id === this.#focusedId,
      );
      if (current < 0) {
        return this.first();
      }
      const delta = direction === "pageUp" ? -pageSize : pageSize;
      const target =
        candidates[
          Math.max(0, Math.min(candidates.length - 1, current + delta))
        ];
      return target ? this.focus(target.id, direction) : false;
    }
    return this.#moveDirectional(direction);
  }

  observe(observer: (change: FocusChange) => void): () => void {
    this.#observers.add(observer);
    return deleteOnDispose(this.#observers, observer);
  }

  nodes(): readonly FocusNode[] {
    return [...this.#nodes.values()];
  }

  #unregisterNode(id: string): void {
    this.#nodes.delete(id);
    if (this.#focusedId === id) {
      this.#setFocused(undefined, "unregister");
      this.first();
    }
  }

  #unregisterScope(id: string, parentId?: string): void {
    this.#scopes.delete(id);
    if (this.#activeScopeId === id) {
      this.#activeScopeId = parentId;
    }
    this.#removeTrap(id);
  }

  #moveLinear(delta: -1 | 1, reason: string): boolean {
    const candidates = this.#candidates();
    if (candidates.length === 0) {
      return false;
    }
    const current = candidates.findIndex((node) => node.id === this.#focusedId);
    let next =
      current < 0 ? (delta === 1 ? 0 : candidates.length - 1) : current + delta;
    const scope = this.#activeScopeId
      ? this.#scopes.get(this.#activeScopeId)
      : undefined;
    if (next < 0 || next >= candidates.length) {
      if (!scope?.loop) {
        return false;
      }
      next = (next + candidates.length) % candidates.length;
    }
    const target = candidates[next];
    return target ? this.focus(target.id, reason) : false;
  }

  #moveDirectional(direction: "up" | "down" | "left" | "right"): boolean {
    const current = this.#focusedId
      ? this.#nodes.get(this.#focusedId)
      : undefined;
    if (!current?.bounds) {
      return direction === "up" || direction === "left"
        ? this.previous()
        : this.next();
    }
    const origin = {
      x: current.bounds.x + current.bounds.width / 2,
      y: current.bounds.y + current.bounds.height / 2,
    };
    const candidates = this.#candidates()
      .filter((node) => node.id !== current.id && node.bounds)
      .map((node) => {
        const bounds = node.bounds as TerminalBounds;
        const center = {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        };
        const dx = center.x - origin.x;
        const dy = center.y - origin.y;
        const valid =
          (direction === "up" && dy < 0) ||
          (direction === "down" && dy > 0) ||
          (direction === "left" && dx < 0) ||
          (direction === "right" && dx > 0);
        const primary =
          direction === "up" || direction === "down"
            ? Math.abs(dy)
            : Math.abs(dx);
        const secondary =
          direction === "up" || direction === "down"
            ? Math.abs(dx)
            : Math.abs(dy);
        return { node, valid, score: primary + secondary * 2 };
      })
      .filter((candidate) => candidate.valid)
      .sort((left, right) => left.score - right.score);
    const target = candidates[0]?.node;
    return target ? this.focus(target.id, direction) : false;
  }

  #candidates(): FocusNode[] {
    return [...this.#nodes.values()]
      .filter(
        (node) =>
          this.#isFocusable(node) &&
          (this.#trapScopeIds.length > 0
            ? this.#belongsToScope(node, this.#trapScopeIds.at(-1) as string)
            : this.#activeScopeId
              ? node.scopeId === this.#activeScopeId
              : true),
      )
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id),
      );
  }

  #belongsToScope(node: FocusNode, scopeId: string): boolean {
    let current = node.scopeId;
    while (current) {
      if (current === scopeId) {
        return true;
      }
      current = this.#scopes.get(current)?.parentId;
    }
    return false;
  }

  #isFocusable(node: FocusNode): boolean {
    return !node.disabled && !node.hidden;
  }

  #removeTrap(id: string): void {
    const index = this.#trapScopeIds.lastIndexOf(id);
    if (index >= 0) {
      this.#trapScopeIds.splice(index, 1);
    }
  }

  #setFocused(currentId: string | undefined, reason: string): void {
    if (this.#focusedId === currentId) {
      return;
    }
    const previousId = this.#focusedId;
    this.#focusedId = currentId;
    const change = Object.freeze({ previousId, currentId, reason });
    for (const observer of this.#observers) {
      observer(change);
    }
  }
}

const FocusContext = createContext<FocusManager | undefined>(undefined);
const FocusScopeContext = createContext<string | undefined>(undefined);

export function FocusProvider(props: {
  readonly manager?: FocusManager;
  readonly children?: ReactNode;
}): ReactNode {
  const manager = useMemo(
    () => props.manager ?? new FocusManager(),
    [props.manager],
  );
  return createElement(
    FocusContext.Provider,
    { value: manager },
    props.children,
  );
}

export function useFocusManager(): FocusManager {
  const manager = useContext(FocusContext);
  if (!manager) {
    throw new Error("useFocusManager must be used inside FocusProvider");
  }
  return manager;
}

export function useFocusable(node: FocusNodeInput): {
  readonly focused: boolean;
  readonly focus: () => boolean;
} {
  const manager = useFocusManager();
  const inheritedScopeId = useContext(FocusScopeContext);
  const registeredNode = useMemo(
    () => ({
      ...node,
      scopeId: node.scopeId ?? inheritedScopeId,
    }),
    [inheritedScopeId, node],
  );
  useEffect(
    () => manager.registerNode(registeredNode),
    [manager, registeredNode],
  );
  const getFocusedId = useCallback(() => manager.focusedId, [manager]);
  const focusedId = useSyncExternalStore(
    (notify) => manager.observe(notify),
    getFocusedId,
    getFocusedId,
  );
  return {
    focused: focusedId === node.id,
    focus: useCallback(() => manager.focus(node.id), [manager, node.id]),
  };
}

export function FocusScope(
  props: FocusScopeDefinition & {
    readonly active?: boolean;
    readonly children?: ReactNode;
  },
): ReactNode {
  const manager = useFocusManager();
  const inheritedParentId = useContext(FocusScopeContext);
  const {
    id,
    parentId,
    orientation,
    loop,
    restoreFocus,
    trapped,
    active = true,
  } = props;
  const resolvedParentId = parentId ?? inheritedParentId;
  useEffect(() => {
    const unregister = manager.registerScope({
      id,
      parentId: resolvedParentId,
      orientation,
      loop,
      restoreFocus,
      trapped,
    });
    if (active) {
      manager.activateScope(id);
    }
    return () => {
      manager.deactivateScope(id);
      unregister();
    };
  }, [
    active,
    id,
    loop,
    manager,
    orientation,
    resolvedParentId,
    restoreFocus,
    trapped,
  ]);
  return createElement(
    FocusScopeContext.Provider,
    { value: id },
    props.children,
  );
}

export function useFocusScopeId(): string | undefined {
  return useContext(FocusScopeContext);
}

export function FocusTrap(props: {
  readonly id: string;
  readonly active: boolean;
  readonly children?: ReactNode;
}): ReactNode {
  return createElement(
    FocusScope,
    {
      id: props.id,
      active: props.active,
      trapped: true,
      loop: true,
      restoreFocus: true,
    },
    props.children,
  );
}
