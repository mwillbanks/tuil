import {
  createProtocolMessage,
  type ProtocolMessage,
  type ProtocolTransport,
  redactProtocolValue,
} from "@mwillbanks/tuil-protocol";

export type DevtoolsPermission = "read" | "write";
export type DevtoolsCapability =
  | "runtime"
  | "services"
  | "commands"
  | "focus"
  | "semantics"
  | "layout"
  | "pointer"
  | "frames"
  | "scroll"
  | "operations"
  | "workflows"
  | "routes"
  | "plugins"
  | "themes"
  | "editors"
  | "logs"
  | "performance"
  | "errors";

export interface DevtoolsContribution {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly requiredCapabilities?: readonly DevtoolsCapability[];
  readonly activation?: () => boolean;
  readonly permissions: ReadonlySet<DevtoolsPermission>;
  readonly serialization: "json";
  readonly dispose?: () => void;
}

export interface DevtoolsPanelContribution extends DevtoolsContribution {
  readonly kind: "panel";
  inspect(): unknown;
  readonly searchText?: () => string;
}

export interface DevtoolsActionContext {
  readonly development: boolean;
  readonly record: (action: DevtoolsActionRecord) => void;
}

export interface DevtoolsActionContribution extends DevtoolsContribution {
  readonly kind: "action";
  run(
    input: unknown,
    context: DevtoolsActionContext,
  ): unknown | Promise<unknown>;
}

export interface DevtoolsQueryContribution extends DevtoolsContribution {
  readonly kind: "query";
  query(input: string): unknown | Promise<unknown>;
}

export type DevtoolsObserverKind =
  | "inspector"
  | "event-subscriber"
  | "frame-overlay"
  | "semantic-tree-view"
  | "focus-view"
  | "pointer-monitor"
  | "editor-inspector"
  | "log-parser-inspector"
  | "theme-preview"
  | "performance-collector";

export interface DevtoolsObserverContribution extends DevtoolsContribution {
  readonly kind: DevtoolsObserverKind;
  observe(input?: unknown): unknown | Promise<unknown>;
}

export type DevtoolsExtension =
  | DevtoolsPanelContribution
  | DevtoolsActionContribution
  | DevtoolsQueryContribution
  | DevtoolsObserverContribution;

export interface DevtoolsActionRecord {
  readonly id: string;
  readonly timestamp: number;
  readonly input: unknown;
  readonly ok: boolean;
  readonly error?: string;
}

export interface DevtoolsActionHistorySnapshot {
  readonly records: readonly DevtoolsActionRecord[];
  readonly limit: number;
  readonly dropped: number;
  readonly truncated: boolean;
}

function validateDevtoolsExtension(
  extension: DevtoolsExtension,
  existing: ReadonlyMap<string, DevtoolsExtension>,
  capabilities: ReadonlySet<DevtoolsCapability>,
): void {
  if (!extension.id.trim())
    throw new Error("Devtools extension id cannot be empty");
  if (existing.has(extension.id)) {
    throw new Error(
      `Devtools extension "${extension.id}" is already registered`,
    );
  }
  if (extension.permissions.size === 0) {
    throw new Error(
      `Devtools extension "${extension.id}" must declare permissions`,
    );
  }
  const requiresRead = extension.kind === "panel" || extension.kind === "query";
  if (requiresRead && !extension.permissions.has("read")) {
    throw new Error(
      `Devtools extension "${extension.id}" requires read permission`,
    );
  }
  const missing = (extension.requiredCapabilities ?? []).filter(
    (capability) => !capabilities.has(capability),
  );
  if (missing.length > 0) {
    throw new Error(
      `Devtools extension "${extension.id}" requires ${missing.join(", ")}`,
    );
  }
}

export class DevtoolsExtensionRegistry {
  readonly #extensions = new Map<string, DevtoolsExtension>();
  readonly #capabilities: ReadonlySet<DevtoolsCapability>;
  readonly #history: DevtoolsActionRecord[] = [];
  readonly #historyLimit: number;
  #historyDropped = 0;
  readonly #development: boolean;
  readonly #transport?: ProtocolTransport;
  readonly #redact: (value: unknown) => unknown;

  constructor(
    options: {
      readonly capabilities?: ReadonlySet<DevtoolsCapability>;
      readonly development?: boolean;
      readonly transport?: ProtocolTransport;
      readonly redact?: (value: unknown) => unknown;
      readonly actionHistoryLimit?: number;
    } = {},
  ) {
    this.#capabilities =
      options.capabilities ??
      new Set<DevtoolsCapability>([
        "runtime",
        "services",
        "commands",
        "focus",
        "semantics",
        "layout",
        "pointer",
        "frames",
        "scroll",
        "operations",
        "workflows",
        "routes",
        "plugins",
        "themes",
        "editors",
        "logs",
        "performance",
        "errors",
      ]);
    this.#development = options.development ?? false;
    this.#historyLimit = options.actionHistoryLimit ?? 200;
    if (!Number.isSafeInteger(this.#historyLimit) || this.#historyLimit <= 0) {
      throw new Error(
        "Devtools actionHistoryLimit must be a positive safe integer",
      );
    }
    this.#transport = options.transport;
    this.#redact = options.redact
      ? (value) =>
          redactDevtoolsValue(options.redact?.(redactDevtoolsValue(value)))
      : redactDevtoolsValue;
  }

  register(extension: DevtoolsExtension): () => void {
    validateDevtoolsExtension(extension, this.#extensions, this.#capabilities);
    if (extension.activation && !extension.activation()) {
      return () => {};
    }
    this.#extensions.set(extension.id, extension);
    void Promise.resolve(
      this.#transport?.send(
        createProtocolMessage("contribution", {
          id: extension.id,
          kind: extension.kind,
        }),
      ),
    ).catch(() => undefined);
    return () => {
      if (this.#extensions.get(extension.id) !== extension) return;
      this.#extensions.delete(extension.id);
      extension.dispose?.();
    };
  }

  list<TKind extends DevtoolsExtension["kind"]>(
    kind?: TKind,
  ): readonly Extract<DevtoolsExtension, { readonly kind: TKind }>[] {
    return Object.freeze(
      [...this.#extensions.values()].filter(
        (
          extension,
        ): extension is Extract<DevtoolsExtension, { readonly kind: TKind }> =>
          !kind || extension.kind === kind,
      ),
    );
  }

  inspect(id: string): unknown {
    const panel = this.#extensions.get(id);
    if (panel?.kind !== "panel") {
      throw new Error(`Devtools panel "${id}" is unavailable`);
    }
    return this.#redact(panel.inspect());
  }

  search(query: string): readonly DevtoolsPanelContribution[] {
    const needle = query.toLowerCase();
    return Object.freeze(
      this.list("panel").filter((panel) =>
        `${panel.title} ${panel.searchText?.() ?? ""}`
          .toLowerCase()
          .includes(needle),
      ),
    );
  }

  async execute(id: string, input?: unknown): Promise<unknown> {
    const extension = this.#extensions.get(id);
    if (extension?.kind !== "action") {
      throw new Error(`Devtools action "${id}" is unavailable`);
    }
    if (!extension.permissions.has("write")) {
      throw new Error(`Devtools action "${id}" lacks write permission`);
    }
    if (!this.#development) {
      throw new Error(`Devtools action "${id}" requires development mode`);
    }
    let result: unknown;
    try {
      result = await extension.run(input, {
        development: true,
        record: (entry) => {
          this.#record(entry);
        },
      });
    } catch (error) {
      const message = redactDevtoolsValue(
        error instanceof Error ? error.message : String(error),
      ) as string;
      this.#record({
        id,
        timestamp: Date.now(),
        input,
        ok: false,
        error: message,
      });
      throw new Error(message);
    }
    const entry = this.#record({
      id,
      timestamp: Date.now(),
      input,
      ok: true,
    });
    try {
      await this.#transport?.send(createProtocolMessage("command", entry));
    } catch {
      // Delivery is observational. The completed action must not become a
      // retryable failure when a devtools transport is unavailable.
    }
    return result;
  }

  #record(entry: DevtoolsActionRecord): DevtoolsActionRecord {
    const redacted = Object.freeze({
      ...entry,
      input: this.#redact(entry.input),
      error:
        entry.error === undefined
          ? undefined
          : (this.#redact(entry.error) as string),
    });
    this.#history.push(redacted);
    const overflow = this.#history.length - this.#historyLimit;
    if (overflow > 0) {
      this.#history.splice(0, overflow);
      this.#historyDropped += overflow;
    }
    return redacted;
  }

  actionHistory(): readonly DevtoolsActionRecord[] {
    return Object.freeze([...this.#history]);
  }

  actionHistorySnapshot(): DevtoolsActionHistorySnapshot {
    return Object.freeze({
      records: this.actionHistory(),
      limit: this.#historyLimit,
      dropped: this.#historyDropped,
      truncated: this.#historyDropped > 0,
    });
  }

  async query(id: string, input: string): Promise<unknown> {
    const extension = this.#extensions.get(id);
    if (extension?.kind !== "query") {
      throw new Error(`Devtools query "${id}" is unavailable`);
    }
    return extension.query(input);
  }

  async observe(id: string, input?: unknown): Promise<unknown> {
    const extension = this.#extensions.get(id);
    if (
      !extension ||
      extension.kind === "panel" ||
      extension.kind === "action" ||
      extension.kind === "query"
    ) {
      throw new Error(`Devtools observer "${id}" is unavailable`);
    }
    return extension.observe(input);
  }

  diagnosticsBundle(): string {
    const panels = Object.fromEntries(
      this.list("panel").map((panel) => [panel.id, panel.inspect()]),
    );
    return JSON.stringify(
      this.#redact({
        version: 1,
        generatedAt: new Date(0).toISOString(),
        panels,
        actions: this.#history,
        actionHistory: {
          limit: this.#historyLimit,
          dropped: this.#historyDropped,
          truncated: this.#historyDropped > 0,
        },
      }),
      null,
      2,
    );
  }

  dispose(): void {
    for (const extension of this.#extensions.values()) {
      extension.dispose?.();
    }
    this.#extensions.clear();
  }
}

const maximumAuditDepth = 8;
const maximumAuditEntries = 200;
const maximumAuditStringLength = 10_000;
const sensitiveAuditKey = /password|token|secret|authorization|api[-_]?key/i;

function redactDevtoolsValue(value: unknown): unknown {
  return sanitizeDevtoolsValue(value, new WeakSet(), 0);
}

const unhandledDevtoolsValue = Symbol("unhandled-devtools-value");

function sanitizeScalarDevtoolsValue(
  value: unknown,
): unknown | typeof unhandledDevtoolsValue {
  if (typeof value === "string") {
    const redacted = redactDevtoolsString(value);
    return redacted.length <= maximumAuditStringLength
      ? redacted
      : `${redacted.slice(0, maximumAuditStringLength)}…[TRUNCATED]`;
  }
  if (typeof value === "bigint") return `${value}n`;
  if (value === undefined || value === null) return value;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "object") return `[${typeof value}]`;
  return unhandledDevtoolsValue;
}

function sanitizeDevtoolsArray(
  value: readonly unknown[],
  seen: WeakSet<object>,
  depth: number,
): unknown[] {
  const items = value
    .slice(0, maximumAuditEntries)
    .map((item) => sanitizeDevtoolsValue(item, seen, depth + 1));
  if (value.length > maximumAuditEntries) items.push("[TRUNCATED]");
  return items;
}

function sanitizeDevtoolsRecord(
  value: object,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const entries = Object.entries(value).slice(0, maximumAuditEntries);
  const sanitized = Object.fromEntries(
    entries.map(([key, item]) => [
      key,
      sensitiveAuditKey.test(key)
        ? "[REDACTED]"
        : sanitizeDevtoolsValue(item, seen, depth + 1),
    ]),
  );
  if (Object.keys(value).length > maximumAuditEntries) {
    sanitized["[TRUNCATED]"] = true;
  }
  return sanitized;
}

function sanitizeDevtoolsValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  const scalar = sanitizeScalarDevtoolsValue(value);
  if (scalar !== unhandledDevtoolsValue) return scalar;
  const object = value as object;
  if (seen.has(object)) return "[Circular]";
  if (depth >= maximumAuditDepth) return "[MaxDepth]";
  seen.add(object);
  return Array.isArray(object)
    ? sanitizeDevtoolsArray(object, seen, depth)
    : sanitizeDevtoolsRecord(object, seen, depth);
}

const secretAssignment =
  /\b(password|token|secret|authorization|api[-_]?key)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const bearerCredential = /\bbearer\s+[a-z0-9._~+/=-]+/giu;
const jwtCredential =
  /\beyJ[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}(?:\.[a-z0-9_-]{6,})?\b/giu;
const urlCredential = /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/giu;

function redactDevtoolsString(value: string): string {
  return value
    .replace(secretAssignment, (_match, key: string, separator: string) => {
      return `${key}${separator}[REDACTED]`;
    })
    .replace(bearerCredential, "Bearer [REDACTED]")
    .replace(jwtCredential, "[REDACTED]")
    .replace(urlCredential, "$1[REDACTED]@");
}

export const builtInDevtoolsPanelIds = Object.freeze([
  "application-lifecycle",
  "services",
  "commands-keymaps",
  "focus-tree",
  "semantic-tree",
  "layout-bounds",
  "pointer-events",
  "render-frames",
  "dirty-regions",
  "render-timings",
  "scroll-containers",
  "active-operations",
  "workflow-state",
  "routes-history",
  "plugin-graph",
  "theme-tokens",
  "editor-state",
  "log-state",
  "errors-teardown",
  "performance-warnings",
  "capability-warnings",
] as const);

export type BuiltInDevtoolsPanelId = (typeof builtInDevtoolsPanelIds)[number];

export function createBuiltInDevtoolsPanels(
  inspect: (id: BuiltInDevtoolsPanelId) => unknown,
): readonly DevtoolsPanelContribution[] {
  return Object.freeze(
    builtInDevtoolsPanelIds.map((id) =>
      Object.freeze({
        id,
        title: id
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" "),
        kind: "panel" as const,
        permissions: new Set(["read"] as const),
        serialization: "json" as const,
        inspect: () => inspect(id),
        searchText: () => id,
      }),
    ),
  );
}

export const builtInDevtoolsActionIds = Object.freeze([
  "focus-component",
  "execute-command",
  "open-route",
  "toggle-theme",
  "pause-rendering",
  "resume-rendering",
  "force-resize",
  "dump-frame",
  "dump-semantics",
  "dump-layout",
  "clear-log-buffers",
  "replay-log-fixture",
  "reset-editor",
  "inspect-workflow",
  "verbose-parser-diagnostics",
] as const);

export type BuiltInDevtoolsActionId = (typeof builtInDevtoolsActionIds)[number];

export function createDevtoolsAction(
  id: BuiltInDevtoolsActionId,
  run: (input: unknown) => unknown | Promise<unknown>,
): DevtoolsActionContribution {
  return Object.freeze({
    id,
    title: id.replaceAll("-", " "),
    kind: "action",
    permissions: new Set(["read", "write"] as const),
    serialization: "json",
    run,
  });
}

export interface DevtoolsWorkspaceState {
  readonly pinnedPanels: readonly string[];
  readonly panelLayout: Readonly<
    Record<string, { readonly x: number; readonly y: number }>
  >;
}

export class DevtoolsWorkspace {
  readonly #pinned: Set<string>;
  readonly #layout: Map<string, { readonly x: number; readonly y: number }>;

  constructor() {
    this.#pinned = new Set();
    this.#layout = new Map();
  }

  pin(id: string, value = true): void {
    if (value) this.#pinned.add(id);
    else this.#pinned.delete(id);
  }

  position(id: string, x: number, y: number): void {
    this.#layout.set(id, {
      x: Math.floor(x),
      y: Math.floor(y),
    });
  }

  snapshot(): DevtoolsWorkspaceState {
    return Object.freeze({
      pinnedPanels: Object.freeze([...this.#pinned]),
      panelLayout: Object.freeze(Object.fromEntries(this.#layout)),
    });
  }

  restore(state: DevtoolsWorkspaceState): void {
    this.#pinned.clear();
    this.#layout.clear();
    for (const id of state.pinnedPanels) this.#pinned.add(id);
    for (const [id, position] of Object.entries(state.panelLayout)) {
      this.#layout.set(id, position);
    }
  }
}

export function explainDevtoolsState(
  kind: "focus" | "render" | "command",
  evidence: readonly string[],
): string {
  if (evidence.length === 0) {
    return `No ${kind} evidence is available`;
  }
  return `${kind}: ${evidence.join(" → ")}`;
}

export function protocolSnapshot(payload: unknown): ProtocolMessage {
  return createProtocolMessage("snapshot", redactProtocolValue(payload));
}
