import { type ObservedEvent, type TuilRuntime, useApp } from "@mwillbanks/tuil";
import {
  Box,
  Text,
  usePointerEvent,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import type { Key } from "ink";
import {
  createElement,
  type FunctionComponent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type BuiltInDevtoolsActionId,
  type BuiltInDevtoolsPanelId,
  builtInDevtoolsActionIds,
  createBuiltInDevtoolsPanels,
  createDevtoolsAction,
  type DevtoolsExtension,
  DevtoolsExtensionRegistry,
  DevtoolsWorkspace,
} from "./extensions.ts";

export * from "./extensions.ts";

export const devtoolsPanels = Object.freeze([
  "Events",
  "Commands",
  "Routes",
  "Focus",
  "Layout",
  "Pointer",
  "Hotkeys",
  "Plugins",
  "Workflows",
  "Operations",
  "Services",
  "Theme",
  "Terminal capabilities",
  "Performance",
] as const);

export type DevtoolsPanel = (typeof devtoolsPanels)[number];

export interface RuntimeInspection {
  readonly panel: DevtoolsPanel;
  readonly rows: readonly string[];
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "function") return value.name || "function";
  if (typeof value !== "object") return String(value);
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of ["id", "name", "title", "status", "path"]) {
    if (typeof record[key] === "string") return record[key];
  }
  return value.constructor?.name ?? "object";
}

function extensionRows(runtime: TuilRuntime, key: string): readonly string[] {
  return (runtime.extensions[key]?.values() ?? []).map(describeValue);
}

export function inspectRuntime(
  runtime: TuilRuntime,
  panel: DevtoolsPanel,
  events: readonly ObservedEvent[] = [],
): RuntimeInspection {
  let rows: readonly string[];
  switch (panel) {
    case "Events":
      rows = events.map(
        (event) =>
          `${new Date(event.timestamp).toISOString()} ${event.type} [${event.priority}]`,
      );
      break;
    case "Commands":
      rows = runtime.commands
        .list()
        .map((command) => `${command.id} — ${command.title}`);
      break;
    case "Routes":
      rows = extensionRows(runtime, "routes");
      break;
    case "Focus":
      rows = runtime.focus
        .nodes()
        .map(
          (node) =>
            `${node.id}${node.id === runtime.focus.focusedId ? " (focused)" : ""}${node.label ? ` — ${node.label}` : ""}`,
        );
      break;
    case "Layout":
      rows = runtime.layout
        .nodes()
        .map(
          (node) =>
            `${node.id} ${node.bounds.x},${node.bounds.y} ${node.bounds.width}x${node.bounds.height} z=${node.zIndex}`,
        );
      break;
    case "Pointer":
      rows = [
        `mouse: ${runtime.capabilities.mouse ? "enabled" : "keyboard fallback"}`,
        `hit regions: ${runtime.layout.nodes().filter((node) => node.pointerEvents === "auto").length}`,
      ];
      break;
    case "Hotkeys":
      rows = runtime.hotkeys
        .list()
        .map(
          (hotkey) =>
            `${hotkey.keys} → ${hotkey.commandId ?? hotkey.title ?? "handler"}`,
        );
      break;
    case "Plugins":
      rows = runtime.plugins
        .health()
        .map((plugin) => `${plugin.id}@${plugin.version} — ${plugin.status}`);
      break;
    case "Workflows":
      rows = extensionRows(runtime, "workflows");
      break;
    case "Operations":
      rows = extensionRows(runtime, "operationExecutors");
      break;
    case "Services":
      rows = runtime.services
        .entries()
        .map(([id, service]) => `${id} — ${describeValue(service)}`);
      break;
    case "Theme":
      rows = [
        `id: ${runtime.theme.id}`,
        `scheme: ${runtime.theme.colorScheme}`,
        `motion: ${runtime.theme.motion.enabled ? "enabled" : "disabled"}`,
      ];
      break;
    case "Terminal capabilities":
      rows = Object.entries(runtime.capabilities).map(
        ([name, value]) => `${name}: ${String(value)}`,
      );
      break;
    case "Performance": {
      const memory = process.memoryUsage();
      rows = [
        `rss: ${Math.round(memory.rss / 1024 / 1024)} MiB`,
        `heap used: ${Math.round(memory.heapUsed / 1024 / 1024)} MiB`,
        `uptime: ${process.uptime().toFixed(1)} s`,
      ];
      break;
    }
  }
  return Object.freeze({
    panel,
    rows: Object.freeze(rows.length > 0 ? [...rows] : ["No entries"]),
  });
}

export class DevtoolsStore {
  readonly #runtime: TuilRuntime;
  readonly #events: ObservedEvent[] = [];
  readonly #observers = new Set<() => void>();
  readonly #maxEvents: number;
  readonly #disposeObservers: readonly (() => void)[];
  #version = 0;
  #disposed = false;

  constructor(
    runtime: TuilRuntime,
    options: { readonly maxEvents?: number } = {},
  ) {
    this.#runtime = runtime;
    this.#maxEvents = options.maxEvents ?? 200;
    if (!Number.isSafeInteger(this.#maxEvents) || this.#maxEvents < 1) {
      throw new Error("Devtools maxEvents must be a positive integer");
    }
    this.#events.push(...runtime.events.history().slice(-this.#maxEvents));
    const commandObserver = runtime.commands.observeRegistry(() =>
      this.#notify(),
    );
    this.#disposeObservers = [
      runtime.events.observe((event) => {
        this.#events.push(event);
        if (this.#events.length > this.#maxEvents) this.#events.shift();
        this.#notify();
      }),
      () => {
        void commandObserver.dispose();
      },
      runtime.focus.observe(() => this.#notify()),
      runtime.hotkeys.observe(() => this.#notify()),
      runtime.editorSessions.observe(() => this.#notify()),
      runtime.logPipelines.observe(() => this.#notify()),
      runtime.streamingPipelines.observe(() => this.#notify()),
      runtime.extensions.devtoolsPanels.observe(() => this.#notify()),
    ];
  }

  subscribe = (observer: () => void): (() => void) => {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  };

  version = (): number => this.#version;

  inspect(panel: DevtoolsPanel): RuntimeInspection {
    return inspectRuntime(this.#runtime, panel, this.#events);
  }

  refresh(): void {
    this.#notify();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const dispose of this.#disposeObservers) dispose();
    this.#observers.clear();
  }

  #notify(): void {
    if (this.#disposed) return;
    this.#version += 1;
    for (const observer of this.#observers) observer();
  }
}

export interface TuilDevtoolsProps {
  readonly initiallyOpen?: boolean;
  readonly maxEvents?: number;
  readonly refreshIntervalMs?: number;
}

const savedDevtoolsWorkspaces = new Map<
  string,
  ReturnType<DevtoolsWorkspace["snapshot"]>
>();

function contributionRows(value: unknown): readonly string[] {
  return flattenContribution(value, "", new WeakSet(), 0);
}

function flattenContribution(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  depth: number,
): readonly string[] {
  if (!value || typeof value !== "object") {
    return [`${path ? `${path}: ` : ""}${describeValue(value)}`];
  }
  if (seen.has(value)) return [`${path}: [Circular]`];
  if (depth >= 6) return [`${path}: ${describeValue(value)}`];
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Readonly<Record<string, unknown>>);
  if (entries.length === 0)
    return [`${path}: ${Array.isArray(value) ? "[]" : "{}"}`];
  return entries.flatMap(([key, item]) =>
    flattenContribution(item, path ? `${path}.${key}` : key, seen, depth + 1),
  );
}

function callable(
  value: unknown,
  method: string,
): ((input?: unknown) => unknown) | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[method];
  return typeof candidate === "function" ? candidate.bind(value) : undefined;
}

function actionTarget(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (input && typeof input === "object" && "id" in input) {
    return String((input as { readonly id: unknown }).id);
  }
  return "";
}

function parseActionInput(input: string): unknown {
  const value = input.trim();
  if (!value.startsWith("{") && !value.startsWith("[")) return input;
  try {
    return JSON.parse(value);
  } catch {
    return input;
  }
}

function extensionValues(
  runtime: TuilRuntime,
  key: string,
): readonly unknown[] {
  return runtime.extensions[key]?.values() ?? [];
}

async function invokeMatching(
  values: readonly unknown[],
  method: string,
  input?: unknown,
): Promise<readonly unknown[]> {
  const operations = values.flatMap((value) => {
    const operation = callable(value, method);
    return operation ? [operation(input)] : [];
  });
  return Object.freeze(await Promise.all(operations));
}

type BuiltInActionHandler = (
  input: unknown,
  runtime: TuilRuntime,
) => unknown | Promise<unknown>;

function matchingExtension(
  runtime: TuilRuntime,
  key: string,
  target: string,
): unknown {
  return extensionValues(runtime, key).find(
    (value) =>
      value &&
      typeof value === "object" &&
      String((value as { readonly id?: unknown }).id ?? "") === target,
  );
}

function openRoute(input: unknown, runtime: TuilRuntime): unknown {
  const target = actionTarget(input);
  const route = matchingExtension(runtime, "routes", target);
  const open = callable(route, "open") ?? callable(route, "navigate");
  if (!open) throw new Error(`Route "${target}" cannot be opened`);
  return open(input);
}

function nextTheme(input: unknown, runtime: TuilRuntime): unknown {
  const themes = extensionValues(runtime, "themes");
  const target = actionTarget(input);
  return (
    matchingExtension(runtime, "themes", target) ??
    themes.find(
      (value) =>
        typeof value === "function" ||
        (value &&
          typeof value === "object" &&
          (value as { readonly id?: unknown }).id !== runtime.theme.id),
    )
  );
}

function toggleTheme(input: unknown, runtime: TuilRuntime): unknown {
  const next = nextTheme(input, runtime);
  if (!next) throw new Error("No alternate registered theme is available");
  runtime.themeController.set(
    typeof next === "function"
      ? (next as (base: TuilRuntime["theme"]) => TuilRuntime["theme"])(
          runtime.theme,
        )
      : (next as never),
  );
  return runtime.themeController.get();
}

async function forceResize(
  input: unknown,
  runtime: TuilRuntime,
): Promise<unknown> {
  const dimensions =
    input && typeof input === "object"
      ? (input as { readonly width?: number; readonly height?: number })
      : {};
  const width = dimensions.width ?? runtime.capabilities.width;
  const height = dimensions.height ?? runtime.capabilities.height;
  await runtime.rendererApplication?.resize?.(width, height);
  runtime.invalidate();
  return { width, height };
}

function dumpFrame(runtime: TuilRuntime): unknown {
  const frame = runtime.renderTelemetry.snapshot().frame;
  if (!frame) throw new Error("No rendered frame is available");
  return frame;
}

function inspectWorkflow(input: unknown, runtime: TuilRuntime): unknown {
  const target = actionTarget(input);
  const workflow = extensionValues(runtime, "workflows").find(
    (value) => !target || describeValue(value) === target,
  );
  return callable(workflow, "snapshot")?.() ?? workflow ?? null;
}

function clearRuntimeLogs(runtime: TuilRuntime): Readonly<{ cleared: number }> {
  const pipelines = runtime.logPipelines.values();
  for (const pipeline of pipelines) pipeline.clear();
  return Object.freeze({ cleared: pipelines.length });
}

function logFixture(input: unknown): {
  readonly content: string;
  readonly parserId?: string;
} {
  if (typeof input === "string") return { content: input };
  if (!input || typeof input !== "object") {
    throw new Error("Log fixture input must be a string or object");
  }
  const candidate = input as {
    readonly content?: unknown;
    readonly parserId?: unknown;
  };
  if (typeof candidate.content !== "string") {
    throw new Error("Log fixture content must be a string");
  }
  if (
    candidate.parserId !== undefined &&
    typeof candidate.parserId !== "string"
  ) {
    throw new Error("Log fixture parserId must be a string");
  }
  return {
    content: candidate.content,
    parserId: candidate.parserId,
  };
}

function replayRuntimeLogFixture(
  input: unknown,
  runtime: TuilRuntime,
): readonly unknown[] {
  const fixture = logFixture(input);
  return Object.freeze(
    runtime.logPipelines
      .values()
      .flatMap((pipeline) =>
        pipeline.ingest(fixture.content, fixture.parserId),
      ),
  );
}

async function resetRuntimeEditors(
  input: unknown,
  runtime: TuilRuntime,
): Promise<readonly unknown[]> {
  const replacement =
    input && typeof input === "object" && "text" in input
      ? String((input as { readonly text: unknown }).text)
      : "";
  const snapshots: unknown[] = [];
  for (const session of runtime.editorSessions.values()) {
    await session.execute("select-all");
    await session.execute("delete-selection");
    if (replacement) await session.paste(replacement);
    snapshots.push(session.snapshot());
  }
  return Object.freeze(snapshots);
}

const builtInActionHandlers = {
  "focus-component": (input, runtime) => {
    runtime.focus.focus(actionTarget(input));
    return runtime.focus.focusedId;
  },
  "execute-command": (input, runtime) =>
    runtime.commands.execute(actionTarget(input), { source: "devtools" }),
  "open-route": openRoute,
  "toggle-theme": toggleTheme,
  "pause-rendering": (_input, runtime) => {
    runtime.renderTelemetry.pause();
    return runtime.renderTelemetry.snapshot();
  },
  "resume-rendering": (_input, runtime) => {
    runtime.renderTelemetry.resume();
    runtime.invalidate();
    return runtime.renderTelemetry.snapshot();
  },
  "force-resize": forceResize,
  "dump-frame": (_input, runtime) => dumpFrame(runtime),
  "dump-semantics": (_input, runtime) =>
    runtime.layout.nodes().map((node) => node.semantics),
  "dump-layout": (_input, runtime) => runtime.layout.snapshot(),
  "clear-log-buffers": (_input, runtime) => clearRuntimeLogs(runtime),
  "replay-log-fixture": (input, runtime) =>
    replayRuntimeLogFixture(input, runtime),
  "reset-editor": (input, runtime) => resetRuntimeEditors(input, runtime),
  "inspect-workflow": inspectWorkflow,
  "verbose-parser-diagnostics": (input, runtime) =>
    invokeMatching(
      extensionValues(runtime, "logParsers"),
      "diagnostics",
      input ?? { verbose: true },
    ),
} satisfies Readonly<Record<BuiltInDevtoolsActionId, BuiltInActionHandler>>;

async function executeBuiltInDevtoolsAction(
  id: BuiltInDevtoolsActionId,
  input: unknown,
  runtime: TuilRuntime,
): Promise<unknown> {
  return builtInActionHandlers[id](input, runtime);
}

const builtInPanelMap: Readonly<Record<BuiltInDevtoolsPanelId, DevtoolsPanel>> =
  {
    "application-lifecycle": "Events",
    services: "Services",
    "commands-keymaps": "Commands",
    "focus-tree": "Focus",
    "semantic-tree": "Focus",
    "layout-bounds": "Layout",
    "pointer-events": "Pointer",
    "render-frames": "Performance",
    "dirty-regions": "Layout",
    "render-timings": "Performance",
    "scroll-containers": "Layout",
    "active-operations": "Operations",
    "workflow-state": "Workflows",
    "routes-history": "Routes",
    "plugin-graph": "Plugins",
    "theme-tokens": "Theme",
    "editor-state": "Services",
    "log-state": "Services",
    "errors-teardown": "Events",
    "performance-warnings": "Performance",
    "capability-warnings": "Terminal capabilities",
  };

type RuntimeDevtoolsContribution =
  | DevtoolsExtension
  | {
      readonly id: string;
      readonly title: string;
      inspect(): unknown;
    };

const uiRegistryCleanups = new WeakMap<DevtoolsExtensionRegistry, () => void>();

function mirrorDevtoolsContribution(
  value: RuntimeDevtoolsContribution,
): DevtoolsExtension {
  const { dispose: _runtimeOwnedDispose, ...contribution } =
    value as RuntimeDevtoolsContribution & { readonly dispose?: () => void };
  if ("kind" in value) return contribution as DevtoolsExtension;
  return {
    ...contribution,
    kind: "panel",
    permissions: new Set(["read"]),
    serialization: "json",
  } as DevtoolsExtension;
}

function createUiExtensionRegistry(
  runtime: TuilRuntime,
  store: DevtoolsStore,
): DevtoolsExtensionRegistry {
  const registry = new DevtoolsExtensionRegistry({
    development: true,
  });
  for (const panel of createBuiltInDevtoolsPanels((id) => {
    const nodes = runtime.layout.nodes();
    const telemetry = runtime.renderTelemetry.snapshot();
    const output = telemetry.output as
      | {
          readonly dirtyRects?: readonly unknown[];
          readonly changedCells?: number;
          readonly changedRows?: readonly number[];
        }
      | undefined;
    const unavailable = (name: string) => ({
      available: false,
      reason: `${name} telemetry is unavailable until a renderer emits a frame`,
    });
    const direct: Partial<Record<BuiltInDevtoolsPanelId, unknown>> = {
      "semantic-tree": nodes.map((node) => node.semantics),
      "layout-bounds": nodes.map((node) => ({
        id: node.id,
        bounds: node.bounds,
      })),
      "dirty-regions": output
        ? {
            rectangles: output.dirtyRects ?? [],
            changedCells: output.changedCells ?? 0,
            changedRows: output.changedRows ?? [],
          }
        : unavailable("Dirty-region"),
      "render-frames": telemetry.frame
        ? {
            renderer: telemetry.renderer,
            sequence: telemetry.sequence,
            timestamp: telemetry.timestamp,
            paused: telemetry.paused,
          }
        : unavailable("Frame"),
      "render-timings":
        telemetry.durationMs === undefined
          ? unavailable("Render timing")
          : {
              durationMs: telemetry.durationMs,
              sequence: telemetry.sequence,
            },
      "scroll-containers": runtime.scroll.snapshots(),
      "active-operations": extensionValues(runtime, "operationExecutors").map(
        (value) => {
          const operation =
            value && typeof value === "object"
              ? (value as {
                  readonly id?: unknown;
                  readonly title?: unknown;
                  readonly state?: unknown;
                })
              : {};
          return {
            id: operation.id,
            title: operation.title,
            state: operation.state,
          };
        },
      ),
      "editor-state": {
        providers: runtime.editorProviders
          .list()
          .map((provider) => provider.id),
        sessions: runtime.editorSessions.entries().map(({ id, value }) => ({
          id,
          snapshot: value.snapshot(),
        })),
      },
      "log-state": {
        parsers: (
          runtime.extensions.logParsers.values() as unknown as readonly {
            readonly id: string;
          }[]
        ).map((parser) => ({
          id: parser.id,
          diagnostics: callable(parser, "diagnostics")?.(),
        })),
        buffers: runtime.logPipelines.entries().map(({ id, value }) => ({
          id,
          records: value.buffer.records(),
          statistics: value.buffer.statistics(),
          history: value.history(),
          savedSearches: value.savedSearches(),
        })),
        streams: runtime.streamingPipelines.entries().map(({ id, value }) => ({
          id,
          events: value.events(),
        })),
      },
      "pointer-events": {
        mouse: runtime.capabilities.mouse,
        regions: nodes.flatMap((node) =>
          node.pointerEvents === "auto"
            ? [
                {
                  id: node.id,
                  bounds: node.bounds,
                  clip: node.clip,
                  zIndex: node.zIndex,
                  focused: runtime.focus.focusedId === node.id,
                },
              ]
            : [],
        ),
      },
    };
    return direct[id] ?? store.inspect(builtInPanelMap[id]).rows;
  })) {
    registry.register(panel);
  }
  for (const id of builtInDevtoolsActionIds) {
    registry.register(
      createDevtoolsAction(id, (input) =>
        executeBuiltInDevtoolsAction(id, input, runtime),
      ),
    );
  }
  const mirrored = new Map<RuntimeDevtoolsContribution, () => void>();
  const syncContributions = () => {
    const active = new Set(
      runtime.extensions.devtoolsPanels.values() as unknown as readonly RuntimeDevtoolsContribution[],
    );
    for (const [value, unregister] of mirrored) {
      if (active.has(value)) continue;
      unregister();
      mirrored.delete(value);
    }
    for (const value of active) {
      if (mirrored.has(value)) continue;
      mirrored.set(value, registry.register(mirrorDevtoolsContribution(value)));
    }
  };
  syncContributions();
  const stopObserving =
    runtime.extensions.devtoolsPanels.observe(syncContributions);
  let cleaned = false;
  uiRegistryCleanups.set(registry, () => {
    if (cleaned) return;
    cleaned = true;
    stopObserving();
    for (const unregister of mirrored.values()) unregister();
    mirrored.clear();
  });
  return registry;
}

function disposeUiExtensionRegistry(registry: DevtoolsExtensionRegistry): void {
  uiRegistryCleanups.get(registry)?.();
  uiRegistryCleanups.delete(registry);
  registry.dispose();
}

function runFirstDevtoolsAction(
  registry: DevtoolsExtensionRegistry,
  action: DevtoolsExtension | undefined,
  input: unknown,
  setStatus: (status: string) => void,
): boolean {
  if (!action) return false;
  void registry
    .execute(action.id, input)
    .then(() => setStatus(`${action.title ?? action.id} succeeded`))
    .catch((error) =>
      setStatus(
        `${action.title ?? action.id} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
  return true;
}

interface DevtoolsInputOptions {
  readonly input: string;
  readonly key: Key;
  readonly open: boolean;
  readonly panelCount: number;
  readonly setOpen: (update: (current: boolean) => boolean) => void;
  readonly setPanelIndex: (update: (current: number) => number) => void;
  readonly actionCount: number;
  readonly setActionIndex: (update: (current: number) => number) => void;
  readonly editing: "search" | "argument" | undefined;
  readonly setEditing: (value: "search" | "argument" | undefined) => void;
  readonly appendSearch: (input: string, backspace: boolean) => void;
  readonly appendArgument: (input: string, backspace: boolean) => void;
  readonly pinPanel: () => void;
  readonly runAction: () => boolean;
}

function togglesDevtools(options: DevtoolsInputOptions): boolean {
  if (
    (options.key.ctrl && options.input.toLowerCase() === "d") ||
    options.input === "\u0004"
  ) {
    options.setOpen((current) => !current);
    return true;
  }
  return false;
}

function handlesEditedInput(options: DevtoolsInputOptions): boolean {
  if (!options.editing) return false;
  if (options.key.escape || options.key.return) {
    options.setEditing(undefined);
    return true;
  }
  const append =
    options.editing === "search"
      ? options.appendSearch
      : options.appendArgument;
  append(options.input, options.key.backspace);
  return true;
}

const modeInputHandlers: Readonly<
  Record<string, (options: DevtoolsInputOptions) => void>
> = {
  "/": (options) => options.setEditing("search"),
  ":": (options) => options.setEditing("argument"),
  p: (options) => options.pinPanel(),
};

function handlesModeInput(options: DevtoolsInputOptions): boolean {
  const handler = modeInputHandlers[options.input.toLowerCase()];
  if (!handler) return false;
  handler(options);
  return true;
}

function cycleIndex(count: number, delta: number) {
  return (current: number) =>
    count > 0 ? (current + delta + count) % count : 0;
}

function handlesDirectionalInput(options: DevtoolsInputOptions): boolean {
  if (options.key.upArrow) {
    options.setActionIndex(cycleIndex(options.actionCount, -1));
    return true;
  }
  if (options.key.downArrow) {
    options.setActionIndex(cycleIndex(options.actionCount, 1));
    return true;
  }
  if (options.key.leftArrow) {
    options.setPanelIndex(cycleIndex(options.panelCount, -1));
    return true;
  }
  if (options.key.rightArrow || options.key.tab) {
    options.setPanelIndex(cycleIndex(options.panelCount, 1));
    return true;
  }
  return false;
}

function handleDevtoolsInput(options: DevtoolsInputOptions): boolean {
  if (togglesDevtools(options)) return true;
  if (!options.open) return false;
  if (handlesEditedInput(options)) return true;
  if (handlesModeInput(options)) return true;
  if (handlesDirectionalInput(options)) return true;
  return options.input.toLowerCase() === "a" && options.runAction();
}

function DevtoolsPanelView(props: {
  readonly panel: DevtoolsExtension;
  readonly panelIndex: number;
  readonly panelCount: number;
  readonly actionCount: number;
  readonly auditCount: number;
  readonly actionStatus: string;
  readonly actionTitle: string;
  readonly actionInput: string;
  readonly query: string;
  readonly pinned: boolean;
  readonly panels: readonly DevtoolsExtension[];
  readonly selectPanel: (index: number) => void;
  readonly rows: readonly string[];
}): ReactNode {
  return createElement(
    Box,
    {
      borderStyle: "double",
      flexDirection: "column",
      label: "tuil devtools",
      role: "dialog",
    },
    createElement(
      Text,
      {
        bold: true,
        role: "heading",
        label: `Devtools ${props.panel.title}`,
      },
      `tuil Devtools · ${props.panel.title} · ${props.panelIndex + 1}/${props.panelCount}`,
    ),
    createElement(
      Text,
      { dimColor: true },
      `ctrl+shift+d close · ←/→ panels · ↑/↓ actions · a run · / search · : args · p pin · ${props.actionCount} actions · ${props.auditCount} audited`,
    ),
    createElement(
      Text,
      { role: "status", label: "Devtools selection" },
      `action: ${props.actionTitle} args: ${props.actionInput || "(none)"} search: ${props.query || "(all)"}${props.pinned ? " pinned" : ""}`,
    ),
    ...props.panels.map((candidate, index) =>
      createElement(DevtoolsPanelTab, {
        key: candidate.id,
        id: `devtools-panel:${candidate.id}`,
        label: candidate.title,
        selected: index === props.panelIndex,
        onSelect: () => props.selectPanel(index),
      }),
    ),
    createElement(
      Text,
      { role: "status", label: props.actionStatus },
      props.actionStatus,
    ),
    ...props.rows.map((row, index) =>
      createElement(
        Text,
        { key: `${index}:${row}`, role: "text", label: row },
        row,
      ),
    ),
  );
}

function DevtoolsPanelTab(props: {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactNode {
  usePointerEvent(props.id, "click", props.onSelect);
  return createElement(
    Text,
    {
      id: props.id,
      role: "tab",
      label: props.label,
      selected: props.selected,
      bold: props.selected,
    },
    `${props.selected ? "●" : "○"} ${props.label}`,
  );
}

function useDevtoolsLifecycle(
  registry: DevtoolsExtensionRegistry,
  store: DevtoolsStore,
  open: boolean,
  refreshIntervalMs: number,
): void {
  useEffect(() => () => disposeUiExtensionRegistry(registry), [registry]);
  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => store.refresh(), refreshIntervalMs);
    return () => clearInterval(timer);
  }, [open, refreshIntervalMs, store]);
  useSyncExternalStore(store.subscribe, store.version, store.version);
}

function validateRefreshInterval(refreshIntervalMs: number): void {
  if (!Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 16) {
    throw new Error(
      "Devtools refreshIntervalMs must be an integer of at least 16ms",
    );
  }
}

function restoreDevtoolsWorkspace(runtimeId: string): DevtoolsWorkspace {
  const workspace = new DevtoolsWorkspace();
  const saved = savedDevtoolsWorkspaces.get(runtimeId);
  if (saved) workspace.restore(saved);
  return workspace;
}

function visibleDevtoolsPanels(
  registry: DevtoolsExtensionRegistry,
  query: string,
): readonly DevtoolsExtension[] {
  return query ? registry.search(query) : registry.list("panel");
}

type StringStateSetter = (update: (current: string) => string) => void;

function updatedEditorInput(
  current: string,
  input: string,
  backspace: boolean,
): string {
  if (backspace) return current.slice(0, -1);
  if (!input || input.startsWith("\u001b")) return current;
  return current + input;
}

function textAppender(setValue: StringStateSetter) {
  return (input: string, backspace: boolean) =>
    setValue((current) => updatedEditorInput(current, input, backspace));
}

function togglePinnedPanel(
  panels: readonly DevtoolsExtension[],
  panelIndex: number,
  workspace: DevtoolsWorkspace,
  runtimeId: string,
  refresh: () => void,
): void {
  const panel = panels[panelIndex];
  if (!panel) return;
  const pinned = workspace.snapshot().pinnedPanels.includes(panel.id);
  workspace.pin(panel.id, !pinned);
  savedDevtoolsWorkspaces.set(runtimeId, workspace.snapshot());
  refresh();
}

function selectedDevtoolsPanel(
  open: boolean,
  panels: readonly DevtoolsExtension[],
  panelIndex: number,
): DevtoolsExtension | undefined {
  if (!open) return undefined;
  return panels[panelIndex] ?? panels[0];
}

function selectedActionTitle(
  actions: readonly DevtoolsExtension[],
  actionIndex: number,
): string {
  return actions[actionIndex]?.title ?? "No action";
}

function renderDevelopmentPanel(options: {
  readonly panel: DevtoolsExtension | undefined;
  readonly panelIndex: number;
  readonly panels: readonly DevtoolsExtension[];
  readonly actions: readonly DevtoolsExtension[];
  readonly actionIndex: number;
  readonly actionStatus: string;
  readonly actionInput: string;
  readonly query: string;
  readonly registry: DevtoolsExtensionRegistry;
  readonly workspace: DevtoolsWorkspace;
  readonly selectPanel: (index: number) => void;
}): ReactNode {
  const panel = options.panel;
  if (!panel) return null;
  return createElement(DevtoolsPanelView, {
    panel,
    panelIndex: options.panelIndex,
    panelCount: options.panels.length,
    actionCount: options.actions.length,
    auditCount: options.registry.actionHistory().length,
    actionStatus: options.actionStatus,
    actionTitle: selectedActionTitle(options.actions, options.actionIndex),
    actionInput: options.actionInput,
    query: options.query,
    pinned: options.workspace.snapshot().pinnedPanels.includes(panel.id),
    panels: options.panels,
    selectPanel: options.selectPanel,
    rows: contributionRows(options.registry.inspect(panel.id)),
  });
}

function DevelopmentTuilDevtools(props: TuilDevtoolsProps): ReactNode {
  const {
    initiallyOpen = false,
    maxEvents = 200,
    refreshIntervalMs = 250,
  } = props;
  validateRefreshInterval(refreshIntervalMs);
  const runtime = useApp();
  const [open, setOpen] = useState(initiallyOpen);
  const [panelIndex, setPanelIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [actionInput, setActionInput] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<"search" | "argument" | undefined>();
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [actionStatus, setActionStatus] = useState("No actions run");
  const store = useMemo(
    () => new DevtoolsStore(runtime, { maxEvents }),
    [maxEvents, runtime],
  );
  const registry = useMemo(
    () => createUiExtensionRegistry(runtime, store),
    [runtime, store],
  );
  const workspace = useMemo(
    () => restoreDevtoolsWorkspace(runtime.id),
    [runtime.id],
  );
  const panels = visibleDevtoolsPanels(registry, query);
  const actions = registry.list("action");
  useDevtoolsLifecycle(registry, store, open, refreshIntervalMs);
  useTerminalInput(
    (input, key) =>
      handleDevtoolsInput({
        input,
        key,
        open,
        panelCount: panels.length,
        setOpen,
        setPanelIndex,
        actionCount: actions.length,
        setActionIndex,
        editing,
        setEditing,
        appendSearch: textAppender(setQuery),
        appendArgument: textAppender(setActionInput),
        pinPanel: () =>
          togglePinnedPanel(panels, panelIndex, workspace, runtime.id, () =>
            setWorkspaceVersion((version) => version + 1),
          ),
        runAction: () =>
          runFirstDevtoolsAction(
            registry,
            actions[actionIndex],
            parseActionInput(actionInput),
            setActionStatus,
          ),
      }),
    { priority: 10_000 },
  );
  void workspaceVersion;
  return renderDevelopmentPanel({
    panel: selectedDevtoolsPanel(open, panels, panelIndex),
    panelIndex,
    panels,
    actions,
    actionIndex,
    actionStatus,
    actionInput,
    query,
    registry,
    workspace,
    selectPanel: setPanelIndex,
  });
}

export const TuilDevtools: FunctionComponent<TuilDevtoolsProps> = (props) => {
  if (process.env["NODE_ENV"] === "production") return null;
  return createElement(DevelopmentTuilDevtools, { ...props });
};
