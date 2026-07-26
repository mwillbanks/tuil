import { type ObservedEvent, type TuilRuntime, useApp } from "@mwillbanks/tuil";
import { Box, Text, useTerminalInput } from "@mwillbanks/tuil-ink";
import {
  createElement,
  type FunctionComponent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

export const devtoolsPanels = Object.freeze([
  "Events",
  "Commands",
  "Routes",
  "Focus",
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

function DevelopmentTuilDevtools(props: TuilDevtoolsProps): ReactNode {
  const {
    initiallyOpen = false,
    maxEvents = 200,
    refreshIntervalMs = 250,
  } = props;
  if (!Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 16) {
    throw new Error(
      "Devtools refreshIntervalMs must be an integer of at least 16ms",
    );
  }
  const runtime = useApp();
  const [open, setOpen] = useState(initiallyOpen);
  const [panelIndex, setPanelIndex] = useState(0);
  const store = useMemo(
    () => new DevtoolsStore(runtime, { maxEvents }),
    [maxEvents, runtime],
  );
  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => store.refresh(), refreshIntervalMs);
    return () => clearInterval(timer);
  }, [open, refreshIntervalMs, store]);
  useSyncExternalStore(store.subscribe, store.version, store.version);
  useTerminalInput(
    (input, key) => {
      // Terminal control sequences cannot preserve Shift for Ctrl+D, so accept
      // the canonical Ctrl+D byte while documenting the UI chord as Ctrl+Shift+D.
      if ((key.ctrl && input.toLowerCase() === "d") || input === "\u0004") {
        setOpen((current) => !current);
        return true;
      }
      if (!open) return false;
      if (key.leftArrow) {
        setPanelIndex(
          (current) =>
            (current - 1 + devtoolsPanels.length) % devtoolsPanels.length,
        );
        return true;
      }
      if (key.rightArrow || key.tab) {
        setPanelIndex((current) => (current + 1) % devtoolsPanels.length);
        return true;
      }
      return false;
    },
    { priority: 10_000 },
  );
  if (!open) return null;
  const panel = devtoolsPanels[panelIndex] as DevtoolsPanel;
  const inspection = store.inspect(panel);
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
      { bold: true, role: "heading", label: `Devtools ${panel}` },
      `tuil Devtools · ${panel} · ${panelIndex + 1}/${devtoolsPanels.length}`,
    ),
    createElement(Text, { dimColor: true }, "ctrl+shift+d close · ←/→ panels"),
    ...inspection.rows.map((row) =>
      createElement(Text, { key: row, role: "text", label: row }, row),
    ),
  );
}

export const TuilDevtools: FunctionComponent<TuilDevtoolsProps> = (props) => {
  if (process.env["NODE_ENV"] === "production") return null;
  return createElement(DevelopmentTuilDevtools, { ...props });
};
