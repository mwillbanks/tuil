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

export interface ExtensionRegistry<TValue = unknown> {
  register(value: TValue): Disposable;
  values(): readonly TValue[];
  observe(observer: () => void): Disposer;
}

export interface DefaultExtensionPoints {
  routes: unknown;
  registry: unknown;
  workflows: unknown;
  theme: unknown;
  statusBar: unknown;
  appBar: unknown;
  menus: unknown;
  keybindings: unknown;
  dataAdapters: unknown;
  persistenceAdapters: unknown;
  operationExecutors: unknown;
  devtools: unknown;
  components: unknown;
  editorProviders: unknown;
  editorCommands: unknown;
  logParsers: unknown;
  themes: unknown;
  formatAdapters: unknown;
  renderProjections: unknown;
  devtoolsPanels: unknown;
  renderers: unknown;
  readonly [key: string]: unknown;
}

export type ExtensionPointMap = DefaultExtensionPoints;

export interface PluginContext<
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = DefaultExtensionPoints,
> {
  readonly services: ServiceContainer;
  readonly commands: CommandRegistry;
  readonly events: EventBus<TEvents>;
  readonly routes: ExtensionRegistry<TExtensions["routes"]>;
  readonly registry: ExtensionRegistry<TExtensions["registry"]>;
  readonly workflows: ExtensionRegistry<TExtensions["workflows"]>;
  readonly theme: ExtensionRegistry<TExtensions["theme"]>;
  readonly statusBar: ExtensionRegistry<TExtensions["statusBar"]>;
  readonly appBar: ExtensionRegistry<TExtensions["appBar"]>;
  readonly menus: ExtensionRegistry<TExtensions["menus"]>;
  readonly keybindings: ExtensionRegistry<TExtensions["keybindings"]>;
  readonly dataAdapters: ExtensionRegistry<TExtensions["dataAdapters"]>;
  readonly persistenceAdapters: ExtensionRegistry<
    TExtensions["persistenceAdapters"]
  >;
  readonly operationExecutors: ExtensionRegistry<
    TExtensions["operationExecutors"]
  >;
  readonly devtools: ExtensionRegistry<TExtensions["devtools"]>;
  readonly components: ExtensionRegistry<TExtensions["components"]>;
  readonly editorProviders: ExtensionRegistry<TExtensions["editorProviders"]>;
  readonly editorCommands: ExtensionRegistry<TExtensions["editorCommands"]>;
  readonly logParsers: ExtensionRegistry<TExtensions["logParsers"]>;
  readonly themes: ExtensionRegistry<TExtensions["themes"]>;
  readonly formatAdapters: ExtensionRegistry<TExtensions["formatAdapters"]>;
  readonly renderProjections: ExtensionRegistry<
    TExtensions["renderProjections"]
  >;
  readonly devtoolsPanels: ExtensionRegistry<TExtensions["devtoolsPanels"]>;
  readonly renderers: ExtensionRegistry<TExtensions["renderers"]>;
  readonly capabilities: ReadonlySet<PluginCapability>;
  readonly signal: AbortSignal;
}

export interface Plugin<
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = DefaultExtensionPoints,
> {
  readonly id: string;
  readonly version: string;
  readonly dependsOn?: readonly string[];
  readonly requires?: {
    readonly capabilities?: readonly PluginCapability[];
  };
  readonly setup: (
    context: PluginContext<TEvents, TExtensions>,
  ) =>
    | undefined
    | Disposable
    | Disposer
    | Promise<undefined | Disposable | Disposer>;
}

export interface PluginRegistryEntry<
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = DefaultExtensionPoints,
> {
  readonly plugin: Plugin<TEvents, TExtensions>;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface PluginRegistryQuery {
  readonly capability?: PluginCapability;
  readonly tag?: string;
}

/**
 * Host-owned catalog for discovering plugins before they enter a PluginManager.
 * Resolution validates and orders the complete dependency graph.
 */
export class PluginRegistry<
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = DefaultExtensionPoints,
> {
  readonly #entries = new Map<
    string,
    PluginRegistryEntry<TEvents, TExtensions>
  >();

  register(entry: PluginRegistryEntry<TEvents, TExtensions>): Disposable {
    const { plugin } = entry;
    if (this.#entries.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already in the registry`);
    }
    const registered = Object.freeze({
      ...entry,
      tags: Object.freeze([...new Set(entry.tags ?? [])]),
    });
    this.#entries.set(plugin.id, registered);
    return {
      dispose: () => {
        if (this.#entries.get(plugin.id) === registered) {
          this.#entries.delete(plugin.id);
        }
      },
    };
  }

  get(id: string): PluginRegistryEntry<TEvents, TExtensions> | undefined {
    return this.#entries.get(id);
  }

  list(
    query: PluginRegistryQuery = {},
  ): readonly PluginRegistryEntry<TEvents, TExtensions>[] {
    return [...this.#entries.values()]
      .filter(
        (entry) =>
          (!query.tag || entry.tags?.includes(query.tag)) &&
          (!query.capability ||
            entry.plugin.requires?.capabilities?.includes(query.capability)),
      )
      .sort((left, right) => left.plugin.id.localeCompare(right.plugin.id));
  }

  resolve(ids: readonly string[]): readonly Plugin<TEvents, TExtensions>[] {
    const permanent = new Set<string>();
    const temporary = new Set<string>();
    const resolved: Plugin<TEvents, TExtensions>[] = [];
    const visit = (id: string, path: readonly string[]): void => {
      if (permanent.has(id)) return;
      if (temporary.has(id)) {
        throw new Error(
          `Plugin registry dependency cycle: ${[...path, id].join(" → ")}`,
        );
      }
      const entry = this.#entries.get(id);
      if (!entry) {
        const owner = path.at(-1);
        throw new Error(
          owner
            ? `Plugin "${owner}" depends on unavailable plugin "${id}"`
            : `Plugin "${id}" is not available in the registry`,
        );
      }
      temporary.add(id);
      for (const dependency of entry.plugin.dependsOn ?? []) {
        visit(dependency, [...path, id]);
      }
      temporary.delete(id);
      permanent.add(id);
      resolved.push(entry.plugin);
    };
    for (const id of ids) visit(id, []);
    return Object.freeze(resolved);
  }
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

export function createPlugin<
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = DefaultExtensionPoints,
>(plugin: Plugin<TEvents, TExtensions>): Plugin<TEvents, TExtensions> {
  if (!plugin.id.trim()) {
    throw new Error("Plugin id cannot be empty");
  }
  if (!plugin.version.trim()) {
    throw new Error(`Plugin "${plugin.id}" must declare a version`);
  }
  return Object.freeze(plugin);
}

interface PluginRecord<
  TEvents extends EventMap,
  TExtensions extends ExtensionPointMap,
> {
  readonly plugin: Plugin<TEvents, TExtensions>;
  status: PluginHealth["status"];
  error?: unknown;
  dispose?: Disposer;
}

export class PluginManager<
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = DefaultExtensionPoints,
> {
  readonly #records = new Map<string, PluginRecord<TEvents, TExtensions>>();
  readonly #initialized: string[] = [];
  readonly #context: Omit<PluginContext<TEvents, TExtensions>, "signal">;
  readonly #controller = new AbortController();
  #disposed = false;
  #disposePromise?: Promise<void>;

  constructor(context: Omit<PluginContext<TEvents, TExtensions>, "signal">) {
    this.#context = context;
  }

  register(plugin: Plugin<TEvents, TExtensions>): () => void {
    this.#assertActive();
    if (this.#records.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.#records.set(plugin.id, { plugin, status: "registered" });
    return () => {
      this.#assertActive();
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
    this.#assertActive();
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
    this.#disposePromise ??= this.#performDispose();
    await this.#disposePromise;
  }

  async #performDispose(): Promise<void> {
    this.#disposed = true;
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
    for (const record of this.#records.values()) {
      if (record.status !== "failed") record.status = "disposed";
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose plugins");
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("Plugin manager is disposed");
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
