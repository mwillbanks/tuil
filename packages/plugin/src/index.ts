import type {
  CommandRegistry,
  Disposable,
  Disposer,
  ServiceContainer,
} from "@mwillbanks/tuil-core";
import type { EventBus, EventMap } from "@mwillbanks/tuil-events";

export type PluginCapability =
  | "filesystem.read"
  | "filesystem.write"
  | "process.execute"
  | "network.request"
  | "terminal.rawMode"
  | "terminal.clipboard"
  | "state.persist";

export interface ExtensionRegistry {
  register(value: unknown): Disposable | Disposer | undefined;
}

export interface PluginContext<TEvents extends EventMap = EventMap> {
  readonly services: ServiceContainer;
  readonly commands: CommandRegistry;
  readonly events: EventBus<TEvents>;
  readonly routes: ExtensionRegistry;
  readonly registry: ExtensionRegistry;
  readonly workflows: ExtensionRegistry;
  readonly theme: ExtensionRegistry;
  readonly statusBar: ExtensionRegistry;
  readonly appBar: ExtensionRegistry;
  readonly menus: ExtensionRegistry;
  readonly keybindings: ExtensionRegistry;
  readonly dataAdapters: ExtensionRegistry;
  readonly persistenceAdapters: ExtensionRegistry;
  readonly operationExecutors: ExtensionRegistry;
  readonly devtools: ExtensionRegistry;
  readonly capabilities: ReadonlySet<PluginCapability>;
  readonly signal: AbortSignal;
}

export interface Plugin<TEvents extends EventMap = EventMap> {
  readonly id: string;
  readonly version: string;
  readonly dependsOn?: readonly string[];
  readonly requires?: {
    readonly capabilities?: readonly PluginCapability[];
  };
  readonly setup: (
    context: PluginContext<TEvents>,
  ) =>
    | undefined
    | Disposable
    | Disposer
    | Promise<undefined | Disposable | Disposer>;
}

export interface PluginHealth {
  readonly id: string;
  readonly version: string;
  readonly status:
    | "registered"
    | "initializing"
    | "healthy"
    | "failed"
    | "disposed";
  readonly error?: unknown;
}

export function createPlugin<TEvents extends EventMap = EventMap>(
  plugin: Plugin<TEvents>,
): Plugin<TEvents> {
  if (!plugin.id.trim()) {
    throw new Error("Plugin id cannot be empty");
  }
  if (!plugin.version.trim()) {
    throw new Error(`Plugin "${plugin.id}" must declare a version`);
  }
  return Object.freeze(plugin);
}

interface PluginRecord<TEvents extends EventMap> {
  readonly plugin: Plugin<TEvents>;
  status: PluginHealth["status"];
  error?: unknown;
  dispose?: Disposer;
}

export class PluginManager<TEvents extends EventMap = EventMap> {
  readonly #records = new Map<string, PluginRecord<TEvents>>();
  readonly #initialized: string[] = [];
  readonly #context: Omit<PluginContext<TEvents>, "signal">;
  readonly #controller = new AbortController();

  constructor(context: Omit<PluginContext<TEvents>, "signal">) {
    this.#context = context;
  }

  register(plugin: Plugin<TEvents>): () => void {
    if (this.#records.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.#records.set(plugin.id, { plugin, status: "registered" });
    return () => {
      const record = this.#records.get(plugin.id);
      if (record?.status === "healthy" || record?.status === "initializing") {
        throw new Error(`Cannot unregister active plugin "${plugin.id}"`);
      }
      this.#records.delete(plugin.id);
    };
  }

  health(): readonly PluginHealth[] {
    return [...this.#records.values()].map((record) =>
      Object.freeze({
        id: record.plugin.id,
        version: record.plugin.version,
        status: record.status,
        error: record.error,
      }),
    );
  }

  async initialize(): Promise<void> {
    const order = this.#resolveOrder();
    try {
      for (const id of order) {
        const record = this.#records.get(id);
        if (!record || record.status === "healthy") {
          continue;
        }
        const missing = record.plugin.requires?.capabilities?.filter(
          (capability) => !this.#context.capabilities.has(capability),
        );
        if (missing && missing.length > 0) {
          throw new Error(
            `Plugin "${id}" requires unavailable capabilities: ${missing.join(", ")}`,
          );
        }
        record.status = "initializing";
        try {
          const resource = await record.plugin.setup({
            ...this.#context,
            signal: this.#controller.signal,
          });
          if (typeof resource === "function") {
            record.dispose = resource;
          } else if (resource) {
            record.dispose = () => resource.dispose();
          }
          record.status = "healthy";
          this.#initialized.push(id);
        } catch (error) {
          record.status = "failed";
          record.error = error;
          throw error;
        }
      }
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.#controller.abort(new Error("Plugin manager disposed"));
    const errors: unknown[] = [];
    for (const id of [...this.#initialized].reverse()) {
      const record = this.#records.get(id);
      try {
        await record?.dispose?.();
      } catch (error) {
        errors.push(error);
      } finally {
        if (record) {
          record.status = "disposed";
        }
      }
    }
    this.#initialized.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose plugins");
    }
  }

  #resolveOrder(): readonly string[] {
    const temporary = new Set<string>();
    const permanent = new Set<string>();
    const order: string[] = [];
    const visit = (id: string, path: readonly string[]): void => {
      if (permanent.has(id)) {
        return;
      }
      if (temporary.has(id)) {
        throw new Error(
          `Plugin dependency cycle: ${[...path, id].join(" → ")}`,
        );
      }
      const record = this.#records.get(id);
      if (!record) {
        throw new Error(`Missing plugin dependency "${id}"`);
      }
      temporary.add(id);
      for (const dependency of record.plugin.dependsOn ?? []) {
        if (!this.#records.has(dependency)) {
          throw new Error(
            `Plugin "${id}" depends on missing plugin "${dependency}"`,
          );
        }
        visit(dependency, [...path, id]);
      }
      temporary.delete(id);
      permanent.add(id);
      order.push(id);
    };
    for (const id of this.#records.keys()) {
      visit(id, []);
    }
    return order;
  }
}
