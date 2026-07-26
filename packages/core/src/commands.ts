import { type Disposable, toDisposable } from "./disposable.ts";
import type { ServiceContainer } from "./services.ts";

export interface CommandContext {
  readonly services: ServiceContainer;
  readonly signal: AbortSignal;
  readonly source?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Command<TResult = unknown> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  readonly hotkeys?: readonly string[];
  readonly hotkeyScope?:
    | "application"
    | "route"
    | "focus-scope"
    | "component"
    | "overlay"
    | "dialog";
  readonly hotkeyScopeId?: string;
  readonly enabled?: (context: CommandContext) => boolean | Promise<boolean>;
  readonly execute: (context: CommandContext) => TResult | Promise<TResult>;
}

export interface CommandExecution {
  readonly commandId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly status: "succeeded" | "failed" | "cancelled" | "disabled";
  readonly error?: unknown;
}

export type CommandRegistryChange =
  | { readonly type: "registered"; readonly command: Command }
  | { readonly type: "unregistered"; readonly command: Command };

export function defineCommand<TResult>(
  command: Command<TResult>,
): Command<TResult> {
  return Object.freeze(command);
}

export class CommandRegistry {
  readonly #commands = new Map<string, Command>();
  readonly #observers = new Set<(execution: CommandExecution) => void>();
  readonly #registryObservers = new Set<
    (change: CommandRegistryChange) => void
  >();

  constructor(readonly services: ServiceContainer) {}

  register(command: Command): Disposable {
    if (this.#commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    this.#commands.set(command.id, command);
    this.#notifyRegistry({ type: "registered", command });
    let disposed = false;
    return toDisposable(() => {
      if (disposed) return;
      disposed = true;
      this.#commands.delete(command.id);
      this.#notifyRegistry({ type: "unregistered", command });
    });
  }

  get(id: string): Command | undefined {
    return this.#commands.get(id);
  }

  list(): readonly Command[] {
    return [...this.#commands.values()];
  }

  observe(observer: (execution: CommandExecution) => void): Disposable {
    this.#observers.add(observer);
    return toDisposable(() => {
      this.#observers.delete(observer);
    });
  }

  observeRegistry(
    observer: (change: CommandRegistryChange) => void,
  ): Disposable {
    this.#registryObservers.add(observer);
    return toDisposable(() => {
      this.#registryObservers.delete(observer);
    });
  }

  async execute<TResult = unknown>(
    id: string,
    options: {
      signal?: AbortSignal;
      source?: string;
      metadata?: Readonly<Record<string, unknown>>;
    } = {},
  ): Promise<TResult | undefined> {
    const command = this.#commands.get(id);
    if (!command) {
      throw new Error(`Command "${id}" is not registered`);
    }
    const startedAt = Date.now();
    const signal = options.signal ?? new AbortController().signal;
    const context: CommandContext = {
      services: this.services,
      signal,
      source: options.source,
      metadata: options.metadata ?? {},
    };
    if (signal.aborted) {
      this.#notify({
        commandId: id,
        startedAt,
        completedAt: Date.now(),
        status: "cancelled",
        error: signal.reason,
      });
      throw signal.reason;
    }
    if (command.enabled && !(await command.enabled(context))) {
      this.#notify({
        commandId: id,
        startedAt,
        completedAt: Date.now(),
        status: "disabled",
      });
      return undefined;
    }
    try {
      const result = (await command.execute(context)) as TResult;
      this.#notify({
        commandId: id,
        startedAt,
        completedAt: Date.now(),
        status: "succeeded",
      });
      return result;
    } catch (error) {
      const status = signal.aborted ? "cancelled" : "failed";
      this.#notify({
        commandId: id,
        startedAt,
        completedAt: Date.now(),
        status,
        error,
      });
      throw error;
    }
  }

  #notify(execution: CommandExecution): void {
    for (const observer of this.#observers) {
      observer(execution);
    }
  }

  #notifyRegistry(change: CommandRegistryChange): void {
    for (const observer of this.#registryObservers) {
      observer(change);
    }
  }
}
