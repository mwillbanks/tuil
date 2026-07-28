import { afterEach, expect, test } from "bun:test";
import { createApp } from "@mwillbanks/tuil";
import { renderStatic } from "@mwillbanks/tuil-ink";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { type ComponentType, createElement } from "react";
import "./ai-assistant/src/index.tsx";
import { AiCodingAssistantApplication } from "./ai-coding-assistant/src/index.tsx";
import "./command-center/src/index.tsx";
import "./dashboard/src/index.tsx";
import { DeploymentDashboardApplication } from "./deployment-dashboard/src/index.tsx";
import { DocsBrowserApplication } from "./docs-browser/src/index.tsx";
import "./file-browser/src/index.tsx";
import { FileManagerApplication } from "./file-manager/src/index.tsx";
import "./forms/src/index.tsx";
import { loadLogo } from "./full-screen/src/index.tsx";
import "./minimal/src/index.tsx";
import {
  createGitRepositorySource,
  GitClientApplication,
} from "./git-client/src/index.tsx";
import { LogExplorerApplication } from "./log-explorer/src/index.tsx";
import {
  defaultOpenTelemetryRecords,
  exportOpenTelemetrySnapshot,
  OpenTelemetryConsoleApplication,
  type OpenTelemetryConsoleApplicationProps,
  openTelemetryConsolePlugin,
  openTelemetryConsoleQuery,
} from "./otel-console/src/index.tsx";
import "./project-wizard/src/index.tsx";
import type { ProductionRecordSource } from "./_shared.tsx";
import {
  createProductionApplicationAdapter,
  ExampleApplication,
  type ExampleKind,
  ProductionApplicationAdapter,
  readTextLineBatches,
  runExample,
} from "./_shared.tsx";
import { WorkflowRunnerApplication } from "./workflow-runner/src/index.tsx";

afterEach(cleanup);

async function waitForFrameText(
  instance: ReturnType<typeof renderTuil>,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (instance.screen.frame().includes(expected)) return;
    await Bun.sleep(1);
  }
  expect(instance.screen.frame()).toContain(expected);
}

test("production adapters own refresh, actions, export, and subscriptions", async () => {
  let loaded = 0;
  let actionRuns = 0;
  const adapter = new ProductionApplicationAdapter({
    id: "git-client",
    records: ["branch=main"],
    source: {
      async *stream() {
        yield [`branch=main revision=${++loaded}`];
      },
    },
    actions: {
      fetch: () => {
        actionRuns += 1;
      },
    },
  });
  let notifications = 0;
  const unsubscribe = adapter.subscribe(() => {
    notifications += 1;
  });
  await adapter.refresh();
  await adapter.execute("fetch");
  expect(actionRuns).toBe(1);
  expect(notifications).toBe(2);
  expect(adapter.export()).toContain("revision=2");
  expect(JSON.parse(adapter.export("json"))).toEqual([
    "branch=main revision=2",
  ]);
  await expect(adapter.execute("missing")).rejects.toThrow("unavailable");
  unsubscribe();
});

test("production adapter aborts stale loads and never publishes after disposal", async () => {
  const pending: Array<{
    readonly signal: AbortSignal;
    readonly resolve: (records: readonly string[]) => void;
  }> = [];
  const adapter = new ProductionApplicationAdapter({
    id: "log-explorer",
    records: [],
    source: {
      async *stream(signal) {
        yield await new Promise<readonly string[]>((resolve) => {
          pending.push({ signal, resolve });
          signal.addEventListener("abort", () => resolve([]), { once: true });
        });
      },
    },
  });
  let notifications = 0;
  adapter.subscribe(() => {
    notifications += 1;
  });
  const waitForPending = async (count: number) => {
    for (
      let attempt = 0;
      pending.length < count && attempt < 20;
      attempt += 1
    ) {
      await Promise.resolve();
    }
    expect(pending).toHaveLength(count);
  };

  const stale = adapter.refresh();
  const current = adapter.refresh();
  expect(pending[0]?.signal.aborted).toBeTrue();
  await waitForPending(2);
  pending[1]?.resolve(["current"]);
  await current;
  pending[0]?.resolve(["stale"]);
  await stale;
  expect(adapter.snapshot()).toEqual({
    records: ["current"],
    revision: 1,
  });
  expect(notifications).toBe(1);

  const disposed = adapter.refresh();
  await waitForPending(3);
  adapter.dispose();
  expect(pending[2]?.signal.aborted).toBeTrue();
  pending[2]?.resolve(["after dispose"]);
  await disposed;
  expect(adapter.snapshot()).toEqual({
    records: ["current"],
    revision: 1,
  });
  expect(notifications).toBe(1);
});

test("production adapter runs exactly one action handler and isolates subscribers", async () => {
  let localRuns = 0;
  let sourceRuns = 0;
  const adapter = new ProductionApplicationAdapter({
    id: "log-explorer",
    records: [],
    source: {
      async *stream() {
        yield ["ready"];
      },
    },
    actions: {
      clear: () => {
        localRuns += 1;
      },
    },
    execute: () => {
      sourceRuns += 1;
    },
  });
  adapter.subscribe(() => {
    throw new Error("subscriber failed");
  });
  let healthyNotifications = 0;
  adapter.subscribe(() => {
    healthyNotifications += 1;
  });

  await adapter.execute("clear");

  expect(localRuns).toBe(1);
  expect(sourceRuns).toBe(0);
  expect(healthyNotifications).toBe(1);
});

test("production adapter pulls bounded batches, retains its limit, and cancels blocked producers", async () => {
  let pulls = 0;
  const adapter = createProductionApplicationAdapter("otel-console", {
    batchSize: 2,
    retentionLimit: 3,
    async *stream(signal) {
      for (let index = 0; index < 7; index += 1) {
        signal.throwIfAborted();
        pulls += 1;
        yield [`record-${index}`];
      }
    },
  });
  await adapter.refresh();
  expect(pulls).toBe(7);
  expect(adapter.snapshot().records).toEqual([
    "record-4",
    "record-5",
    "record-6",
  ]);

  let blockedSignal: AbortSignal | undefined;
  const blocked = createProductionApplicationAdapter("otel-console", {
    async *stream(signal) {
      blockedSignal = signal;
      yield ["first"];
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });
  const refresh = blocked.refresh();
  while (blocked.snapshot().revision === 0) await Promise.resolve();
  blocked.dispose();
  await refresh;
  expect(blockedSignal?.aborted).toBeTrue();
  expect(blocked.snapshot().records).toEqual(["first"]);
});

test("production adapter awaits superseded iterator cleanup before starting the replacement", async () => {
  let starts = 0;
  let cleanupStarted = false;
  let finishCleanup = () => {};
  const cleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve;
  });
  const adapter = createProductionApplicationAdapter("otel-console", {
    stream() {
      starts += 1;
      if (starts > 1) {
        return (async function* replacement() {
          yield ["replacement"];
        })();
      }
      let emitted = false;
      const iterator: AsyncIterableIterator<readonly string[]> = {
        [Symbol.asyncIterator]() {
          return iterator;
        },
        next(): Promise<IteratorResult<readonly string[]>> {
          if (!emitted) {
            emitted = true;
            return Promise.resolve({
              done: false as const,
              value: ["initial"],
            });
          }
          return new Promise(() => {});
        },
        async return(): Promise<IteratorResult<readonly string[]>> {
          cleanupStarted = true;
          await cleanup;
          return { done: true as const, value: undefined };
        },
      };
      return iterator;
    },
  });
  const initial = adapter.refresh();
  while (adapter.snapshot().revision === 0) await Promise.resolve();
  const replacement = adapter.refresh();
  while (!cleanupStarted) await Promise.resolve();
  expect(starts).toBe(1);
  finishCleanup();
  await Promise.all([initial, replacement]);
  expect(starts).toBe(2);
  expect(adapter.snapshot().records).toEqual(["replacement"]);
});

test("production adapter preserves a source failure when iterator cleanup also fails", async () => {
  const adapter = createProductionApplicationAdapter("otel-console", {
    stream() {
      const iterator: AsyncIterableIterator<readonly string[]> = {
        [Symbol.asyncIterator]() {
          return iterator;
        },
        next(): Promise<IteratorResult<readonly string[]>> {
          return Promise.reject(new Error("source failed"));
        },
        return(): Promise<IteratorResult<readonly string[]>> {
          return Promise.reject(new Error("cleanup failed"));
        },
      };
      return iterator;
    },
  });
  await expect(adapter.refresh()).rejects.toThrow("source failed");
});

test("text record streams preserve split lines, bound batches, and cancel readers", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("one\nt"));
      controller.enqueue(encoder.encode("wo\nthree"));
      controller.close();
    },
  });
  const controller = new AbortController();
  const batches: Array<readonly string[]> = [];
  for await (const batch of readTextLineBatches(stream, controller.signal, 2)) {
    batches.push(batch);
  }
  expect(batches).toEqual([["one", "two"], ["three"]]);

  let cancelled = false;
  const blocked = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const cancelledController = new AbortController();
  const next = readTextLineBatches(blocked, cancelledController.signal)
    [Symbol.asyncIterator]()
    .next();
  cancelledController.abort(new Error("cancelled"));
  await expect(next).rejects.toThrow("cancelled");
  expect(cancelled).toBeTrue();

  const oversized = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(encoder.encode("123456789"));
      streamController.close();
    },
  });
  const oversizedRead = async () => {
    for await (const _batch of readTextLineBatches(
      oversized,
      new AbortController().signal,
      2,
      8,
    )) {
      // Consume the bounded stream to surface parser failures.
    }
  };
  await expect(oversizedRead()).rejects.toThrow(
    "exceeds the 8-character limit",
  );
});

const examples = [
  ["minimal", "Hello from tuil"],
  ["forms", "Project name"],
  ["dashboard", "Delivery dashboard"],
  ["project-wizard", "tuil init"],
  ["command-center", "Command center"],
  ["file-browser", "File browser"],
  ["ai-assistant", "AI assistant"],
  ["full-screen", "Discovering workspace capabilities"],
  ["git-client", "TUIL Git client"],
  ["log-explorer", "TUIL log explorer"],
  ["otel-console", "TUIL OpenTelemetry console"],
  ["ai-coding-assistant", "TUIL AI coding assistant"],
  ["deployment-dashboard", "TUIL deployment dashboard"],
  ["file-manager", "TUIL file manager"],
  ["workflow-runner", "TUIL workflow runner"],
  ["docs-browser", "TUIL terminal documentation browser"],
] as const satisfies readonly (readonly [ExampleKind, string])[];

const productionExamples = examples.slice(8).map(([kind]) => kind);
const ownedProductionApplications = [
  [
    "git-client",
    GitClientApplication,
    "feature/logs",
    [
      JSON.stringify({
        kind: "branch",
        name: "feature/logs",
        current: true,
      }),
      JSON.stringify({
        kind: "change",
        status: "M",
        path: "packages/example.ts",
      }),
    ],
  ],
  ["log-explorer", LogExplorerApplication, "api ready", ["api ready"]],
  ["otel-console", OpenTelemetryConsoleApplication, "trace=abc", ["trace=abc"]],
  [
    "ai-coding-assistant",
    AiCodingAssistantApplication,
    "workspace-read",
    ["agent=planner capability=workspace-read status=ready"],
  ],
  [
    "deployment-dashboard",
    DeploymentDashboardApplication,
    "deploying",
    [
      JSON.stringify({
        id: "worker",
        service: "worker",
        status: "deploying",
        region: "us-west-2",
      }),
    ],
  ],
  ["file-manager", FileManagerApplication, "README.md", ["src", "README.md"]],
  [
    "workflow-runner",
    WorkflowRunnerApplication,
    "validate",
    ["validate:complete", "build:running"],
  ],
  ["docs-browser", DocsBrowserApplication, "Renderers", ["Renderers"]],
] as const;

for (const [kind, expected] of examples) {
  test(`${kind} example renders a working application`, async () => {
    const instance = renderTuil(createElement(ExampleApplication, { kind }));
    await instance.ready;
    await waitForFrameText(instance, expected);
    expect(instance.screen.frame()).toContain(expected);
    expect(instance.screen.snapshot().nodes.length).toBeGreaterThan(0);
    await instance.cleanup();
  });
}

for (const [
  kind,
  Application,
  expected,
  records,
] of ownedProductionApplications) {
  test(`${kind} owns and exercises its production workflow`, async () => {
    const source: ProductionRecordSource = {
      async *stream() {
        yield records;
      },
    };
    const instance = renderTuil(
      createElement(
        Application as ComponentType<{
          readonly source?: ProductionRecordSource;
        }>,
        { source },
      ),
    );
    await instance.ready;
    await waitForFrameText(instance, expected);
    expect(instance.screen.frame()).toContain(expected);
    await waitForFrameText(instance, "revision 1");
    expect(instance.screen.frame()).toContain("revision 1");
    if (kind === "log-explorer") {
      expect(instance.app.logPipelines.values()).toHaveLength(1);
    }
    await instance.app.commands.execute(`${kind}.refresh`);
    await waitForFrameText(instance, "revision 2");
    expect(instance.screen.frame()).toContain("revision 2");
    await instance.cleanup();
    if (kind === "log-explorer") {
      expect(instance.app.logPipelines.values()).toEqual([]);
    }
  });
}

test("git client maps repository records and delegates safe actions", async () => {
  const calls: string[][] = [];
  const source = createGitRepositorySource(async (...arguments_) => {
    calls.push([...arguments_]);
    if (arguments_[0] === "branch") return "*|main\n |feature/logging";
    if (arguments_[0] === "status") return "M  packages/example.ts";
    if (arguments_[0] === "diff") return "diff --git a/example b/example";
    return "";
  });
  const batches: string[][] = [];
  for await (const batch of source.stream(new AbortController().signal)) {
    batches.push([...batch]);
  }
  expect(batches).toHaveLength(2);
  expect(batches.flat().join("\n")).toContain('"current":true');
  expect(batches.flat().join("\n")).toContain('"path":"packages/example.ts"');
  expect(await source.read?.("packages/example.ts")).toContain("diff --git");
  await source.execute?.("stage", "packages/example.ts");
  await source.execute?.("unstage", "packages/example.ts");
  await source.execute?.("checkout", "feature/logging");
  await expect(source.execute?.("unknown", "value")).rejects.toThrow(
    'Unsupported Git action "unknown"',
  );
  expect(calls).toContainEqual(["add", "--", "packages/example.ts"]);
  expect(calls).toContainEqual([
    "restore",
    "--staged",
    "--",
    "packages/example.ts",
  ]);
  expect(calls).toContainEqual(["switch", "feature/logging"]);
});

test("docs browser navigates and reads selected documents", async () => {
  const source: ProductionRecordSource = {
    async *stream() {
      yield ["first.mdx", "second.mdx"];
    },
    read: async (path) => `# Document ${path}`,
  };
  const instance = renderTuil(
    createElement(
      DocsBrowserApplication as ComponentType<{
        readonly source?: ProductionRecordSource;
      }>,
      { source },
    ),
  );
  await instance.ready;
  await waitForFrameText(instance, "Document first.mdx");
  await instance.user.press("arrowDown");
  await waitForFrameText(instance, "Document second.mdx");
  await instance.user.press("arrowUp");
  await waitForFrameText(instance, "Document first.mdx");
  await instance.user.press("tab");
  expect(instance.screen.frame()).toContain("Document first.mdx");
  await instance.cleanup();
});

test("OpenTelemetry console ships deterministic data and filters its log model", async () => {
  expect(defaultOpenTelemetryRecords).toHaveLength(2);
  expect(openTelemetryConsoleQuery("severity >= error")).toBe(
    "severity >= error",
  );
  expect(openTelemetryConsoleQuery("worker")).toContain(
    'body contains "worker"',
  );
  const exports: string[] = [];
  const Application =
    OpenTelemetryConsoleApplication as ComponentType<OpenTelemetryConsoleApplicationProps>;
  const instance = renderTuil(
    createElement(Application, {
      onExport: (snapshot) => exports.push(snapshot),
    }),
    { plugins: [openTelemetryConsolePlugin] },
  );
  await instance.ready;
  await waitForFrameText(instance, "gateway ready");
  expect(instance.screen.frame()).toContain("gateway ready");
  expect(instance.screen.frame()).toContain("worker timeout");
  expect(instance.screen.frame()).toContain("trace=abc123");
  expect(instance.screen.frame()).toContain("transformer: otel-console");
  expect(instance.screen.frame()).toContain("operation: succeeded");
  expect(instance.app.logPipelines.values()).toHaveLength(1);
  expect(instance.app.streamingPipelines.values()).toHaveLength(1);
  expect(
    (
      instance.app.extensions.logParsers.values() as readonly {
        readonly id: string;
      }[]
    ).map((parser) => parser.id),
  ).toContain("otel-console");
  expect(instance.app.extensions.operationExecutors.values()).toHaveLength(1);

  expect(instance.app.focus.focus("otel-console-search")).toBeTrue();
  await instance.user.type("timeout");
  await Bun.sleep(20);
  expect(instance.screen.frame()).toContain("worker timeout");
  expect(instance.screen.frame()).not.toContain("gateway ready");
  await instance.app.commands.execute("otel-console.toggle-detail");
  await waitForFrameText(instance, "OpenTelemetry log detail");
  expect(instance.screen.frame()).toContain("OpenTelemetry log detail");
  expect(instance.screen.frame()).toContain('"tuil.parser": "otel-console"');
  await instance.user.press("escape");

  await instance.app.commands.execute("otel-console.export");
  expect(exports).toHaveLength(1);
  expect(exports[0]).toContain('"traceId":"fed321"');
  const runtimePipeline = instance.app.logPipelines.values()[0];
  expect(runtimePipeline).toBeDefined();
  if (!runtimePipeline) throw new Error("runtime log pipeline is missing");
  expect(exports[0]).toBe(exportOpenTelemetrySnapshot(runtimePipeline));
  await instance.cleanup();
  expect(instance.app.logPipelines.values()).toEqual([]);
  expect(instance.app.streamingPipelines.values()).toEqual([]);
  expect(instance.app.extensions.operationExecutors.values()).toEqual([]);
});

test("OpenTelemetry console exposes long operations and runtime resources to devtools", async () => {
  let release: ((records: readonly string[]) => void) | undefined;
  const source: ProductionRecordSource = {
    async *stream() {
      yield await new Promise<readonly string[]>((resolve) => {
        release = resolve;
      });
    },
  };
  const operationView = renderTuil(
    createElement(
      OpenTelemetryConsoleApplication as ComponentType<OpenTelemetryConsoleApplicationProps>,
      { source },
    ),
    { plugins: [openTelemetryConsolePlugin] },
  );
  await operationView.ready;
  await waitForFrameText(operationView, "operation: running");
  expect(operationView.screen.frame()).toContain("operation: running");
  release?.(defaultOpenTelemetryRecords);
  await waitForFrameText(operationView, "gateway ready");
  expect(operationView.screen.frame()).toContain("operation: succeeded");
  await operationView.cleanup();

  const devtoolsView = renderTuil(
    createElement(
      OpenTelemetryConsoleApplication as ComponentType<OpenTelemetryConsoleApplicationProps>,
      { devtoolsInitiallyOpen: true },
    ),
    { plugins: [openTelemetryConsolePlugin] },
  );
  await devtoolsView.ready;
  await waitForFrameText(devtoolsView, "gateway ready");
  await devtoolsView.user.press("/");
  await devtoolsView.user.press("log state");
  await devtoolsView.user.press("enter");
  expect(devtoolsView.screen.frame()).toContain("log-pipeline-1");
  expect(devtoolsView.screen.frame()).toContain("otel-console");
  await devtoolsView.cleanup();

  const operationsView = renderTuil(
    createElement(
      OpenTelemetryConsoleApplication as ComponentType<OpenTelemetryConsoleApplicationProps>,
      { devtoolsInitiallyOpen: true },
    ),
    { plugins: [openTelemetryConsolePlugin] },
  );
  await operationsView.ready;
  await waitForFrameText(operationsView, "gateway ready");
  await operationsView.user.press("/");
  await operationsView.user.press("active operations");
  await operationsView.user.press("enter");
  expect(operationsView.screen.frame()).toContain("otel-console.load");
  await operationsView.cleanup();
});

test("OpenTelemetry console has a deterministic static application surface", async () => {
  const app = createApp({
    id: "otel-console-static",
    component: OpenTelemetryConsoleApplication,
    plugins: [openTelemetryConsolePlugin],
    terminal: { mode: "static" },
  });
  const frame = await renderStatic(app);
  expect(frame).toContain("TUIL OpenTelemetry console");
  expect(frame).toContain("OpenTelemetry stream and trace correlation");
  expect(frame).toContain("e static export");
  await app.stop();
});

test("production examples expose live search and refresh behavior", async () => {
  for (const kind of productionExamples) {
    const instance = renderTuil(createElement(ExampleApplication, { kind }));
    await instance.ready;
    await waitForFrameText(instance, "revision 1");
    await instance.app.commands.execute(`${kind}.refresh`);
    await waitForFrameText(instance, "revision 2");
    expect(instance.screen.frame()).toContain("revision 2");
    expect(instance.app.focus.focus(`${kind}-search`)).toBeTrue();
    await instance.user.type("worker");
    await Bun.sleep(10);
    expect(instance.screen.frame()).toContain("1 records");
    await instance.cleanup();
  }
});

test("examples execute their interactive callbacks and cleanup paths", async () => {
  const forms = renderTuil(
    createElement(ExampleApplication, { kind: "forms" }),
  );
  await forms.ready;
  await forms.user.type("x");
  await forms.app.commands.execute("profile.submit");
  await Bun.sleep(10);
  expect(forms.screen.frame()).toContain("Submitted: terminal-appx");
  await forms.cleanup();

  const commands = renderTuil(
    createElement(ExampleApplication, { kind: "command-center" }),
  );
  await commands.ready;
  await commands.user.type("build");
  await commands.user.press("enter");
  expect(commands.screen.frame()).toContain("Build started");
  await commands.app.commands.execute("project.test");
  await Bun.sleep(25);
  expect(commands.screen.frame()).toContain("Tests started");
  await commands.cleanup();

  const files = renderTuil(
    createElement(ExampleApplication, { kind: "file-browser" }),
  );
  await files.ready;
  await files.user.press("arrowRight");
  await files.user.press("enter");
  expect(files.screen.frame()).toContain("Selected: src/index");
  await files.cleanup();

  const assistant = renderTuil(
    createElement(ExampleApplication, { kind: "ai-assistant" }),
  );
  await assistant.ready;
  await assistant.user.press("unhandled");
  await assistant.user.press("r");
  expect(assistant.screen.frame()).toContain("tool: read test results");
  await assistant.cleanup();

  const wizard = renderTuil(
    createElement(ExampleApplication, { kind: "project-wizard" }),
  );
  await wizard.ready;
  expect(wizard.app.focus.focus("cancel-init")).toBeTrue();
  await wizard.user.press("enter");
  await Bun.sleep(10);
  expect(wizard.screen.frame()).toContain("cancelled");
  await wizard.cleanup();

  const completedWizard = renderTuil(
    createElement(ExampleApplication, { kind: "project-wizard" }),
  );
  await completedWizard.ready;
  const focusWhenReady = async (id: string): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (completedWizard.app.focus.focus(id)) return;
      await Bun.sleep(1);
    }
    throw new Error(`Focus target "${id}" was not registered`);
  };
  for (const id of [
    "init-project-name",
    "init-template",
    "init-features",
    "review-project",
  ]) {
    await focusWhenReady(id);
    await completedWizard.user.press(
      id === "init-features" ? "space" : "enter",
    );
    if (id === "init-template") await completedWizard.user.press("enter");
    await Bun.sleep(10);
  }
  const confirm = completedWizard.screen.getByRole("button", {
    name: "Create project",
  });
  expect(confirm.id).toBeDefined();
  expect(completedWizard.app.focus.focus(confirm.id as string)).toBeTrue();
  await completedWizard.user.press("enter");
  await Bun.sleep(10);
  expect(completedWizard.screen.frame()).toContain("created project-wizard");
  await completedWizard.cleanup();
});

test("example runner stops cleanly on interrupt", async () => {
  setTimeout(() => {
    process.emit("SIGINT", "SIGINT");
  }, 25);
  await runExample("minimal");
});

test("full-screen example transitions, handles menus, prompts, and resizes", async () => {
  const logo = await loadLogo();
  expect(logo.width).toBe(160);
  expect(logo.height).toBeGreaterThan(0);
  const fullScreen = renderTuil(
    createElement(ExampleApplication, {
      kind: "full-screen",
      logo,
      splashDurationMs: 20,
      loadingMessageIntervalMs: 5,
    }),
    {
      terminal: {
        capabilities: {
          width: 100,
          height: 30,
          alternateScreen: true,
          colorDepth: 24,
          unicode: true,
        },
      },
    },
  );
  await fullScreen.ready;
  expect(
    fullScreen.screen.getByRole("image", {
      name: "tuil terminal interface logo",
    }),
  ).toBeDefined();
  await Bun.sleep(75);
  expect(fullScreen.screen.frame()).toContain("Workspace activity");
  expect(
    fullScreen.screen.getByRole("textbox", { name: "Workspace prompt" }),
  ).toBeDefined();

  const fileMenuBinding = await fullScreen.app.hotkeys.dispatch(
    "f",
    { alt: true },
    { activeScopes: { application: true } },
  );
  expect(fileMenuBinding?.keys).toBe("alt+f");
  await waitForFrameText(fullScreen, "New session");
  await fullScreen.user.press("escape");
  await fullScreen.app.hotkeys.dispatch(
    "e",
    { alt: true },
    { activeScopes: { application: true } },
  );
  await waitForFrameText(fullScreen, "Copy selection");
  await fullScreen.user.press("escape");
  await fullScreen.app.hotkeys.dispatch(
    "h",
    { alt: true },
    { activeScopes: { application: true } },
  );
  await waitForFrameText(fullScreen, "Keyboard shortcuts");
  await fullScreen.user.press("escape");
  await fullScreen.app.hotkeys.dispatch(
    "f",
    { meta: true },
    { activeScopes: { application: true } },
  );
  await waitForFrameText(fullScreen, "Open workspace");
  await fullScreen.user.press("escape");
  await fullScreen.app.hotkeys.dispatch(
    "e",
    { meta: true },
    { activeScopes: { application: true } },
  );
  await waitForFrameText(fullScreen, "Clear activity");
  await fullScreen.user.press("escape");
  await fullScreen.user.type("Summarize this workspace");
  expect(
    fullScreen.screen.getByRole("textbox", { name: "Workspace prompt" })
      .valueText,
  ).toContain("Summarize this workspace");
  await fullScreen.user.press("enter");
  expect(fullScreen.screen.frame()).toContain("USER  Summarize this workspace");

  await fullScreen.app.commands.execute("session.new");
  await fullScreen.app.commands.execute("activity.clear");
  await fullScreen.app.commands.execute("help.about");
  await waitForFrameText(fullScreen, "Activity cleared");
  await waitForFrameText(fullScreen, "tuil full-screen example");
  expect(fullScreen.screen.frame()).toContain("Activity cleared");
  expect(fullScreen.screen.frame()).toContain("tuil full-screen example");

  await fullScreen.app.hotkeys.dispatch(
    "h",
    { meta: true },
    { activeScopes: { application: true } },
  );
  await Bun.sleep(50);
  await fullScreen.user.press("enter");
  expect(fullScreen.screen.frame()).toContain("Selected Keyboard shortcuts");

  fullScreen.resize(48, 18);
  await Bun.sleep(25);
  expect(fullScreen.screen.frame()).not.toContain(
    "Image + hotkeys + responsive layout active",
  );
  fullScreen.resize(132, 36);
  await Bun.sleep(25);
  expect(fullScreen.screen.frame()).toContain("Context");
  await fullScreen.cleanup();
});

test("full-screen example skips animation outside interactive terminals", async () => {
  const staticView = renderTuil(
    createElement(ExampleApplication, { kind: "full-screen" }),
    {
      terminal: {
        mode: "static",
        capabilities: { interactive: false, tty: false },
      },
    },
  );
  await staticView.ready;
  await Bun.sleep(10);
  expect(staticView.screen.frame()).toContain("Workspace activity");
  await staticView.cleanup();

  const staticApp = createApp({
    component: () => createElement(ExampleApplication, { kind: "full-screen" }),
    terminal: { mode: "static" },
  });
  const frame = await renderStatic(staticApp);
  expect(frame).toContain("Workspace activity");
  expect(frame).not.toContain("Discovering workspace capabilities");
});
