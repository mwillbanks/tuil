import { expect, test } from "bun:test";
import { InProcessProtocolTransport } from "@mwillbanks/tuil-protocol";
import {
  builtInDevtoolsPanelIds,
  createBuiltInDevtoolsPanels,
  createDevtoolsAction,
  DevtoolsExtensionRegistry,
  DevtoolsWorkspace,
  explainDevtoolsState,
  protocolSnapshot,
} from "./extensions.ts";

test("built-in panels are pluggable public contributions and clean up", () => {
  const disposed: string[] = [];
  const registry = new DevtoolsExtensionRegistry({
    development: true,
  });
  const panels = createBuiltInDevtoolsPanels((id) => ({
    id,
    value: 1,
  }));
  expect(panels).toHaveLength(builtInDevtoolsPanelIds.length);
  const panel = panels[0];
  if (!panel) throw new Error("Expected built-in panel");
  const unregister = registry.register({
    ...panel,
    dispose: () => disposed.push("done"),
  });
  expect(registry.inspect("application-lifecycle")).toEqual({
    id: "application-lifecycle",
    value: 1,
  });
  unregister();
  expect(disposed).toEqual(["done"]);
});

test("mutating actions require development mode and record auditable history", async () => {
  const production = new DevtoolsExtensionRegistry();
  production.register(createDevtoolsAction("focus-component", () => true));
  await expect(production.execute("focus-component", "button")).rejects.toThrow(
    "development mode",
  );
  const development = new DevtoolsExtensionRegistry({
    development: true,
  });
  development.register(
    createDevtoolsAction(
      "focus-component",
      (input) => `focused:${String(input)}`,
    ),
  );
  expect(await development.execute("focus-component", "button")).toBe(
    "focused:button",
  );
  expect(development.actionHistory()).toMatchObject([
    { id: "focus-component", ok: true },
  ]);
});

test("search, diagnostics, protocol, workspace persistence, and explanations compose", () => {
  const transport = new InProcessProtocolTransport();
  const messages: unknown[] = [];
  transport.subscribe((message) => messages.push(message));
  const registry = new DevtoolsExtensionRegistry({
    development: true,
    transport,
  });
  for (const panel of createBuiltInDevtoolsPanels((id) => ({
    id,
  }))) {
    registry.register(panel);
  }
  expect(registry.search("pointer")).toHaveLength(1);
  expect(JSON.parse(registry.diagnosticsBundle()).version).toBe(1);
  expect(messages).toHaveLength(builtInDevtoolsPanelIds.length);
  const workspace = new DevtoolsWorkspace();
  workspace.pin("focus-tree");
  workspace.position("focus-tree", 2, 3);
  const state = workspace.snapshot();
  const restored = new DevtoolsWorkspace();
  restored.restore(state);
  expect(restored.snapshot()).toEqual(state);
  expect(
    explainDevtoolsState("focus", ["scope active", "button first"]),
  ).toContain("scope active → button first");
});

test("queries, observers, declared permissions, and diagnostic redaction are enforced", async () => {
  const registry = new DevtoolsExtensionRegistry({ development: true });
  expect(() =>
    registry.register({
      id: "invalid",
      title: "Invalid",
      kind: "panel",
      permissions: new Set(),
      serialization: "json",
      inspect: () => null,
    }),
  ).toThrow("permissions");
  registry.register({
    id: "query.logs",
    title: "Logs",
    kind: "query",
    permissions: new Set(["read"]),
    serialization: "json",
    query: (input) => input.toUpperCase(),
  });
  registry.register({
    id: "performance.frames",
    title: "Frames",
    kind: "performance-collector",
    permissions: new Set(["read"]),
    serialization: "json",
    observe: (input) => input,
  });
  registry.register({
    id: "secrets",
    title: "Secrets",
    kind: "panel",
    permissions: new Set(["read"]),
    serialization: "json",
    inspect: () => ({ token: "private", safe: true }),
  });
  expect(await registry.query("query.logs", "error")).toBe("ERROR");
  expect(await registry.observe("performance.frames", 42)).toBe(42);
  expect(registry.inspect("secrets")).toEqual({
    token: "[REDACTED]",
    safe: true,
  });
  expect(registry.diagnosticsBundle()).not.toContain("private");
  expect(() => registry.inspect("missing")).toThrow("unavailable");
  expect(() =>
    registry.register({
      id: "query.logs",
      title: "Duplicate",
      kind: "query",
      permissions: new Set(["read"]),
      serialization: "json",
      query: () => null,
    }),
  ).toThrow("already registered");
  await expect(registry.query("missing", "")).rejects.toThrow("unavailable");
  await expect(registry.observe("query.logs")).rejects.toThrow("unavailable");
  registry.dispose();
  expect(registry.list()).toEqual([]);
});

test("extension capabilities, activation, action failures, and custom auditing are enforced", async () => {
  const registry = new DevtoolsExtensionRegistry({
    development: true,
    capabilities: new Set(["runtime"]),
  });
  expect(() =>
    registry.register({
      id: "logs",
      title: "Logs",
      kind: "panel",
      permissions: new Set(["read"]),
      serialization: "json",
      requiredCapabilities: ["logs"],
      inspect: () => null,
    }),
  ).toThrow("requires logs");
  const inactive = registry.register({
    id: "inactive",
    title: "Inactive",
    kind: "panel",
    permissions: new Set(["read"]),
    serialization: "json",
    activation: () => false,
    inspect: () => null,
  });
  inactive();
  expect(registry.list()).toEqual([]);

  registry.register({
    id: "audited",
    title: "Audited",
    kind: "action",
    permissions: new Set(["write"]),
    serialization: "json",
    async run(_input, context) {
      context.record({
        id: "custom",
        timestamp: 0,
        input: {
          note: "token=extension-secret",
          nested: { authorization: "extension-authorization" },
        },
        ok: true,
        error: "Bearer extension-bearer",
      });
      return "done";
    },
  });
  expect(await registry.execute("audited", { password: "secret" })).toBe(
    "done",
  );
  expect(JSON.stringify(registry.actionHistory())).not.toContain("secret");
  expect(JSON.stringify(registry.actionHistory())).not.toContain(
    "extension-authorization",
  );
  expect(JSON.stringify(registry.actionHistory())).not.toContain(
    "extension-bearer",
  );

  registry.register({
    id: "failing",
    title: "Failing",
    kind: "action",
    permissions: new Set(["write"]),
    serialization: "json",
    run() {
      throw new Error(
        "failed token=error-secret Bearer error-bearer https://user:password@example.com",
      );
    },
  });
  await expect(registry.execute("failing")).rejects.toThrow(
    "failed token=[REDACTED]",
  );
  expect(JSON.stringify(registry.actionHistory())).not.toContain(
    "error-secret",
  );
  expect(JSON.stringify(registry.actionHistory())).not.toContain(
    "error-bearer",
  );
  expect(JSON.stringify(registry.actionHistory())).not.toContain(
    "user:password",
  );
  expect(registry.actionHistory().at(-1)?.ok).toBeFalse();
  await expect(registry.execute("missing")).rejects.toThrow("unavailable");
});

test("custom audit redactors cannot bypass mandatory secret removal", async () => {
  const observed: unknown[] = [];
  const registry = new DevtoolsExtensionRegistry({
    development: true,
    redact(value) {
      observed.push(value);
      return {
        value,
        apiKey: "reintroduced-secret",
        api_key: "reintroduced-secret-underscore",
      };
    },
  });
  registry.register({
    id: "custom-redactor",
    title: "Custom redactor",
    kind: "action",
    permissions: new Set(["write"]),
    serialization: "json",
    run() {
      return true;
    },
  });
  await registry.execute("custom-redactor", {
    token: "cannot-escape",
    note: "Bearer cannot-escape-either",
  });
  expect(JSON.stringify(observed)).not.toContain("cannot-escape");
  expect(JSON.stringify(registry.actionHistory())).not.toContain(
    "cannot-escape",
  );
  expect(JSON.stringify(registry.actionHistory())).not.toContain(
    "reintroduced-secret",
  );
});

test("audit sanitization is bounded, cycle-safe, and JSON-safe", async () => {
  const circular: Record<string, unknown> = {
    apiKey: "panel-secret",
    counter: 42n,
    oversized: "x".repeat(20_000),
  };
  circular["self"] = circular;
  const registry = new DevtoolsExtensionRegistry({ development: true });
  registry.register({
    id: "circular",
    title: "Circular",
    kind: "panel",
    permissions: new Set(["read"]),
    serialization: "json",
    inspect: () => circular,
  });
  const inspected = registry.inspect("circular") as Record<string, unknown>;
  expect(inspected["apiKey"]).toBe("[REDACTED]");
  expect(inspected["counter"]).toBe("42n");
  expect(inspected["self"]).toBe("[Circular]");
  expect(String(inspected["oversized"])).toEndWith("…[TRUNCATED]");
  expect(() => registry.diagnosticsBundle()).not.toThrow();
  expect(registry.diagnosticsBundle()).not.toContain("panel-secret");
});

test("transport delivery failure cannot reclassify a completed action", async () => {
  const registry = new DevtoolsExtensionRegistry({
    development: true,
    transport: {
      async send() {
        throw new Error("offline");
      },
      subscribe: () => () => {},
      close() {},
    },
  });
  let mutations = 0;
  registry.register({
    id: "mutate",
    title: "Mutate",
    kind: "action",
    permissions: new Set(["write"]),
    serialization: "json",
    run() {
      mutations += 1;
      return "applied";
    },
  });
  expect(await registry.execute("mutate")).toBe("applied");
  expect(mutations).toBe(1);
  expect(registry.actionHistory()).toHaveLength(1);
  expect(registry.actionHistory()[0]?.ok).toBeTrue();
});

test("action history is bounded and reports truncation", async () => {
  expect(
    () => new DevtoolsExtensionRegistry({ actionHistoryLimit: 0 }),
  ).toThrow("positive safe integer");
  const registry = new DevtoolsExtensionRegistry({
    development: true,
    actionHistoryLimit: 2,
  });
  registry.register({
    id: "bounded",
    title: "Bounded",
    kind: "action",
    permissions: new Set(["write"]),
    serialization: "json",
    run: (input) => input,
  });
  await registry.execute("bounded", 1);
  await registry.execute("bounded", 2);
  await registry.execute("bounded", 3);
  expect(registry.actionHistory().map((record) => record.input)).toEqual([
    2, 3,
  ]);
  expect(registry.actionHistorySnapshot()).toMatchObject({
    limit: 2,
    dropped: 1,
    truncated: true,
  });
  expect(JSON.parse(registry.diagnosticsBundle()).actionHistory).toEqual({
    limit: 2,
    dropped: 1,
    truncated: true,
  });
});

test("protocol snapshots use the protocol package redaction boundary", () => {
  const message = protocolSnapshot({
    token: "snapshot-secret",
    nested: { authorization: "Bearer snapshot-bearer" },
  });
  expect(JSON.stringify(message)).not.toContain("snapshot-secret");
  expect(JSON.stringify(message)).not.toContain("snapshot-bearer");
});
