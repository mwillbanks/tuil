import {
  CommandRegistry,
  detectTerminalCapabilities,
  Lifecycle,
  type RenderMode,
  resolveRenderMode,
  ServiceContainer,
  type ServiceDefinition,
  type TerminalCapabilities,
  type TerminalCapabilityInput,
  toDisposable,
} from "@mwillbanks/tuil-core";
import {
  defineEvents,
  EventBus,
  type EventDefinition,
  type EventDefinitions,
  type EventMap,
  event,
} from "@mwillbanks/tuil-events";
import { FocusManager } from "@mwillbanks/tuil-focus";
import { HotkeyManager } from "@mwillbanks/tuil-hotkeys";
import {
  createPlugin,
  type ExtensionRegistry,
  type Plugin,
  type PluginCapability,
  PluginManager,
} from "@mwillbanks/tuil-plugin";
import {
  createTheme,
  defaultTheme,
  normalizeTheme,
  type Theme,
  type ThemeFactory,
} from "@mwillbanks/tuil-theme";
import {
  type ComponentType,
  createContext,
  createElement,
  type ReactNode,
  useContext,
} from "react";

export * from "@mwillbanks/tuil-core";
export type { ObservedEvent } from "@mwillbanks/tuil-events";
export type {
  OperationDefinition,
  OperationProgress,
  OperationSnapshot,
  OperationStatus,
} from "@mwillbanks/tuil-operations";
export {
  createOperation,
  defineOperation,
  OperationExecutor,
} from "@mwillbanks/tuil-operations";
export type {
  NavigationEntry,
  NavigationSurface,
  NavigationTarget,
  RouteDefinition,
  RouteMatch,
  RouterEvent,
  RouterState,
} from "@mwillbanks/tuil-router";
export {
  createRouter,
  defineRoutes,
  route,
  TerminalRouter,
} from "@mwillbanks/tuil-router";
export type {
  PersistedWorkflow,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowSnapshot,
  WorkflowStatus,
  WorkflowStep,
} from "@mwillbanks/tuil-workflow";
export {
  createWorkflow,
  defineOperationStep,
  defineStep,
  defineWorkflow,
  transition,
  WorkflowRunner,
} from "@mwillbanks/tuil-workflow";
export type {
  EventDefinition,
  EventDefinitions,
  EventMap,
  Plugin,
  PluginCapability,
  RenderMode,
  Theme,
  ThemeFactory,
};
export { createPlugin, createTheme, defineEvents, event };

export interface AppLifecyclePayload {
  readonly appId: string;
  readonly state: string;
  readonly previousState?: string;
}

export interface AppErrorPayload {
  readonly appId: string;
  readonly error: unknown;
  readonly phase: string;
}

export type AppLifecycleEvents = {
  "app:configure": AppLifecyclePayload;
  "app:initialize": AppLifecyclePayload;
  "app:mount": AppLifecyclePayload;
  "app:ready": AppLifecyclePayload;
  "app:error": AppErrorPayload;
  "app:stop": AppLifecyclePayload;
  "app:dispose": AppLifecyclePayload;
};

export type AppEventMap<TEvents extends EventMap> = {
  [TKey in
    | keyof TEvents
    | keyof AppLifecycleEvents]: TKey extends keyof AppLifecycleEvents
    ? AppLifecycleEvents[TKey]
    : TKey extends keyof TEvents
      ? TEvents[TKey]
      : never;
};

export interface TuilRuntime {
  readonly id: string;
  readonly component: ComponentType;
  readonly lifecycle: Lifecycle;
  readonly services: ServiceContainer;
  readonly commands: CommandRegistry;
  readonly events: {
    observe(
      observer: (
        event: import("@mwillbanks/tuil-events").ObservedEvent,
      ) => void,
    ): () => void;
    history(): readonly import("@mwillbanks/tuil-events").ObservedEvent[];
  };
  readonly focus: FocusManager;
  readonly hotkeys: HotkeyManager;
  readonly plugins: {
    health(): readonly import("@mwillbanks/tuil-plugin").PluginHealth[];
  };
  readonly extensions: Readonly<
    Record<string, { values(): readonly unknown[] }>
  >;
  readonly capabilities: TerminalCapabilities;
  readonly mode: RenderMode;
  readonly theme: Theme;
  initialize(): Promise<void>;
  mount(): Promise<void>;
  ready(): Promise<void>;
  stop(): Promise<void>;
  reportError(error: unknown, phase: string): Promise<void>;
}

export type ErrorHandler = (
  error: unknown,
  context: { readonly phase: string; readonly app: TuilRuntime },
) => void | Promise<void>;

export interface TerminalOptions extends TerminalCapabilityInput {
  readonly mode?: RenderMode;
  readonly capabilities?: Partial<TerminalCapabilities>;
}

export type ServiceInput<TValue = unknown> =
  | TValue
  | ServiceDefinition<string, TValue>;

export interface TuilAppOptions<
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TEvents extends EventMap = EventMap,
> {
  readonly id?: string;
  readonly component: ComponentType;
  readonly theme?: Theme | ThemeFactory;
  readonly plugins?: readonly Plugin<AppEventMap<TEvents>>[];
  readonly capabilities?: readonly PluginCapability[];
  readonly services?: {
    readonly [TKey in keyof TServices]: ServiceInput<TServices[TKey]>;
  };
  readonly events?: EventDefinitions<TEvents>;
  readonly errorHandler?: ErrorHandler;
  readonly terminal?: TerminalOptions;
}

export interface TuilConfig {
  readonly renderer: "ink";
  readonly paths: {
    readonly components: string;
    readonly utilities: string;
    readonly hooks: string;
  };
  readonly registry: {
    readonly sources: readonly (
      | string
      | { readonly id: string; readonly url: string }
    )[];
  };
  readonly theme: {
    readonly preset: string;
  };
  readonly packageManager: "bun";
}

export function defineConfig(config: TuilConfig): TuilConfig {
  return Object.freeze(config);
}

class MemoryExtensionRegistry implements ExtensionRegistry {
  readonly #values = new Set<unknown>();

  register(value: unknown) {
    this.#values.add(value);
    return toDisposable(() => {
      this.#values.delete(value);
    });
  }

  values(): readonly unknown[] {
    return [...this.#values];
  }
}

const lifecycleDefinitions = defineEvents<AppLifecycleEvents>({
  "app:configure": event<AppLifecyclePayload>(),
  "app:initialize": event<AppLifecyclePayload>(),
  "app:mount": event<AppLifecyclePayload>(),
  "app:ready": event<AppLifecyclePayload>(),
  "app:error": event<AppErrorPayload>({
    redact: ({ appId, phase, error }) => ({
      appId,
      phase,
      error: error instanceof Error ? error.message : String(error),
    }),
  }),
  "app:stop": event<AppLifecyclePayload>(),
  "app:dispose": event<AppLifecyclePayload>(),
});

export class TuilApp<
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TEvents extends EventMap = EventMap,
> {
  readonly id: string;
  readonly component: ComponentType;
  readonly lifecycle = new Lifecycle();
  readonly services = new ServiceContainer();
  readonly events: EventBus<AppEventMap<TEvents>>;
  readonly commands = new CommandRegistry(this.services);
  readonly focus = new FocusManager();
  readonly hotkeys = new HotkeyManager();
  readonly capabilities: TerminalCapabilities;
  readonly mode: RenderMode;
  readonly theme: Theme;
  readonly plugins: PluginManager<AppEventMap<TEvents>>;
  readonly extensions: Readonly<Record<string, MemoryExtensionRegistry>>;
  readonly #errorHandler?: ErrorHandler;
  readonly #commandBindings = new Map<string, readonly (() => void)[]>();
  readonly #commandRegistryObserver: { dispose(): void | Promise<void> };
  #initialized = false;
  #initializePromise?: Promise<void>;
  #stopPromise?: Promise<void>;

  constructor(options: TuilAppOptions<TServices, TEvents>) {
    this.#errorHandler = options.errorHandler;
    this.id = options.id ?? crypto.randomUUID();
    this.component = options.component;
    this.capabilities = Object.freeze({
      ...detectTerminalCapabilities(options.terminal),
      ...options.terminal?.capabilities,
    });
    this.mode = resolveRenderMode(options.terminal?.mode, this.capabilities);
    const selectedTheme =
      typeof options.theme === "function"
        ? options.theme(defaultTheme)
        : (options.theme ?? defaultTheme);
    this.theme = normalizeTheme(selectedTheme, this.capabilities);
    this.events = new EventBus<AppEventMap<TEvents>>({
      ...lifecycleDefinitions,
      ...options.events,
    } as EventDefinitions<AppEventMap<TEvents>>);
    const extensions = {
      routes: new MemoryExtensionRegistry(),
      registry: new MemoryExtensionRegistry(),
      workflows: new MemoryExtensionRegistry(),
      theme: new MemoryExtensionRegistry(),
      statusBar: new MemoryExtensionRegistry(),
      appBar: new MemoryExtensionRegistry(),
      menus: new MemoryExtensionRegistry(),
      keybindings: new MemoryExtensionRegistry(),
      dataAdapters: new MemoryExtensionRegistry(),
      persistenceAdapters: new MemoryExtensionRegistry(),
      operationExecutors: new MemoryExtensionRegistry(),
      devtools: new MemoryExtensionRegistry(),
    };
    this.extensions = extensions;
    this.plugins = new PluginManager({
      services: this.services,
      commands: this.commands,
      events: this.events,
      ...extensions,
      capabilities: new Set(options.capabilities ?? []),
    });
    this.#commandRegistryObserver = this.commands.observeRegistry((change) => {
      if (change.type === "unregistered") {
        for (const dispose of this.#commandBindings.get(change.command.id) ??
          []) {
          dispose();
        }
        this.#commandBindings.delete(change.command.id);
        return;
      }
      const bindings = (change.command.hotkeys ?? []).map((keys) =>
        this.hotkeys.register({
          keys,
          scope: change.command.hotkeyScope ?? "application",
          scopeId: change.command.hotkeyScopeId,
          title: change.command.title,
          description: change.command.description,
          category: change.command.category,
          commandId: change.command.id,
          visibleInHelp: true,
          handler: () =>
            this.commands.execute(change.command.id, {
              source: `hotkey:${keys}`,
            }),
        }),
      );
      this.#commandBindings.set(change.command.id, bindings);
    });
    for (const [id, service] of Object.entries(options.services ?? {})) {
      if (
        service &&
        typeof service === "object" &&
        "id" in service &&
        "create" in service
      ) {
        this.services.register(service as ServiceDefinition);
      } else {
        this.services.register(id, service);
      }
    }
    for (const plugin of options.plugins ?? []) {
      this.plugins.register(plugin);
    }
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }
    this.#initializePromise ??= this.#performInitialize();
    await this.#initializePromise;
  }

  async #performInitialize(): Promise<void> {
    try {
      await this.#transition("configuring", "app:configure");
      await this.#transition("initializing", "app:initialize");
      await this.services.initialize();
      await this.plugins.initialize();
      this.#initialized = true;
    } catch (error) {
      const failures: unknown[] = [error];
      try {
        await this.#handleError(error, this.lifecycle.state);
      } catch (handlerError) {
        failures.push(handlerError);
      }
      try {
        await this.stop();
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
      if (failures.length === 1) {
        throw error;
      }
      throw new AggregateError(
        failures,
        "Application initialization and rollback failed",
      );
    }
  }

  async mount(): Promise<void> {
    await this.initialize();
    if (this.lifecycle.state === "initializing") {
      await this.#transition("mounting", "app:mount");
    }
  }

  async ready(): Promise<void> {
    await this.mount();
    if (this.lifecycle.state === "mounting") {
      await this.#transition("ready", "app:ready");
    }
  }

  async stop(): Promise<void> {
    if (this.lifecycle.state === "disposed") {
      return;
    }
    this.#stopPromise ??= this.#performStop();
    await this.#stopPromise;
  }

  async reportError(error: unknown, phase: string): Promise<void> {
    await this.#handleError(error, phase);
  }

  async #performStop(): Promise<void> {
    const errors: unknown[] = [];
    if (this.lifecycle.state !== "stopping") {
      const previousState = this.lifecycle.state;
      try {
        this.lifecycle.transition("stopping");
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.events.emit("app:stop", {
          appId: this.id,
          state: "stopping",
          previousState,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await this.plugins.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.services.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#commandRegistryObserver.dispose();
      for (const bindings of this.#commandBindings.values()) {
        for (const dispose of bindings) dispose();
      }
      this.#commandBindings.clear();
    } catch (error) {
      errors.push(error);
    }
    const previousState = this.lifecycle.state;
    try {
      this.lifecycle.transition("disposed");
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.events.emit("app:dispose", {
        appId: this.id,
        state: "disposed",
        previousState,
      });
    } catch (error) {
      errors.push(error);
    } finally {
      this.events.dispose();
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Application disposal failed");
    }
  }

  async #transition(
    state: Parameters<Lifecycle["transition"]>[0],
    eventType: keyof AppLifecycleEvents,
  ): Promise<void> {
    const previousState = this.lifecycle.state;
    this.lifecycle.transition(state);
    await this.events.emit(eventType, {
      appId: this.id,
      state,
      previousState,
    } as AppEventMap<TEvents>[typeof eventType]);
  }

  async #handleError(error: unknown, phase: string): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.events.emit("app:error", { appId: this.id, error, phase });
    } catch (eventError) {
      failures.push(eventError);
    }
    try {
      await this.#errorHandler?.(error, { phase, app: this });
    } catch (handlerError) {
      failures.push(handlerError);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Application error handlers failed");
    }
  }
}

export function createApp<
  const TServices extends Record<string, unknown> = Record<string, never>,
  const TEvents extends EventMap = Record<string, never>,
>(options: TuilAppOptions<TServices, TEvents>): TuilApp<TServices, TEvents> {
  return new TuilApp(options);
}

const RuntimeContext = createContext<TuilRuntime | undefined>(undefined);

export function TuilRuntimeProvider(props: {
  readonly app: TuilRuntime;
  readonly children?: ReactNode;
}): ReactNode {
  return createElement(
    RuntimeContext.Provider,
    { value: props.app },
    props.children,
  );
}

export function useApp(): TuilRuntime {
  const app = useContext(RuntimeContext);
  if (!app) {
    throw new Error("useApp must be called within the tuil renderer");
  }
  return app;
}

export function useService<TValue>(id: string): TValue {
  return useApp().services.get<TValue>(id);
}
