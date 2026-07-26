export type EventMap = Record<string, unknown>;
export type EventPriority =
  | "immediate"
  | "interaction"
  | "normal"
  | "background";
export type EventPhase = "capture" | "target" | "bubble" | "direct";

export interface EventSource {
  readonly id: string;
  readonly kind?: string;
}

export interface EventTarget {
  readonly id: string;
  readonly kind?: string;
}

export interface TuilEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly type: TType;
  readonly payload: TPayload;
  readonly timestamp: number;
  readonly source?: EventSource;
  readonly target?: EventTarget;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly priority: EventPriority;
  readonly phase: EventPhase;
  readonly currentTarget?: string;
  readonly defaultPrevented: boolean;
  readonly propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface EventDefinition<TPayload> {
  readonly redact?: (payload: TPayload) => unknown;
}

export type EventDefinitions<TEvents extends EventMap> = {
  readonly [TType in keyof TEvents]: EventDefinition<TEvents[TType]>;
};

export function event<TPayload>(
  definition: EventDefinition<TPayload> = {},
): EventDefinition<TPayload> {
  return Object.freeze(definition);
}

export function defineEvents<const TEvents extends EventMap>(
  definitions: EventDefinitions<TEvents>,
): EventDefinitions<TEvents> {
  return Object.freeze(definitions);
}

export interface EventEmitOptions {
  readonly source?: EventSource;
  readonly target?: EventTarget;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly priority?: EventPriority;
  readonly path?: readonly string[];
}

export interface EventSubscriptionOptions {
  readonly phase?: EventPhase;
  readonly target?: string;
  readonly priority?: number;
  readonly signal?: AbortSignal;
}

export interface ObservedEvent {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly timestamp: number;
  readonly source?: EventSource;
  readonly target?: EventTarget;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly priority: EventPriority;
  readonly defaultPrevented: boolean;
}

type EventListener<TPayload> = (
  event: TuilEvent<string, TPayload>,
) => void | Promise<void>;

interface Subscription {
  readonly type: string;
  readonly listener: EventListener<unknown>;
  readonly phase: EventPhase;
  readonly target?: string;
  readonly priority: number;
}

class MutableTuilEvent<TType extends string, TPayload>
  implements TuilEvent<TType, TPayload>
{
  phase: EventPhase = "direct";
  currentTarget?: string;
  defaultPrevented = false;
  propagationStopped = false;

  constructor(
    readonly id: string,
    readonly type: TType,
    readonly payload: TPayload,
    readonly timestamp: number,
    readonly source: EventSource | undefined,
    readonly target: EventTarget | undefined,
    readonly metadata: Readonly<Record<string, unknown>>,
    readonly priority: EventPriority,
  ) {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

const schedulingDelay: Record<EventPriority, number> = {
  immediate: 0,
  interaction: 0,
  normal: 0,
  background: 1,
};

export class EventBus<TEvents extends EventMap = EventMap> {
  readonly #definitions: Record<string, EventDefinition<unknown>>;
  readonly #subscriptions = new Set<Subscription>();
  readonly #observers = new Set<(event: ObservedEvent) => void>();
  readonly #history: ObservedEvent[] = [];
  #disposed = false;

  constructor(definitions: Partial<EventDefinitions<TEvents>> = {}) {
    this.#definitions = {
      ...(definitions as Record<string, EventDefinition<unknown>>),
    };
  }

  register<TType extends keyof TEvents & string>(
    type: TType,
    definition: EventDefinition<TEvents[TType]>,
  ): () => void {
    this.#assertActive();
    if (type in this.#definitions) {
      throw new Error(`Event "${type}" is already declared`);
    }
    this.#definitions[type] = definition as EventDefinition<unknown>;
    return () => {
      delete this.#definitions[type];
    };
  }

  on<TType extends keyof TEvents & string>(
    type: TType,
    listener: EventListener<TEvents[TType]>,
    options: EventSubscriptionOptions = {},
  ): () => void {
    this.#assertActive();
    const subscription: Subscription = {
      type,
      listener: listener as EventListener<unknown>,
      phase: options.phase ?? "direct",
      target: options.target,
      priority: options.priority ?? 0,
    };
    this.#subscriptions.add(subscription);
    const dispose = () => this.#subscriptions.delete(subscription);
    if (options.signal) {
      if (options.signal.aborted) {
        dispose();
      } else {
        options.signal.addEventListener("abort", dispose, { once: true });
      }
    }
    return dispose;
  }

  observe(observer: (event: ObservedEvent) => void): () => void {
    this.#assertActive();
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  history(): readonly ObservedEvent[] {
    return Object.freeze([...this.#history]);
  }

  async emit<TType extends keyof TEvents & string>(
    type: TType,
    payload: TEvents[TType],
    options: EventEmitOptions = {},
  ): Promise<TuilEvent<TType, TEvents[TType]>> {
    this.#assertActive();
    if (!(type in this.#definitions)) {
      throw new Error(`Event "${type}" has not been declared`);
    }
    const priority = options.priority ?? "normal";
    if (schedulingDelay[priority] > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, schedulingDelay[priority]),
      );
    }
    const emitted = new MutableTuilEvent(
      crypto.randomUUID(),
      type,
      payload,
      Date.now(),
      options.source,
      options.target,
      Object.freeze({ ...options.metadata }),
      priority,
    );
    if (options.path && options.path.length > 0) {
      await this.#dispatchRouted(emitted, options.path);
    } else {
      await this.#dispatch(emitted, "direct");
    }
    const definition = this.#definitions[type];
    const observedPayload = definition?.redact
      ? definition.redact(payload)
      : payload;
    const observed: ObservedEvent = Object.freeze({
      id: emitted.id,
      type,
      payload: observedPayload,
      timestamp: emitted.timestamp,
      source: emitted.source,
      target: emitted.target,
      metadata: emitted.metadata,
      priority,
      defaultPrevented: emitted.defaultPrevented,
    });
    this.#history.push(observed);
    if (this.#history.length > 200) this.#history.shift();
    for (const observer of this.#observers) {
      observer(observed);
    }
    return emitted;
  }

  dispose(): void {
    this.#disposed = true;
    this.#subscriptions.clear();
    this.#observers.clear();
    this.#history.length = 0;
  }

  async #dispatchRouted(
    event: MutableTuilEvent<string, unknown>,
    path: readonly string[],
  ): Promise<void> {
    const target = path.at(-1);
    for (const currentTarget of path.slice(0, -1)) {
      if (event.propagationStopped) {
        return;
      }
      await this.#dispatch(event, "capture", currentTarget);
    }
    if (!event.propagationStopped && target) {
      await this.#dispatch(event, "target", target);
    }
    for (const currentTarget of path.slice(0, -1).reverse()) {
      if (event.propagationStopped) {
        return;
      }
      await this.#dispatch(event, "bubble", currentTarget);
    }
  }

  async #dispatch(
    event: MutableTuilEvent<string, unknown>,
    phase: EventPhase,
    currentTarget?: string,
  ): Promise<void> {
    event.phase = phase;
    event.currentTarget = currentTarget;
    const subscriptions = [...this.#subscriptions]
      .filter(
        (subscription) =>
          subscription.type === event.type &&
          subscription.phase === phase &&
          (subscription.target === undefined ||
            subscription.target === currentTarget),
      )
      .sort((left, right) => right.priority - left.priority);
    for (const subscription of subscriptions) {
      await subscription.listener(event);
      if (event.propagationStopped) {
        return;
      }
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("Event bus is disposed");
    }
  }
}
