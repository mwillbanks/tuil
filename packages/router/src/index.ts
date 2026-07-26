import { createNusmStore } from "nusm";

export type NavigationSurface =
  | "screen"
  | "pane"
  | "overlay"
  | "dialog"
  | "workflow";

export interface FocusSnapshot {
  readonly scopeId?: string;
  readonly focusedId?: string;
  readonly scroll?: number;
  readonly selected?: string;
  readonly panes?: Readonly<Record<string, unknown>>;
}

export interface RouteContext<TParams = Readonly<Record<string, unknown>>> {
  readonly params: TParams;
  readonly signal: AbortSignal;
  readonly router: TerminalRouter;
}

type RouteHandler<TParams, TResult> = {
  bivarianceHack(context: RouteContext<TParams>): TResult;
}["bivarianceHack"];
type RouteErrorHandler<TParams> = {
  bivarianceHack(error: unknown, context: RouteContext<TParams>): void;
}["bivarianceHack"];

type EmptyParams = Readonly<Record<never, never>>;

export interface RouteDefinition<
  TParams = EmptyParams,
  TChildren extends Readonly<Record<string, object>> = Readonly<
    Record<string, object>
  >,
> {
  readonly component?: unknown;
  readonly children?: TChildren;
  readonly parseParams?: (params: unknown) => TParams;
  readonly beforeEnter?: RouteHandler<
    TParams,
    boolean | string | Promise<boolean | string>
  >;
  readonly loader?: RouteHandler<TParams, unknown | Promise<unknown>>;
  readonly onError?: RouteErrorHandler<TParams>;
  readonly beforeLeave?: RouteHandler<TParams, boolean | Promise<boolean>>;
}

export function route<
  TParams = EmptyParams,
  TChildren extends Readonly<Record<string, object>> = Readonly<
    Record<string, object>
  >,
>(
  definition: RouteDefinition<TParams, TChildren>,
): RouteDefinition<TParams, TChildren> {
  return Object.freeze({ ...definition });
}

export function defineRoutes<T extends Readonly<Record<string, object>>>(
  definitions: T,
): T {
  return Object.freeze({ ...definitions });
}

type RoutePaths<TTree> = {
  [TKey in keyof TTree & string]:
    | TKey
    | (TTree[TKey] extends {
        readonly children?: infer TChildren;
      }
        ? TChildren extends Readonly<Record<string, object>>
          ? `${TKey}.${RoutePaths<TChildren>}`
          : never
        : never);
}[keyof TTree & string];

type RouteParams<TDefinition> =
  TDefinition extends RouteDefinition<infer TParams, infer _TChildren>
    ? TParams
    : EmptyParams;

type RouteParamsAtPath<
  TTree,
  TPath extends string,
> = TPath extends `${infer THead}.${infer TTail}`
  ? THead extends keyof TTree
    ? TTree[THead] extends { readonly children?: infer TChildren }
      ? RouteParams<TTree[THead]> & RouteParamsAtPath<TChildren, TTail>
      : never
    : never
  : TPath extends keyof TTree
    ? RouteParams<TTree[TPath]>
    : never;

type InternalRouteDefinition = RouteDefinition<
  Readonly<Record<string, unknown>>,
  Readonly<Record<string, object>>
>;

export type NavigationTarget<TTo extends string = string, TParams = unknown> = {
  readonly to: TTo;
  readonly surface?: NavigationSurface;
  readonly replace?: boolean;
  readonly signal?: AbortSignal;
} & (unknown extends TParams
  ? { readonly params?: unknown }
  : keyof TParams extends never
    ? { readonly params?: TParams }
    : { readonly params: TParams });

export interface NavigationEntry {
  readonly id: string;
  readonly route: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly surface: NavigationSurface;
  readonly data?: unknown;
  readonly matches: readonly RouteMatch[];
  readonly focus?: FocusSnapshot;
  readonly createdAt: number;
}

export interface RouteMatch {
  readonly route: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly component?: unknown;
  readonly data?: unknown;
}

export interface RouterState {
  readonly location?: NavigationEntry;
  readonly history: readonly NavigationEntry[];
  readonly index: number;
  readonly pending?: NavigationTarget;
  readonly error?: unknown;
}

export type RouterEventType =
  | "route:before-navigate"
  | "route:navigate"
  | "route:load"
  | "route:ready"
  | "route:error"
  | "route:leave"
  | "route:restore-focus";

export interface RouterEvent {
  readonly type: RouterEventType;
  readonly from?: NavigationEntry;
  readonly to?: NavigationEntry | NavigationTarget;
  readonly error?: unknown;
  readonly at: number;
}

interface InternalRouteMatch {
  readonly route: string;
  readonly definition: InternalRouteDefinition;
}

function flattenRoutes(
  routes: Readonly<Record<string, InternalRouteDefinition>>,
  parent = "",
  ancestors: readonly InternalRouteMatch[] = [],
  result = new Map<string, readonly InternalRouteMatch[]>(),
): Map<string, readonly InternalRouteMatch[]> {
  for (const [name, definition] of Object.entries(routes)) {
    const id = parent ? `${parent}.${name}` : name;
    const chain = Object.freeze([
      ...ancestors,
      Object.freeze({ route: id, definition }),
    ]);
    result.set(id, chain);
    if (definition.children) {
      flattenRoutes(
        definition.children as Readonly<
          Record<string, InternalRouteDefinition>
        >,
        id,
        chain,
        result,
      );
    }
  }
  return result;
}

function normalizeParams(value: unknown): Readonly<Record<string, unknown>> {
  if (!value) return Object.freeze({});
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Route parameters must be an object");
  }
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

export interface TerminalRouterOptions {
  readonly captureFocus?: () => FocusSnapshot | undefined;
  readonly restoreFocus?: (
    snapshot: FocusSnapshot,
    signal: AbortSignal,
  ) => void | Promise<void>;
  readonly onObserverError?: (error: unknown) => void;
}

export class TerminalRouter<
  TRoutes extends Readonly<Record<string, object>> = Readonly<
    Record<string, object>
  >,
> {
  readonly #routes: Map<string, readonly InternalRouteMatch[]>;
  readonly #store = createNusmStore<RouterState>({
    history: Object.freeze([]),
    index: -1,
  });
  readonly #observers = new Set<(event: RouterEvent) => void>();
  #navigation?: AbortController;

  constructor(
    routes: TRoutes,
    readonly options: TerminalRouterOptions = {},
  ) {
    this.#routes = flattenRoutes(
      routes as unknown as Readonly<Record<string, InternalRouteDefinition>>,
    );
  }

  get state(): RouterState {
    return this.#store.state;
  }

  get routes(): readonly string[] {
    return Object.freeze([...this.#routes.keys()]);
  }

  subscribe(observer: () => void): () => void {
    const subscription = this.#store.subscribe(observer);
    return () => subscription.unsubscribe();
  }

  observe(observer: (event: RouterEvent) => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  navigate<TPath extends RoutePaths<TRoutes>>(
    target: NavigationTarget<TPath, RouteParamsAtPath<TRoutes, TPath>>,
  ): Promise<NavigationEntry> {
    return this.#navigate(target as NavigationTarget);
  }

  async #navigate(target: NavigationTarget): Promise<NavigationEntry> {
    const routeChain = this.#routes.get(target.to);
    if (!routeChain) throw new Error(`Unknown route "${target.to}"`);
    this.#navigation?.abort(new DOMException("Superseded", "AbortError"));
    const navigation = new AbortController();
    this.#navigation = navigation;
    const signal = target.signal
      ? AbortSignal.any([navigation.signal, target.signal])
      : navigation.signal;
    const from = this.state.location;
    this.#setState({ ...this.state, pending: target, error: undefined });
    this.#emit({ type: "route:before-navigate", from, to: target });
    const contexts: RouteContext[] = [];
    let activeMatchIndex = 0;
    try {
      for (const [index, match] of routeChain.entries()) {
        activeMatchIndex = index;
        const rawParams = match.definition.parseParams
          ? match.definition.parseParams(target.params)
          : target.params;
        contexts.push({
          params: normalizeParams(rawParams),
          signal,
          router: this as unknown as TerminalRouter,
        });
      }
      for (const [index, match] of routeChain.entries()) {
        activeMatchIndex = index;
        const guard = await match.definition.beforeEnter?.(
          contexts[index] as RouteContext,
        );
        signal.throwIfAborted();
        if (typeof guard === "string") {
          return this.#navigate({
            to: guard,
            surface: target.surface,
            signal: target.signal,
          });
        }
        if (guard === false) {
          throw new Error(`Navigation to "${target.to}" denied`);
        }
      }
      await this.#assertCanLeave(from, signal);
      const params =
        contexts.at(-1)?.params ?? Object.freeze<Record<string, unknown>>({});
      const routeMatches: RouteMatch[] = routeChain.map((match, index) =>
        Object.freeze({
          route: match.route,
          params: (contexts[index] as RouteContext).params,
          component: match.definition.component,
        }),
      );
      const entryBase: NavigationEntry = Object.freeze({
        id: crypto.randomUUID(),
        route: target.to,
        params,
        surface: target.surface ?? "screen",
        matches: Object.freeze([...routeMatches]),
        createdAt: Date.now(),
      });
      this.#emit({ type: "route:navigate", from, to: entryBase });
      for (const [index, match] of routeChain.entries()) {
        if (!match.definition.loader) continue;
        activeMatchIndex = index;
        this.#emit({ type: "route:load", from, to: entryBase });
        const data = await match.definition.loader(
          contexts[index] as RouteContext,
        );
        signal.throwIfAborted();
        routeMatches[index] = Object.freeze({
          ...(routeMatches[index] as RouteMatch),
          data,
        });
      }
      const entry = Object.freeze({
        ...entryBase,
        data: routeMatches.at(-1)?.data,
        matches: Object.freeze(routeMatches),
      });
      signal.throwIfAborted();
      const historyWithFocus = this.#captureCurrentFocus();
      const retained = target.replace
        ? historyWithFocus.slice(0, Math.max(0, this.state.index))
        : historyWithFocus.slice(0, this.state.index + 1);
      const history = Object.freeze(
        target.replace && this.state.index >= 0
          ? [...retained, entry]
          : [...retained, entry],
      );
      if (from) this.#emit({ type: "route:leave", from, to: entry });
      this.#setState({
        location: entry,
        history,
        index: history.length - 1,
      });
      this.#emit({ type: "route:ready", from, to: entry });
      return entry;
    } catch (error) {
      if (!navigation.signal.aborted) {
        let boundaryIndex = activeMatchIndex;
        while (
          boundaryIndex >= 0 &&
          !routeChain[boundaryIndex]?.definition.onError
        ) {
          boundaryIndex -= 1;
        }
        const boundary = routeChain[boundaryIndex];
        let reportedError = error;
        try {
          boundary?.definition.onError?.(
            error,
            contexts[boundaryIndex] ??
              ({
                params: Object.freeze({}),
                signal,
                router: this as unknown as TerminalRouter,
              } as RouteContext),
          );
        } catch (boundaryError) {
          reportedError = new AggregateError(
            [error, boundaryError],
            `Route error boundary for "${target.to}" failed`,
          );
        }
        this.#setState({
          ...this.state,
          pending: undefined,
          error: reportedError,
        });
        this.#emit({
          type: "route:error",
          from,
          to: target,
          error: reportedError,
        });
        throw reportedError;
      }
      throw error;
    }
  }

  open<TPath extends RoutePaths<TRoutes>>(
    target: {
      readonly route: TPath;
      readonly surface: Exclude<NavigationSurface, "screen">;
      readonly signal?: AbortSignal;
    } & (unknown extends RouteParamsAtPath<TRoutes, TPath>
      ? { readonly params?: unknown }
      : keyof RouteParamsAtPath<TRoutes, TPath> extends never
        ? { readonly params?: RouteParamsAtPath<TRoutes, TPath> }
        : { readonly params: RouteParamsAtPath<TRoutes, TPath> }),
  ): Promise<NavigationEntry> {
    const navigationTarget: NavigationTarget = {
      to: target.route,
      params: target.params,
      surface: target.surface,
      signal: target.signal,
    };
    return this.#navigate(navigationTarget);
  }

  async back(signal?: AbortSignal): Promise<NavigationEntry | undefined> {
    return this.#restore(this.state.index - 1, signal);
  }

  async forward(signal?: AbortSignal): Promise<NavigationEntry | undefined> {
    return this.#restore(this.state.index + 1, signal);
  }

  cancel(reason: unknown = new DOMException("Cancelled", "AbortError")): void {
    this.#navigation?.abort(reason);
    this.#setState({ ...this.state, pending: undefined });
  }

  dispose(): void {
    this.cancel(new DOMException("Disposed", "AbortError"));
    this.#observers.clear();
  }

  async #restore(
    index: number,
    externalSignal?: AbortSignal,
  ): Promise<NavigationEntry | undefined> {
    const entry = this.state.history[index];
    if (!entry) {
      this.cancel(new DOMException("Superseded", "AbortError"));
      return undefined;
    }
    this.#navigation?.abort(new DOMException("Superseded", "AbortError"));
    const navigation = new AbortController();
    this.#navigation = navigation;
    const signal = externalSignal
      ? AbortSignal.any([navigation.signal, externalSignal])
      : navigation.signal;
    const from = this.state.location;
    this.#emit({ type: "route:before-navigate", from, to: entry });
    try {
      await this.#assertCanLeave(from, signal);
      const routeChain = this.#routes.get(entry.route) ?? [];
      for (const match of routeChain) {
        const context: RouteContext = {
          params:
            entry.matches.find((entryMatch) => entryMatch.route === match.route)
              ?.params ?? entry.params,
          signal,
          router: this as unknown as TerminalRouter,
        };
        const guard = await match.definition.beforeEnter?.(context);
        signal.throwIfAborted();
        if (guard === false || typeof guard === "string") {
          throw new Error(`History navigation to "${entry.route}" denied`);
        }
      }
      const history = this.#captureCurrentFocus();
      const restoredEntry = history[index] ?? entry;
      const previousState = this.state;
      this.#setState({
        ...this.state,
        history: Object.freeze(history),
        location: restoredEntry,
        index,
        pending: undefined,
        error: undefined,
      });
      try {
        if (restoredEntry.focus && this.options.restoreFocus) {
          await this.options.restoreFocus(restoredEntry.focus, signal);
          signal.throwIfAborted();
          this.#emit({
            type: "route:restore-focus",
            from,
            to: restoredEntry,
          });
        }
        signal.throwIfAborted();
      } catch (error) {
        this.#setState({
          ...previousState,
          history: Object.freeze(history),
          pending: undefined,
        });
        throw error;
      }
      if (from) {
        this.#emit({ type: "route:leave", from, to: restoredEntry });
      }
      this.#emit({ type: "route:ready", from, to: restoredEntry });
      return restoredEntry;
    } catch (error) {
      if (!signal.aborted) {
        this.#setState({ ...this.state, pending: undefined, error });
        this.#emit({ type: "route:error", from, to: entry, error });
      }
      throw error;
    }
  }

  async #assertCanLeave(
    entry: NavigationEntry | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (!entry) return;
    const routeChain = this.#routes.get(entry.route) ?? [];
    for (const match of [...routeChain].reverse()) {
      const allowed = await match.definition.beforeLeave?.({
        params:
          entry.matches.find((entryMatch) => entryMatch.route === match.route)
            ?.params ?? entry.params,
        signal,
        router: this as unknown as TerminalRouter,
      });
      signal.throwIfAborted();
      if (allowed === false) {
        throw new Error(`Navigation away from "${entry.route}" denied`);
      }
    }
  }

  #captureCurrentFocus(): readonly NavigationEntry[] {
    const captured = this.state.location
      ? this.options.captureFocus?.()
      : undefined;
    if (!captured || this.state.index < 0) return this.state.history;
    return this.state.history.map((entry, index) =>
      index === this.state.index
        ? Object.freeze({ ...entry, focus: captured })
        : entry,
    );
  }

  #setState(state: RouterState): void {
    this.#store.setState(() => Object.freeze(state));
  }

  #emit(event: Omit<RouterEvent, "at">): void {
    const complete = Object.freeze({ ...event, at: Date.now() });
    for (const observer of this.#observers) {
      try {
        observer(complete);
      } catch (error) {
        try {
          this.options.onObserverError?.(error);
        } catch {
          // Observer error reporting must not corrupt router state.
        }
      }
    }
  }
}

export function createRouter<TRoutes extends Readonly<Record<string, object>>>(
  routes: TRoutes,
  options?: TerminalRouterOptions,
): TerminalRouter<TRoutes> {
  return new TerminalRouter(routes, options);
}
