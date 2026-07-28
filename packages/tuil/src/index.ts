import {
  CommandRegistry,
  type CommandRegistryChange,
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
  type EditorCommand,
  type EditorProvider,
  type EditorProviderOptions,
  EditorProviderRegistry,
  type EditorSession,
} from "@mwillbanks/tuil-editor";
import { textBufferProvider } from "@mwillbanks/tuil-editor/buffer";
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
  builtInLogParsers,
  type LogParser,
  LogPipeline,
} from "@mwillbanks/tuil-logging";
import {
  createPlugin,
  type DefaultExtensionPoints,
  type ExtensionPointMap,
  type ExtensionRegistry,
  type Plugin,
  type PluginCapability,
  PluginManager,
} from "@mwillbanks/tuil-plugin";
import { PointerRouter } from "@mwillbanks/tuil-pointer";
import {
  isRendererApplication,
  LayoutProjection,
  type RendererApplication,
  type RendererBackend,
  RendererRegistry,
  type ScreenOwnership,
} from "@mwillbanks/tuil-renderer";
import { ScrollManager } from "@mwillbanks/tuil-scroll";
import {
  builtInFormatParsers,
  builtInRenderProjections,
  type FormatParser,
  type RenderProjection,
  StreamingPipeline,
} from "@mwillbanks/tuil-streaming";
import {
  createTheme,
  defaultTheme,
  normalizeTheme,
  type Theme,
  ThemeController,
  type ThemeFactory,
} from "@mwillbanks/tuil-theme";
import {
  type ComponentType,
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
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

export interface TuilExtensionPoints extends DefaultExtensionPoints {
  readonly editorProviders: EditorProvider;
  readonly editorCommands: EditorCommand;
  readonly logParsers: LogParser;
  readonly themes: Theme | ThemeFactory;
  readonly formatAdapters: FormatParser;
  readonly renderProjections: RenderProjection;
  readonly renderers: RendererBackend;
  readonly components: RuntimeComponentContribution;
}

export interface RuntimeComponentContribution {
  readonly id: string;
  readonly component: ComponentType;
}

export type ExtensionRegistries<TExtensions extends ExtensionPointMap> = {
  readonly [TKey in keyof TExtensions]: ExtensionRegistry<TExtensions[TKey]>;
};

export type RuntimeStreamingPipelineOptions = NonNullable<
  ConstructorParameters<typeof StreamingPipeline>[0]
>;

export type RuntimeLogPipelineOptions = NonNullable<
  ConstructorParameters<typeof LogPipeline>[0]
>;

const emptyStreamingPipelineOptions = Object.freeze({});
const emptyLogPipelineOptions = Object.freeze({});
const emptyEditorSessionOptions = Object.freeze({});

function configuredEditorSession(
  runtime: TuilRuntime,
  options: EditorProviderOptions,
  providerId?: string,
): EditorSession {
  return runtime.editorProviders
    .resolve(providerId, {
      documentType: options.documentType,
      renderer: runtime.renderer?.id ?? "ink",
      input: runtime.mode === "interactive" ? "keyboard" : "none",
      staticMode: runtime.mode === "interactive" ? undefined : runtime.mode,
    })
    .create(options);
}

function configuredStreamingPipeline(
  runtime: TuilRuntime,
  options: RuntimeStreamingPipelineOptions,
): StreamingPipeline {
  return new StreamingPipeline({
    ...options,
    parsers: [
      ...builtInFormatParsers,
      ...(runtime.extensions.formatAdapters.values() as unknown as readonly FormatParser[]),
      ...(options.parsers ?? []),
    ],
    projections: [
      ...builtInRenderProjections,
      ...(runtime.extensions.renderProjections.values() as unknown as readonly RenderProjection[]),
      ...(options.projections ?? []),
    ],
  });
}

function configuredLogPipeline(
  runtime: TuilRuntime,
  options: RuntimeLogPipelineOptions,
): LogPipeline {
  return new LogPipeline({
    ...options,
    parsers: [
      ...builtInLogParsers,
      ...(runtime.extensions.logParsers.values() as unknown as readonly LogParser[]),
      ...(options.parsers ?? []),
    ],
  });
}

export interface TuilRuntime<
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = TuilExtensionPoints,
> {
  readonly id: string;
  readonly component: ComponentType | RendererApplication;
  readonly lifecycle: Lifecycle;
  readonly services: ServiceContainer;
  readonly commands: CommandRegistry;
  readonly events: EventBus<AppEventMap<TEvents>>;
  readonly focus: FocusManager;
  readonly hotkeys: HotkeyManager;
  readonly layout: LayoutProjection;
  readonly pointer: PointerRouter;
  readonly scroll: ScrollManager;
  readonly renderers: RendererRegistry;
  readonly renderer?: RendererBackend;
  readonly rendererApplication?: RendererApplication;
  readonly editorProviders: EditorProviderRegistry;
  readonly editorSessions: RuntimeResourceRegistry<EditorSession>;
  readonly logPipelines: RuntimeResourceRegistry<LogPipeline>;
  readonly streamingPipelines: RuntimeResourceRegistry<StreamingPipeline>;
  readonly plugins: {
    health(): readonly import("@mwillbanks/tuil-plugin").PluginHealth[];
  };
  readonly extensions: Readonly<ExtensionRegistries<TExtensions>>;
  readonly capabilities: TerminalCapabilities;
  readonly mode: RenderMode;
  readonly outputOwnership: ScreenOwnership;
  readonly theme: Theme;
  readonly themeController: ThemeController;
  readonly renderTelemetry: RuntimeRenderTelemetry;
  createEditorSession(
    options?: EditorProviderOptions,
    providerId?: string,
  ): EditorSession;
  executeEditorCommand(
    session: EditorSession,
    commandId: string,
    argument?: unknown,
  ): boolean | Promise<boolean>;
  createStreamingPipeline(
    options?: RuntimeStreamingPipelineOptions,
  ): StreamingPipeline;
  releaseStreamingPipeline(pipeline: StreamingPipeline): void;
  createLogPipeline(options?: RuntimeLogPipelineOptions): LogPipeline;
  releaseLogPipeline(pipeline: LogPipeline): void;
  resolveComponent(id: string): ComponentType | undefined;
  invalidate(): void;
  subscribeRender(observer: () => void): () => void;
  initialize(): Promise<void>;
  mount(): Promise<void>;
  ready(): Promise<void>;
  stop(): Promise<void>;
  reportError(error: unknown, phase: string): Promise<void>;
}

export interface RuntimeRenderSnapshot {
  readonly paused: boolean;
  readonly sequence: number;
  readonly renderer?: string;
  readonly durationMs?: number;
  readonly frame?: unknown;
  readonly output?: unknown;
  readonly timestamp?: number;
}

export class RuntimeRenderTelemetry {
  #snapshot: RuntimeRenderSnapshot = Object.freeze({
    paused: false,
    sequence: 0,
  });

  snapshot(): RuntimeRenderSnapshot {
    return this.#snapshot;
  }

  record(
    value: Omit<RuntimeRenderSnapshot, "paused" | "sequence">,
  ): RuntimeRenderSnapshot {
    this.#snapshot = Object.freeze({
      ...value,
      paused: this.#snapshot.paused,
      sequence: this.#snapshot.sequence + 1,
    });
    return this.#snapshot;
  }

  pause(): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, paused: true });
  }

  resume(): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, paused: false });
  }
}

export interface RuntimeResourceEntry<TValue> {
  readonly id: string;
  readonly value: TValue;
}

export class RuntimeResourceRegistry<TValue> {
  readonly #prefix: string;
  readonly #resources = new Map<string, TValue>();
  readonly #observers = new Set<() => void>();
  #sequence = 0;

  constructor(prefix: string) {
    this.#prefix = prefix;
  }

  register(value: TValue): RuntimeResourceEntry<TValue> {
    const entry = Object.freeze({
      id: `${this.#prefix}-${++this.#sequence}`,
      value,
    });
    this.#resources.set(entry.id, value);
    this.#notify();
    return entry;
  }

  unregister(id: string): void {
    if (!this.#resources.delete(id)) return;
    this.#notify();
  }

  unregisterValue(value: TValue): void {
    for (const [id, candidate] of this.#resources) {
      if (candidate !== value) continue;
      this.unregister(id);
      return;
    }
  }

  entries(): readonly RuntimeResourceEntry<TValue>[] {
    return Object.freeze(
      [...this.#resources].map(([id, value]) => Object.freeze({ id, value })),
    );
  }

  values(): readonly TValue[] {
    return Object.freeze([...this.#resources.values()]);
  }

  observe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  clear(): void {
    if (this.#resources.size === 0) return;
    this.#resources.clear();
    this.#notify();
  }

  #notify(): void {
    for (const observer of this.#observers) {
      try {
        observer();
      } catch {
        // Resource observers are diagnostic consumers and must not unwind a
        // completed registry mutation or prevent other observers from running.
      }
    }
  }
}

function trackEditorSession(
  registry: RuntimeResourceRegistry<EditorSession>,
  session: EditorSession,
): EditorSession {
  let disposed = false;
  let id = "";
  const tracked = new Proxy(session, {
    get(target, property) {
      if (property === "dispose") {
        return () => {
          if (disposed) return;
          disposed = true;
          try {
            target.dispose();
          } finally {
            registry.unregister(id);
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  id = registry.register(tracked).id;
  return tracked;
}

export type ErrorHandler = (
  error: unknown,
  context: { readonly phase: string; readonly app: TuilRuntime },
) => void | Promise<void>;

export interface TerminalOptions extends TerminalCapabilityInput {
  readonly mode?: RenderMode;
  readonly capabilities?: Partial<TerminalCapabilities>;
  readonly ownership?: ScreenOwnership;
}

export type ServiceInput<TValue = unknown> =
  | TValue
  | ServiceDefinition<string, TValue>;

export interface TuilAppOptions<
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = TuilExtensionPoints,
> {
  readonly id?: string;
  readonly component: ComponentType | RendererApplication;
  readonly theme?: Theme | ThemeFactory;
  readonly plugins?: readonly Plugin<AppEventMap<TEvents>, TExtensions>[];
  readonly capabilities?: readonly PluginCapability[];
  readonly services?: {
    readonly [TKey in keyof TServices]: ServiceInput<TServices[TKey]>;
  };
  readonly events?: EventDefinitions<TEvents>;
  readonly errorHandler?: ErrorHandler;
  readonly terminal?: TerminalOptions;
  /** Backends available to the application. The selected id must be registered. */
  readonly renderers?: readonly RendererBackend[];
  readonly renderer?: string;
}

export interface TuilConfig {
  readonly renderer: "ink" | "cell";
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

function selectRenderer(
  registry: RendererRegistry,
  options: Pick<TuilAppOptions, "renderer" | "renderers">,
): RendererBackend | undefined {
  for (const backend of options.renderers ?? []) {
    registry.register(backend, { default: backend.id === options.renderer });
  }
  return options.renderers?.length
    ? registry.resolve(options.renderer)
    : undefined;
}

function selectTheme(
  option: Theme | ThemeFactory | undefined,
  capabilities: TerminalCapabilities,
): Theme {
  const selected =
    typeof option === "function"
      ? option(defaultTheme)
      : (option ?? defaultTheme);
  return normalizeTheme(selected, capabilities);
}

function createExtensionRegistries<
  TExtensions extends ExtensionPointMap,
>(): ExtensionRegistries<TExtensions> {
  return {
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
    components: new MemoryExtensionRegistry(),
    editorProviders: new MemoryExtensionRegistry(),
    editorCommands: new MemoryExtensionRegistry(),
    logParsers: new MemoryExtensionRegistry(),
    themes: new MemoryExtensionRegistry(),
    formatAdapters: new MemoryExtensionRegistry(),
    renderProjections: new MemoryExtensionRegistry(),
    devtoolsPanels: new MemoryExtensionRegistry(),
    renderers: new MemoryExtensionRegistry(),
  } as unknown as ExtensionRegistries<TExtensions>;
}

function registerConfiguredServices(
  container: ServiceContainer,
  services: Readonly<Record<string, ServiceInput>> | undefined,
): void {
  for (const [id, service] of Object.entries(services ?? {})) {
    const definition =
      service &&
      typeof service === "object" &&
      "id" in service &&
      "create" in service;
    if (definition) container.register(service as ServiceDefinition);
    else container.register(id, service);
  }
}

async function collectFailure(
  errors: unknown[],
  operation: () => void | Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    errors.push(error);
  }
}

export function defineConfig(config: TuilConfig): TuilConfig {
  return Object.freeze(config);
}

class MemoryExtensionRegistry<TValue> implements ExtensionRegistry<TValue> {
  readonly #registrations = new Map<symbol, TValue>();
  readonly #observers = new Set<() => void>();
  #snapshot: readonly TValue[] = Object.freeze([]);

  register(value: TValue) {
    const registration = Symbol();
    this.#registrations.set(registration, value);
    this.#snapshot = Object.freeze([...this.#registrations.values()]);
    this.#notify();
    return toDisposable(() => {
      if (this.#registrations.delete(registration)) {
        this.#snapshot = Object.freeze([...this.#registrations.values()]);
        this.#notify();
      }
    });
  }

  values(): readonly TValue[] {
    return this.#snapshot;
  }

  observe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  #notify(): void {
    for (const observer of this.#observers) observer();
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
  TExtensions extends ExtensionPointMap = TuilExtensionPoints,
> {
  readonly id: string;
  readonly component: ComponentType | RendererApplication;
  readonly lifecycle = new Lifecycle();
  readonly services = new ServiceContainer();
  readonly events: EventBus<AppEventMap<TEvents>>;
  readonly commands = new CommandRegistry(this.services);
  readonly focus = new FocusManager();
  readonly hotkeys = new HotkeyManager();
  readonly layout = new LayoutProjection();
  readonly pointer = new PointerRouter(this.layout, {
    focus: (id) => this.focus.focus(id),
  });
  readonly scroll = new ScrollManager();
  readonly renderers = new RendererRegistry();
  readonly #rendererId?: string;
  readonly rendererApplication?: RendererApplication;
  readonly editorProviders = new EditorProviderRegistry();
  readonly editorSessions = new RuntimeResourceRegistry<EditorSession>(
    "editor-session",
  );
  readonly logPipelines = new RuntimeResourceRegistry<LogPipeline>(
    "log-pipeline",
  );
  readonly streamingPipelines = new RuntimeResourceRegistry<StreamingPipeline>(
    "streaming-pipeline",
  );
  readonly capabilities: TerminalCapabilities;
  readonly mode: RenderMode;
  readonly outputOwnership: ScreenOwnership;
  readonly themeController: ThemeController;
  readonly renderTelemetry = new RuntimeRenderTelemetry();
  readonly plugins: PluginManager<AppEventMap<TEvents>, TExtensions>;
  readonly extensions: Readonly<ExtensionRegistries<TExtensions>>;
  readonly #errorHandler?: ErrorHandler;
  readonly #commandBindings = new Map<string, readonly (() => void)[]>();
  readonly #editorRegistrations = new Map<
    EditorProvider,
    { dispose(): void }
  >();
  readonly #rendererRegistrations = new Map<RendererBackend, () => void>();
  readonly #baseTheme: Theme;
  readonly #builtinEditorRegistrations: readonly { dispose(): void }[];
  readonly #extensionObservers: (() => void)[] = [];
  readonly #renderObservers = new Set<() => void>();
  readonly #commandRegistryObserver: { dispose(): void | Promise<void> };
  #initialized = false;
  #initializePromise?: Promise<void>;
  #stopPromise?: Promise<void>;

  constructor(options: TuilAppOptions<TServices, TEvents, TExtensions>) {
    this.#errorHandler = options.errorHandler;
    this.#builtinEditorRegistrations = [
      this.editorProviders.register(textBufferProvider, { default: true }),
    ];
    this.id = options.id ?? crypto.randomUUID();
    this.component = options.component;
    this.rendererApplication = isRendererApplication(options.component)
      ? options.component
      : undefined;
    this.capabilities = Object.freeze({
      ...detectTerminalCapabilities(options.terminal),
      ...options.terminal?.capabilities,
    });
    this.mode = resolveRenderMode(options.terminal?.mode, this.capabilities);
    this.outputOwnership =
      options.terminal?.ownership ??
      (this.mode !== "interactive"
        ? "inline"
        : this.capabilities.alternateScreen
          ? "alternate"
          : "main");
    selectRenderer(this.renderers, options);
    this.#rendererId = options.renderer;
    this.#baseTheme = selectTheme(options.theme, this.capabilities);
    this.themeController = new ThemeController(
      this.#baseTheme,
      this.capabilities,
    );
    this.events = new EventBus<AppEventMap<TEvents>>({
      ...lifecycleDefinitions,
      ...options.events,
    } as EventDefinitions<AppEventMap<TEvents>>);
    const extensions = createExtensionRegistries<TExtensions>();
    this.extensions = extensions;
    this.#extensionObservers.push(
      extensions.editorProviders.observe(() => this.#syncEditorProviders()),
      extensions.themes.observe(() => this.#syncPluginTheme()),
      extensions.renderers.observe(() => this.#syncRenderers()),
    );
    this.plugins = new PluginManager({
      services: this.services,
      commands: this.commands,
      events: this.events,
      ...extensions,
      capabilities: new Set(options.capabilities ?? []),
    });
    this.#commandRegistryObserver = this.commands.observeRegistry((change) =>
      this.#handleCommandRegistration(change),
    );
    registerConfiguredServices(this.services, options.services);
    for (const plugin of options.plugins ?? []) this.plugins.register(plugin);
  }

  get theme(): Theme {
    return this.themeController.get();
  }

  get renderer(): RendererBackend | undefined {
    if (this.renderers.list().length === 0) return undefined;
    return this.renderers.resolve(this.#rendererId);
  }

  resolveComponent(id: string): ComponentType | undefined {
    return (
      this.extensions.components.values() as unknown as readonly RuntimeComponentContribution[]
    ).find((entry) => entry.id === id)?.component;
  }

  #handleCommandRegistration(change: CommandRegistryChange): void {
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
  }

  createEditorSession(
    options: EditorProviderOptions = {},
    providerId?: string,
  ): EditorSession {
    const session = configuredEditorSession(
      this as unknown as TuilRuntime,
      options,
      providerId,
    );
    return trackEditorSession(this.editorSessions, session);
  }

  executeEditorCommand(
    session: EditorSession,
    commandId: string,
    argument?: unknown,
  ): boolean | Promise<boolean> {
    const command = (
      this.extensions.editorCommands.values() as unknown as readonly EditorCommand[]
    ).find((candidate) => candidate.id === commandId);
    if (!command)
      throw new Error(`Editor command "${commandId}" is unavailable`);
    return session.execute(command, argument);
  }

  createStreamingPipeline(
    options: RuntimeStreamingPipelineOptions = {},
  ): StreamingPipeline {
    const pipeline = configuredStreamingPipeline(
      this as unknown as TuilRuntime,
      options,
    );
    this.streamingPipelines.register(pipeline);
    return pipeline;
  }

  releaseStreamingPipeline(pipeline: StreamingPipeline): void {
    this.streamingPipelines.unregisterValue(pipeline);
  }

  createLogPipeline(options: RuntimeLogPipelineOptions = {}): LogPipeline {
    const pipeline = configuredLogPipeline(
      this as unknown as TuilRuntime,
      options,
    );
    this.logPipelines.register(pipeline);
    return pipeline;
  }

  releaseLogPipeline(pipeline: LogPipeline): void {
    this.logPipelines.unregisterValue(pipeline);
  }

  invalidate(): void {
    if (this.renderTelemetry.snapshot().paused) return;
    for (const observer of this.#renderObservers) observer();
  }

  subscribeRender(observer: () => void): () => void {
    this.#renderObservers.add(observer);
    return () => this.#renderObservers.delete(observer);
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
      this.#syncEditorProviders();
      this.#syncPluginTheme();
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
      await collectFailure(errors, () => this.lifecycle.transition("stopping"));
      await collectFailure(errors, async () => {
        await this.events.emit("app:stop", {
          appId: this.id,
          state: "stopping",
          previousState,
        });
      });
    }
    await collectFailure(errors, () => this.plugins.dispose());
    await collectFailure(errors, () => this.services.dispose());
    await collectFailure(errors, () => this.#disposeRuntimeRegistrations());
    const previousState = this.lifecycle.state;
    await collectFailure(errors, () => this.lifecycle.transition("disposed"));
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

  async #disposeRuntimeRegistrations(): Promise<void> {
    const errors: unknown[] = [];
    await collectFailure(errors, () => this.#commandRegistryObserver.dispose());
    for (const bindings of this.#commandBindings.values()) {
      for (const dispose of bindings) {
        await collectFailure(errors, dispose);
      }
    }
    this.#commandBindings.clear();
    for (const registration of this.#editorRegistrations.values()) {
      await collectFailure(errors, () => registration.dispose());
    }
    this.#editorRegistrations.clear();
    for (const registration of this.#builtinEditorRegistrations) {
      await collectFailure(errors, () => registration.dispose());
    }
    for (const session of this.editorSessions.values()) {
      await collectFailure(errors, () => session.dispose());
    }
    this.editorSessions.clear();
    this.logPipelines.clear();
    this.streamingPipelines.clear();
    for (const dispose of this.#extensionObservers.splice(0)) {
      await collectFailure(errors, dispose);
    }
    this.#renderObservers.clear();
    if (errors.length > 0) {
      throw new AggregateError(errors, "Runtime registration disposal failed");
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
      await this.#errorHandler?.(error, {
        phase,
        app: this as unknown as TuilRuntime,
      });
    } catch (handlerError) {
      failures.push(handlerError);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Application error handlers failed");
    }
  }

  #syncEditorProviders(): void {
    const active = new Set(
      this.extensions.editorProviders.values() as unknown as readonly EditorProvider[],
    );
    for (const [provider, registration] of this.#editorRegistrations) {
      if (!active.has(provider)) {
        registration.dispose();
        this.#editorRegistrations.delete(provider);
      }
    }
    for (const provider of active) {
      if (!this.#editorRegistrations.has(provider)) {
        this.#editorRegistrations.set(
          provider,
          this.editorProviders.register(provider),
        );
      }
    }
  }

  #syncPluginTheme(): void {
    const contributions =
      this.extensions.themes.values() as unknown as readonly (
        | Theme
        | ThemeFactory
      )[];
    const theme = contributions.reduce<Theme>(
      (current, contribution) =>
        typeof contribution === "function"
          ? contribution(current)
          : contribution,
      this.#baseTheme,
    );
    this.themeController.set(theme);
  }

  #syncRenderers(): void {
    const active = new Set(
      this.extensions.renderers.values() as unknown as readonly RendererBackend[],
    );
    for (const [renderer, dispose] of this.#rendererRegistrations) {
      if (active.has(renderer)) continue;
      dispose();
      this.#rendererRegistrations.delete(renderer);
    }
    for (const renderer of active) {
      if (this.#rendererRegistrations.has(renderer)) continue;
      this.#rendererRegistrations.set(
        renderer,
        this.renderers.register(renderer),
      );
    }
  }
}

export function createApp<
  const TServices extends Record<string, unknown> = Record<string, never>,
  const TEvents extends EventMap = Record<string, never>,
  const TExtensions extends ExtensionPointMap = TuilExtensionPoints,
>(
  options: TuilAppOptions<TServices, TEvents, TExtensions>,
): TuilApp<TServices, TEvents, TExtensions> {
  return new TuilApp<TServices, TEvents, TExtensions>(options);
}

const RuntimeContext = createContext<TuilRuntime | undefined>(undefined);

export function TuilRuntimeProvider<
  TEvents extends EventMap,
  TExtensions extends ExtensionPointMap,
>(props: {
  readonly app: TuilRuntime<TEvents, TExtensions>;
  readonly children?: ReactNode;
}): ReactNode {
  return createElement(
    RuntimeContext.Provider,
    { value: props.app as unknown as TuilRuntime },
    props.children,
  );
}

export function useApp<
  TEvents extends EventMap = EventMap,
  TExtensions extends ExtensionPointMap = TuilExtensionPoints,
>(): TuilRuntime<TEvents, TExtensions> {
  const app = useContext(RuntimeContext);
  if (!app) {
    throw new Error("useApp must be called within the tuil renderer");
  }
  return app as TuilRuntime<TEvents, TExtensions>;
}

export function useStreamingPipeline(
  options: RuntimeStreamingPipelineOptions = emptyStreamingPipelineOptions,
): StreamingPipeline {
  const app = useApp();
  const pipeline = useMemo(
    () => configuredStreamingPipeline(app, options),
    [app, options],
  );
  useEffect(() => {
    const entry = app.streamingPipelines.register(pipeline);
    return () => app.streamingPipelines.unregister(entry.id);
  }, [app.streamingPipelines, pipeline]);
  return pipeline;
}

export function useEditorSession(
  options: EditorProviderOptions = emptyEditorSessionOptions,
  providerId?: string,
): EditorSession {
  const app = useApp();
  const session = useMemo(
    () => configuredEditorSession(app, options, providerId),
    [app, options, providerId],
  );
  useEffect(() => {
    const entry = app.editorSessions.register(session);
    return () => {
      try {
        session.dispose();
      } finally {
        app.editorSessions.unregister(entry.id);
      }
    };
  }, [app.editorSessions, session]);
  return session;
}

export function useLogPipeline(
  options: RuntimeLogPipelineOptions = emptyLogPipelineOptions,
): LogPipeline {
  const app = useApp();
  const pipeline = useMemo(
    () => configuredLogPipeline(app, options),
    [app, options],
  );
  useEffect(() => {
    const entry = app.logPipelines.register(pipeline);
    return () => app.logPipelines.unregister(entry.id);
  }, [app.logPipelines, pipeline]);
  return pipeline;
}

export function useExtensions<
  TExtensions extends ExtensionPointMap = TuilExtensionPoints,
  TKey extends keyof TExtensions = keyof TExtensions,
>(key: TKey): readonly TExtensions[TKey][] {
  const registry = useApp<EventMap, TExtensions>().extensions[key];
  return useSyncExternalStore(
    (observer) => registry.observe(observer),
    () => registry.values(),
    () => registry.values(),
  );
}

export function useService<TValue>(id: string): TValue {
  return useApp().services.get<TValue>(id);
}
