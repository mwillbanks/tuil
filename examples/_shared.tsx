import {
  createApp,
  defineCommand,
  type TuilAppOptions,
  type TuilRuntime,
  useApp,
} from "@mwillbanks/tuil";
import { useHotkeys } from "@mwillbanks/tuil-hotkeys";
import {
  Badge,
  Box,
  Button,
  Heading,
  Progress,
  render,
  TerminalImage,
  type TerminalImageSource,
  Text,
  useTerminalInput,
  useTerminalSize,
  useTerminalViewport,
} from "@mwillbanks/tuil-ink";
import type { LogViewerModel } from "@mwillbanks/tuil-log-viewer";
import {
  createElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { InitWizard } from "../registry/blocks/init-wizard.tsx";
import { AppBar } from "../registry/components/app-bar.tsx";
import { AppShell } from "../registry/components/app-shell.tsx";
import { StatusBar } from "../registry/components/status-bar.tsx";
import {
  Table,
  type TableColumn,
  type TableProps,
} from "../registry/data-display/complex-data.tsx";
import { LogViewer } from "../registry/data-display/log-viewer.tsx";
import {
  BarChart,
  CodeViewer,
  MarkdownViewer,
  RichDiffViewer,
  StructuredContentSummary,
  Timeline,
} from "../registry/data-display/rich-content.tsx";
import { Tree } from "../registry/data-display/tree.tsx";
import { CommandPalette } from "../registry/feedback/overlays.tsx";
import { Spinner } from "../registry/feedback/spinner.tsx";
import {
  Field,
  Form,
  SearchInput,
  TextInput,
} from "../registry/forms/controls.tsx";
import { SplitPane } from "../registry/layout/panes.tsx";
import {
  Menu,
  type NavigationItem,
  Outline,
} from "../registry/navigation/navigation.tsx";

export type ExampleKind =
  | "minimal"
  | "forms"
  | "dashboard"
  | "project-wizard"
  | "command-center"
  | "file-browser"
  | "ai-assistant"
  | "full-screen"
  | "git-client"
  | "log-explorer"
  | "otel-console"
  | "ai-coding-assistant"
  | "deployment-dashboard"
  | "file-manager"
  | "workflow-runner"
  | "docs-browser";

function Minimal(): ReactNode {
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "Hello from tuil"),
    createElement(Text, null, "A complete terminal application."),
  );
}

function Forms(): ReactNode {
  const [submitted, setSubmitted] = useState("not submitted");
  return createElement(
    Form,
    {
      id: "profile",
      onSubmit: (values) => setSubmitted(String(values["name"] ?? "")),
    },
    createElement(
      Field,
      {
        label: "Project name",
        hint: "Press enter to validate",
      },
      createElement(TextInput, {
        id: "name",
        label: "Project name",
        defaultValue: "terminal-app",
        autoFocus: true,
      }),
    ),
    createElement(Text, { role: "status" }, `Submitted: ${submitted}`),
  );
}

const jobs = Object.freeze([
  { id: "build", name: "Build", status: "passing" },
  { id: "test", name: "Tests", status: "passing" },
  { id: "deploy", name: "Deploy", status: "waiting" },
]);
type Job = (typeof jobs)[number];
const jobColumns: readonly TableColumn<Job>[] = Object.freeze([
  { id: "job", header: "Job", accessor: (row) => row.name, width: 20 },
  {
    id: "status",
    header: "Status",
    accessor: (row) => row.status,
    width: 12,
  },
]);
const JobTable = Table as (props: TableProps<Job>) => ReactNode;

function Dashboard(): ReactNode {
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "Delivery dashboard"),
    createElement(Progress, {
      label: "Release progress",
      value: 0.67,
      max: 1,
    }),
    createElement(JobTable, {
      label: "Pipeline jobs",
      rows: jobs,
      columns: jobColumns,
      getRowKey: (row) => row.id,
      height: 5,
      width: 40,
    }),
  );
}

function ProjectWizard(): ReactNode {
  const [result, setResult] = useState("in progress");
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(InitWizard, {
      initialName: "project-wizard",
      onComplete: (answers) => setResult(`created ${answers.name}`),
      onCancel: () => setResult("cancelled"),
    }),
    createElement(Text, { role: "status" }, result),
  );
}

function CommandCenter(): ReactNode {
  const app = useApp();
  const [message, setMessage] = useState("Open the palette with ctrl+k");
  useEffect(() => {
    const registrations = [
      app.commands.register(
        defineCommand({
          id: "project.build",
          title: "Build project",
          category: "Project",
          execute: () => setMessage("Build started"),
        }),
      ),
      app.commands.register(
        defineCommand({
          id: "project.test",
          title: "Run tests",
          category: "Project",
          execute: () => setMessage("Tests started"),
        }),
      ),
    ];
    return () => {
      for (const registration of registrations) {
        void registration.dispose();
      }
    };
  }, [app.commands]);
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "Command center"),
    createElement(Text, { role: "status" }, message),
    createElement(CommandPalette, { defaultOpen: true }),
  );
}

const fileTree = Object.freeze([
  {
    id: "src",
    label: "src",
    children: [
      { id: "src/index", label: "index.tsx" },
      { id: "src/app", label: "app.tsx" },
    ],
  },
  { id: "package", label: "package.json" },
]);

function FileBrowser(): ReactNode {
  const [selected, setSelected] = useState("none");
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "File browser"),
    createElement(Tree, {
      label: "Project files",
      items: fileTree,
      defaultExpandedIds: ["src"],
      autoFocus: true,
      onSelect: (item) => setSelected(item.id),
    }),
    createElement(Text, { role: "status" }, `Selected: ${selected}`),
  );
}

function AiAssistant(): ReactNode {
  const [lines, setLines] = useState<readonly string[]>([
    "user: Summarize the build",
    "assistant: Build is passing.",
  ]);
  useTerminalInput((input) => {
    if (input !== "r") return false;
    setLines((current) => [
      ...current,
      "tool: read test results",
      "assistant: All checks passed.",
    ]);
    return true;
  });
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "AI assistant"),
    createElement(Badge, { label: "connected" }, "connected"),
    createElement(LogViewer, {
      label: "Conversation",
      lines,
      height: 8,
      width: 60,
      follow: true,
    }),
    createElement(Button, { label: "Run tool" }, "Press r to run a tool"),
  );
}

const productionTitles = Object.freeze({
  "git-client": "TUIL Git client",
  "log-explorer": "TUIL log explorer",
  "otel-console": "TUIL OpenTelemetry console",
  "ai-coding-assistant": "TUIL AI coding assistant",
  "deployment-dashboard": "TUIL deployment dashboard",
  "file-manager": "TUIL file manager",
  "workflow-runner": "TUIL workflow runner",
  "docs-browser": "TUIL terminal documentation browser",
});

type ProductionExampleKind = keyof typeof productionTitles;

function ProductionSurface(props: {
  readonly kind: ProductionExampleKind;
  readonly lines: readonly string[];
}): ReactNode {
  if (props.kind === "git-client") {
    return (
      <SplitPane
        id="git-panes"
        panes={[
          {
            id: "branches",
            content: (
              <Tree
                label="Repository"
                items={[
                  {
                    id: "main",
                    label: "main",
                    children: [{ id: "feature", label: "feature/logs" }],
                  },
                ]}
                defaultExpandedIds={["main"]}
              />
            ),
          },
          {
            id: "changes",
            content: <RichDiffViewer source="@@ -1 +1 @@&#10;-old&#10;+new" />,
          },
        ]}
      />
    );
  }
  if (props.kind === "log-explorer") {
    return (
      <SplitPane
        id="log-panes"
        panes={[
          {
            id: "stream",
            content: (
              <LogViewer
                label="Live stream"
                lines={props.lines}
                height={12}
                width={50}
                follow
              />
            ),
          },
          {
            id: "facets",
            content: (
              <BarChart
                data={[
                  { label: "api", value: 42 },
                  { label: "worker", value: 18 },
                ]}
              />
            ),
          },
        ]}
      />
    );
  }
  if (props.kind === "otel-console") {
    return (
      <Box flexDirection="column">
        <Timeline
          items={[
            {
              id: "1",
              time: "10:00:00",
              title: "api",
              description: "span abc",
            },
            {
              id: "2",
              time: "10:00:01",
              title: "worker",
              description: "retry",
            },
          ]}
        />
        <StructuredContentSummary
          value={{ traceId: "abc", service: "api", severity: "warn" }}
        />
      </Box>
    );
  }
  if (props.kind === "ai-coding-assistant") {
    return (
      <SplitPane
        id="assistant-panes"
        panes={[
          {
            id: "conversation",
            content: (
              <LogViewer
                label="Conversation"
                lines={["user: fix parser", "assistant: inspecting tests"]}
                height={8}
              />
            ),
          },
          {
            id: "code",
            content: (
              <CodeViewer
                language="typescript"
                source="export const ready = true;"
              />
            ),
          },
        ]}
      />
    );
  }
  if (props.kind === "deployment-dashboard") {
    return <Dashboard />;
  }
  if (props.kind === "file-manager") {
    return <FileBrowser />;
  }
  if (props.kind === "workflow-runner") {
    return (
      <Box flexDirection="column">
        <Progress label="Workflow progress" value={2} max={3} />
        <Timeline
          items={[
            {
              id: "validate",
              time: "1",
              title: "Validate",
              description: "done",
            },
            { id: "build", time: "2", title: "Build", description: "running" },
            {
              id: "deploy",
              time: "3",
              title: "Deploy",
              description: "waiting",
            },
          ]}
        />
      </Box>
    );
  }
  return (
    <SplitPane
      id="docs-panes"
      panes={[
        {
          id: "outline",
          content: (
            <Outline
              items={[
                { id: "intro", label: "Introduction", selected: true },
                { id: "renderers", label: "Renderers", depth: 1 },
                { id: "logging", label: "Logging", depth: 1 },
              ]}
            />
          ),
        },
        {
          id: "document",
          content: (
            <MarkdownViewer source="# TUIL docs&#10;Build terminal applications." />
          ),
        },
      ]}
    />
  );
}

export interface ProductionApplicationContext {
  readonly lines: readonly string[];
  readonly query: string;
  readonly revision: number;
  readonly execute: (action: string, input?: unknown) => Promise<void>;
  readonly read: (id: string) => Promise<string>;
}

export interface ProductionRecordSource {
  /**
   * Pull-based batches are preferred for production sources. A producer does
   * not read the next batch until the current batch has been retained and
   * published, which gives the consumer real backpressure.
   */
  stream(signal: AbortSignal): AsyncIterable<readonly string[]>;
  readonly batchSize?: number;
  readonly retentionLimit?: number;
  subscribe?(
    observer: (records: readonly string[]) => void,
  ): undefined | (() => void);
  execute?(action: string, input?: unknown): void | Promise<void>;
  read?(id: string): string | Promise<string>;
}

async function settleSupersededRefresh(
  refresh: Promise<void> | undefined,
): Promise<void> {
  try {
    await refresh;
  } catch {
    // A superseded refresh has no bearing on the latest request.
  }
}

function awaitAbortable<T>(
  value: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const rejectAborted = () =>
      reject(signal.reason ?? new Error("Production source was aborted"));
    if (signal.aborted) {
      rejectAborted();
      return;
    }
    signal.addEventListener("abort", rejectAborted, { once: true });
    void Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener("abort", rejectAborted);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", rejectAborted);
        reject(error);
      },
    );
  });
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error("Production source limits must be positive safe integers");
  }
  return resolved;
}

export async function* readProductionRecordBatches(
  source: ProductionRecordSource,
  signal: AbortSignal,
): AsyncGenerator<readonly string[]> {
  const batchSize = positiveInteger(source.batchSize, 250);
  const iterator = source.stream(signal)[Symbol.asyncIterator]();
  let failed = false;
  let failure: unknown;
  try {
    while (!signal.aborted) {
      const next = await awaitAbortable(iterator.next(), signal);
      if (next.done) return;
      for (let offset = 0; offset < next.value.length; offset += batchSize) {
        signal.throwIfAborted();
        yield Object.freeze(next.value.slice(offset, offset + batchSize));
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      failed = true;
      failure = error;
    }
  } finally {
    try {
      await iterator.return?.(undefined);
    } catch (cleanupError) {
      if (!failed && !signal.aborted) {
        failed = true;
        failure = cleanupError;
      }
    }
  }
  if (failed) throw failure;
}

interface DecodedLineState {
  readonly pending: string;
  readonly retained: readonly string[];
  readonly batches: readonly (readonly string[])[];
}

function decodeLineChunk(
  decoder: TextDecoder,
  pending: string,
  retained: readonly string[],
  chunk: Uint8Array | undefined,
  done: boolean,
  limit: number,
  maxRecordLength: number,
): DecodedLineState {
  const decoded = pending + decoder.decode(chunk, { stream: !done });
  const lines = decoded.split(/\r?\n/);
  const nextPending = done ? "" : (lines.pop() ?? "");
  for (const line of lines) {
    if (line.length > maxRecordLength) {
      throw new RangeError(
        `Production record exceeds the ${maxRecordLength}-character limit`,
      );
    }
  }
  if (nextPending.length > maxRecordLength) {
    throw new RangeError(
      `Production record exceeds the ${maxRecordLength}-character limit`,
    );
  }
  const records = [...retained, ...lines.filter(Boolean)];
  const complete = Math.floor(records.length / limit);
  return Object.freeze({
    pending: nextPending,
    retained: Object.freeze(records.slice(complete * limit)),
    batches: Object.freeze(
      Array.from({ length: complete }, (_, index) =>
        Object.freeze(records.slice(index * limit, (index + 1) * limit)),
      ),
    ),
  });
}

export async function* readTextLineBatches(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  batchSize = 250,
  maxRecordLength = 1_048_576,
): AsyncGenerator<readonly string[]> {
  const limit = positiveInteger(batchSize, 250);
  const recordLimit = positiveInteger(maxRecordLength, 1_048_576);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let retained: readonly string[] = [];
  const cancel = () => {
    void reader.cancel(signal.reason);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      const decoded = decodeLineChunk(
        decoder,
        pending,
        retained,
        value,
        done,
        limit,
        recordLimit,
      );
      pending = decoded.pending;
      retained = decoded.retained;
      for (const batch of decoded.batches) yield batch;
      if (done) break;
    }
    signal.throwIfAborted();
    if (retained.length > 0) yield Object.freeze(retained);
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function retainRecords(
  current: readonly string[],
  batch: readonly string[],
  limit: number,
): readonly string[] {
  if (batch.length >= limit) return Object.freeze(batch.slice(-limit));
  return Object.freeze([...current, ...batch].slice(-limit));
}

export class ProductionApplicationAdapter {
  readonly id: ProductionExampleKind;
  readonly #source: ProductionRecordSource;
  readonly #retentionLimit: number;
  readonly #actions: Readonly<
    Record<string, (input?: unknown) => void | Promise<void>>
  >;
  readonly #read?: (id: string) => string | Promise<string>;
  readonly #subscribe?: ProductionRecordSource["subscribe"];
  readonly #execute?: ProductionRecordSource["execute"];
  readonly #observers = new Set<() => void>();
  #records: readonly string[];
  #revision = 0;
  #refreshSequence = 0;
  #refreshController?: AbortController;
  #activeRefresh?: Promise<void>;
  #disposed = false;
  #snapshot: {
    readonly records: readonly string[];
    readonly revision: number;
  };

  constructor(options: {
    readonly id: ProductionExampleKind;
    readonly records: readonly string[];
    readonly source?: ProductionRecordSource;
    readonly actions?: Readonly<
      Record<string, (input?: unknown) => void | Promise<void>>
    >;
    readonly read?: (id: string) => string | Promise<string>;
    readonly subscribe?: ProductionRecordSource["subscribe"];
    readonly execute?: ProductionRecordSource["execute"];
  }) {
    this.id = options.id;
    this.#source =
      options.source ??
      ({
        async *stream() {
          yield options.records;
        },
      } satisfies ProductionRecordSource);
    this.#retentionLimit = positiveInteger(this.#source.retentionLimit, 10_000);
    this.#records = Object.freeze(options.records.slice(-this.#retentionLimit));
    this.#snapshot = Object.freeze({
      records: this.#records,
      revision: this.#revision,
    });
    this.#actions = Object.freeze({ ...options.actions });
    this.#read = options.read;
    this.#subscribe = options.subscribe;
    this.#execute = options.execute;
  }

  snapshot = (): {
    readonly records: readonly string[];
    readonly revision: number;
  } => this.#snapshot;

  subscribe = (observer: () => void): (() => void) => {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  };

  refresh(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const sequence = ++this.#refreshSequence;
    const previous = this.#activeRefresh;
    this.#refreshController?.abort(
      new Error(`${this.id} refresh was superseded`),
    );
    const controller = new AbortController();
    this.#refreshController = controller;
    const refresh = this.#performRefresh(controller, sequence, previous);
    this.#activeRefresh = refresh;
    const clearActive = () => {
      if (this.#activeRefresh === refresh) this.#activeRefresh = undefined;
    };
    void refresh.then(clearActive, clearActive);
    return refresh;
  }

  async #performRefresh(
    controller: AbortController,
    sequence: number,
    previous?: Promise<void>,
  ): Promise<void> {
    if (previous) await settleSupersededRefresh(previous);
    if (this.#discardRefresh(controller, sequence)) return;
    try {
      const published = await this.#consumeRefresh(controller, sequence);
      if (!published && !this.#discardRefresh(controller, sequence)) {
        this.#publish([]);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    } finally {
      if (this.#refreshController === controller) {
        this.#refreshController = undefined;
      }
    }
  }

  async #consumeRefresh(
    controller: AbortController,
    sequence: number,
  ): Promise<boolean> {
    let records: readonly string[] = [];
    let published = false;
    for await (const batch of readProductionRecordBatches(
      this.#source,
      controller.signal,
    )) {
      if (this.#discardRefresh(controller, sequence)) return published;
      records = retainRecords(records, batch, this.#retentionLimit);
      this.#publish(records);
      published = true;
    }
    return published;
  }

  #discardRefresh(controller: AbortController, sequence: number): boolean {
    return (
      controller.signal.aborted ||
      this.#disposed ||
      sequence !== this.#refreshSequence
    );
  }

  #publish(records: readonly string[]): void {
    this.#records = Object.freeze([...records]);
    this.#revision += 1;
    this.#snapshot = Object.freeze({
      records: this.#records,
      revision: this.#revision,
    });
    this.#notify();
  }

  #notify(): void {
    for (const observer of this.#observers) {
      try {
        observer();
      } catch {
        // One view subscriber must not prevent the remaining views updating.
      }
    }
  }

  async execute(action: string, input?: unknown): Promise<void> {
    const execute = this.#actions[action];
    if (!execute && !this.#execute)
      throw new Error(`${this.id} action "${action}" is unavailable`);
    if (execute) await execute(input);
    else await this.#execute?.(action, input);
    await this.refresh();
  }

  async read(id: string): Promise<string> {
    return this.#read ? this.#read(id) : id;
  }

  connect(): () => void {
    const disconnect =
      this.#subscribe?.((records) => {
        if (this.#disposed) return;
        this.#refreshSequence += 1;
        this.#refreshController?.abort(
          new Error(`${this.id} refresh was superseded by a subscription`),
        );
        this.#refreshController = undefined;
        this.#publish(Object.freeze(records.slice(-this.#retentionLimit)));
      }) ?? (() => {});
    return () => disconnect();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#refreshSequence += 1;
    this.#refreshController?.abort(new Error(`${this.id} adapter disposed`));
    this.#refreshController = undefined;
    this.#observers.clear();
  }

  export(format: "text" | "json" = "text"): string {
    return format === "json"
      ? JSON.stringify(this.#records)
      : this.#records.join("\n");
  }
}

export function createProductionApplicationAdapter(
  id: ProductionExampleKind,
  source: ProductionRecordSource,
  actions?: Readonly<Record<string, (input?: unknown) => void | Promise<void>>>,
): ProductionApplicationAdapter {
  return new ProductionApplicationAdapter({
    id,
    records: [],
    source,
    actions,
    read: source.read?.bind(source),
    subscribe: source.subscribe?.bind(source),
    execute: source.execute?.bind(source),
  });
}

export function useLogViewerModelLifecycle(
  app: TuilRuntime,
  model: LogViewerModel,
): void {
  useEffect(() => {
    const unregister = app.scroll.register(model.scroll);
    return () => {
      unregister();
      model.dispose();
    };
  }, [app, model]);
}

export function ProductionApplicationShell(props: {
  readonly kind: ProductionExampleKind;
  readonly records?: readonly string[];
  readonly adapter?: ProductionApplicationAdapter;
  readonly children: (context: ProductionApplicationContext) => ReactNode;
}): ReactNode {
  const app = useApp();
  const [query, setQuery] = useState("");
  const fallbackRecordsKey = JSON.stringify(props.records ?? []);
  const fallbackAdapter = useMemo(
    () =>
      new ProductionApplicationAdapter({
        id: props.kind,
        records: JSON.parse(fallbackRecordsKey) as readonly string[],
      }),
    [fallbackRecordsKey, props.kind],
  );
  const adapter = props.adapter ?? fallbackAdapter;
  const snapshot = useSyncExternalStore(
    adapter.subscribe,
    adapter.snapshot,
    adapter.snapshot,
  );
  useEffect(() => {
    let active = true;
    void adapter.refresh().catch((error) => {
      if (active) void app.reportError(error, `${props.kind}:load`);
    });
    return () => {
      active = false;
      adapter.dispose();
    };
  }, [adapter, app, props.kind]);
  useEffect(() => adapter.connect(), [adapter]);
  useEffect(() => {
    const registration = app.commands.register(
      defineCommand({
        id: `${props.kind}.refresh`,
        title: `Refresh ${productionTitles[props.kind]}`,
        category: "Example",
        execute: () => adapter.refresh(),
      }),
    );
    return () => {
      void registration.dispose();
    };
  }, [adapter, app.commands, props.kind]);
  useTerminalInput((input, key) => {
    if (!key.ctrl || input.toLowerCase() !== "r") return false;
    void adapter.refresh();
    return true;
  });
  const lines = [
    `${props.kind}: ready revision=${snapshot.revision}`,
    ...snapshot.records,
  ].filter((line) => line.toLowerCase().includes(query.toLowerCase()));
  return (
    <AppShell width={80} height={24}>
      <AppShell.AppBar>
        <AppBar>
          <Heading level={1}>{productionTitles[props.kind]}</Heading>
          <Button
            id={`${props.kind}-refresh`}
            onPress={() => adapter.refresh()}
          >
            Refresh
          </Button>
        </AppBar>
      </AppShell.AppBar>
      <AppShell.Main>
        <SearchInput
          id={`${props.kind}-search`}
          label="Search"
          value={query}
          onValueChange={setQuery}
          autoFocus
          registerWithForm={false}
        />
        {props.children({
          lines,
          query,
          revision: snapshot.revision,
          execute: (action, input) => adapter.execute(action, input),
          read: (id) => adapter.read(id),
        })}
      </AppShell.Main>
      <AppShell.StatusBar>
        <StatusBar>
          <Text>
            LIVE · {lines.length} records · revision {snapshot.revision} ·
            ctrl+r refresh
          </Text>
        </StatusBar>
      </AppShell.StatusBar>
    </AppShell>
  );
}

const productionExampleRecords = Object.freeze([
  "service=api severity=info operation=load",
  "service=worker severity=warn operation=retry",
]);

function ProductionExample(props: {
  readonly kind: ProductionExampleKind;
}): ReactNode {
  return (
    <ProductionApplicationShell
      kind={props.kind}
      records={productionExampleRecords}
    >
      {({ lines }) => <ProductionSurface kind={props.kind} lines={lines} />}
    </ProductionApplicationShell>
  );
}

const fallbackLogo: TerminalImageSource = Object.freeze({
  width: 4,
  height: 4,
  data: new Uint8Array([
    22, 224, 230, 255, 42, 167, 244, 255, 119, 87, 234, 255, 235, 62, 186, 255,
    22, 224, 230, 255, 0, 0, 0, 0, 0, 0, 0, 0, 235, 62, 186, 255, 42, 167, 244,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 119, 87, 234, 255, 22, 224,
    230, 255, 42, 167, 244, 255, 119, 87, 234, 255, 235, 62, 186, 255,
  ]),
});

const loadingMessages = Object.freeze([
  "Discovering workspace capabilities",
  "Warming responsive layout",
  "Connecting command services",
  "Preparing your terminal",
]);

const menuItems = Object.freeze({
  file: Object.freeze([
    { id: "new-session", label: "New session", command: "session.new" },
    { id: "open-workspace", label: "Open workspace" },
    { id: "quit", label: "Exit preview" },
  ]),
  edit: Object.freeze([
    { id: "undo", label: "Undo" },
    { id: "copy", label: "Copy selection" },
    { id: "clear", label: "Clear activity", command: "activity.clear" },
  ]),
  help: Object.freeze([
    { id: "shortcuts", label: "Keyboard shortcuts" },
    { id: "about", label: "About tuil", command: "help.about" },
  ]),
}) satisfies Readonly<Record<string, readonly NavigationItem[]>>;

type MenuId = keyof typeof menuItems;

function Splash(props: {
  readonly logo: TerminalImageSource;
  readonly message: string;
  readonly width: number;
  readonly height: number;
}): ReactNode {
  const preferredWidth = props.width < 60 ? 18 : props.width < 120 ? 28 : 36;
  const heightConstrainedWidth = Math.max(
    8,
    Math.floor((props.height - 3) * 2.5),
  );
  const logoWidth = Math.min(preferredWidth, heightConstrainedWidth);
  return (
    <Box
      width={props.width}
      height={props.height}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      role="status"
      label="Loading tuil workspace"
    >
      <TerminalImage
        source={props.logo}
        alt="tuil terminal interface logo"
        columns={logoWidth}
      />
      <Spinner label={props.message} />
      <Text dimColor>Full-screen terminal workspace</Text>
    </Box>
  );
}

function WorkspaceContent(props: {
  readonly height: number;
  readonly logHeight: number;
  readonly viewport: ReturnType<typeof useTerminalViewport>;
  readonly logs: readonly string[];
  readonly width: number;
  readonly unicode: boolean;
}): ReactNode {
  const icons = props.unicode
    ? { branch: "●", success: "✓", language: "◆", services: "⌁" }
    : { branch: "*", success: "+", language: "#", services: "~" };
  if (props.viewport === "compact") {
    return (
      <LogViewer
        label="Workspace activity"
        lines={props.logs}
        height={props.logHeight}
        width={Math.max(20, props.width - 4)}
        follow
      />
    );
  }
  if (props.viewport === "regular") {
    return (
      <Box flexDirection="column">
        <Heading level={2}>Workspace activity</Heading>
        <LogViewer
          label="Workspace activity"
          lines={props.logs}
          height={props.logHeight}
          width={Math.max(24, props.width - 4)}
          follow
        />
        {props.height >= 22 ? (
          <Text>
            {icons.branch} main · {icons.success} tests · {icons.services} 3
            services
          </Text>
        ) : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="row" gap={2} flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Heading level={2}>Workspace activity</Heading>
        <LogViewer
          label="Workspace activity"
          lines={props.logs}
          height={props.logHeight}
          width={72}
          follow
        />
      </Box>
      <Box flexDirection="column" minWidth={24}>
        <Heading level={2}>Context</Heading>
        <Text>{icons.branch} main</Text>
        <Text>{icons.success} 128 tests passing</Text>
        <Text>{icons.language} TypeScript</Text>
        <Text>{icons.services} 3 services ready</Text>
      </Box>
    </Box>
  );
}

function useSplashState(
  mode: ReturnType<typeof useApp>["mode"],
  splashDurationMs: number,
  loadingMessageIntervalMs: number,
): { readonly visible: boolean; readonly message: string } {
  const [showSplash, setShowSplash] = useState(mode === "interactive");
  const [loadingMessage, setLoadingMessage] = useState(0);
  useEffect(() => {
    if (mode !== "interactive") {
      setShowSplash(false);
      return;
    }
    if (!showSplash) return;
    const splashTimer = setTimeout(
      () => setShowSplash(false),
      splashDurationMs,
    );
    const messageTimer = setInterval(
      () =>
        setLoadingMessage((current) => (current + 1) % loadingMessages.length),
      loadingMessageIntervalMs,
    );
    return () => {
      clearTimeout(splashTimer);
      clearInterval(messageTimer);
    };
  }, [loadingMessageIntervalMs, mode, showSplash, splashDurationMs]);
  return {
    visible: showSplash,
    message: loadingMessages[loadingMessage] ?? "Loading",
  };
}

function useWorkspaceActivity(app: ReturnType<typeof useApp>) {
  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<readonly string[]>([
    "12:04:01  INFO  Runtime mounted in alternate screen",
    "12:04:02  READY Image renderer negotiated 24-bit color",
    "12:04:02  INFO  Press Alt+F, Alt+E, or Alt+H to open a menu",
  ]);
  useEffect(() => {
    const registrations = [
      app.commands.register(
        defineCommand({
          id: "session.new",
          title: "New session",
          execute: () =>
            setLogs((current) => [...current, "12:04:08  INFO  New session"]),
        }),
      ),
      app.commands.register(
        defineCommand({
          id: "activity.clear",
          title: "Clear activity",
          execute: () => setLogs(["12:04:08  INFO  Activity cleared"]),
        }),
      ),
      app.commands.register(
        defineCommand({
          id: "help.about",
          title: "About tuil",
          execute: () =>
            setLogs((current) => [
              ...current,
              "12:04:08  INFO  tuil full-screen example",
            ]),
        }),
      ),
    ];
    return () => {
      for (const registration of registrations) {
        void registration.dispose();
      }
    };
  }, [app.commands]);
  return {
    logs,
    prompt,
    setPrompt,
    recordMenuSelection(item: NavigationItem) {
      setLogs((current) => [
        ...current,
        `12:04:08  MENU  Selected ${item.label}`,
      ]);
    },
    submitPrompt(value: string) {
      const submitted = value.trim();
      if (!submitted) return;
      setLogs((current) => [
        ...current,
        `12:04:09  USER  ${submitted}`,
        "12:04:09  INFO  Sample response queued",
      ]);
      setPrompt("");
    },
  };
}

function useWorkspaceMenu(app: ReturnType<typeof useApp>) {
  const [active, setActive] = useState<MenuId>();
  const close = useCallback(() => {
    setActive(undefined);
    app.focus.focus("workspace-prompt");
  }, [app.focus]);
  const hotkeys = useMemo(
    () => ({
      "alt+f": () => setActive("file"),
      "alt+e": () => setActive("edit"),
      "alt+h": () => setActive("help"),
      "meta+f": () => setActive("file"),
      "meta+e": () => setActive("edit"),
      "meta+h": () => setActive("help"),
      escape: close,
    }),
    [close],
  );
  const hotkeyOptions = useMemo(() => ({ scope: "application" as const }), []);
  useHotkeys(hotkeys, hotkeyOptions);
  useEffect(() => {
    if (active) app.focus.focus(`workspace-menu-${active}`);
  }, [active, app.focus]);
  return { active, close };
}

function WorkspaceAppBar(props: {
  readonly activeMenu?: MenuId;
  readonly logo: TerminalImageSource;
  readonly compact: boolean;
}): ReactNode {
  return (
    <AppShell.AppBar>
      <AppBar
        width="100%"
        alignItems="center"
        borderStyle="single"
        paddingX={1}
        gap={2}
      >
        <TerminalImage source={props.logo} alt="tuil logo" columns={4} />
        <Text bold color="cyan">
          tuil
        </Text>
        <Text underline={props.activeMenu === "file"}>File</Text>
        <Text underline={props.activeMenu === "edit"}>Edit</Text>
        <Text underline={props.activeMenu === "help"}>Help</Text>
        <Box flexGrow={1} />
        {props.compact ? null : <Text dimColor>Alt/Option+F · E · H</Text>}
      </AppBar>
    </AppShell.AppBar>
  );
}

function WorkspaceMenu(props: {
  readonly active?: MenuId;
  readonly close: () => void;
  readonly onSelect: (item: NavigationItem) => void;
}): ReactNode {
  if (!props.active) return null;
  return (
    <Menu
      id={`workspace-menu-${props.active}`}
      label={`${props.active[0]?.toUpperCase()}${props.active.slice(1)}`}
      items={menuItems[props.active]}
      open
      onOpenChange={(open) => {
        if (!open) props.close();
      }}
      onSelect={(item) => {
        props.onSelect(item);
        props.close();
      }}
    />
  );
}

function WorkspacePrompt(props: {
  readonly prompt: string;
  readonly onPromptChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
}): ReactNode {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold>Prompt</Text>
      <TextInput
        id="workspace-prompt"
        label="Workspace prompt"
        placeholder="Ask tuil to do something…"
        value={props.prompt}
        autoFocus
        registerWithForm={false}
        onValueChange={props.onPromptChange}
        onSubmit={props.onSubmit}
      />
      <Text dimColor>Enter submit · Esc close menu</Text>
    </Box>
  );
}

function WorkspaceStatusBar(props: {
  readonly compact: boolean;
  readonly unicode: boolean;
}): ReactNode {
  const icons = props.unicode
    ? { branch: "●", ready: "✓", speed: "⚡" }
    : { branch: "*", ready: "+", speed: ">" };
  return (
    <AppShell.StatusBar>
      <StatusBar
        width="100%"
        paddingX={1}
        justifyContent="space-between"
        backgroundColor="blue"
      >
        <Text>
          {icons.branch} main · {icons.ready} ready
        </Text>
        {props.compact ? null : (
          <Text>Image + hotkeys + responsive layout active</Text>
        )}
        <Text>{icons.speed} 24 ms</Text>
      </StatusBar>
    </AppShell.StatusBar>
  );
}

function Workspace(props: {
  readonly logo: TerminalImageSource;
  readonly width: number;
  readonly height: number;
}): ReactNode {
  const app = useApp();
  const viewport = useTerminalViewport();
  const activity = useWorkspaceActivity(app);
  const menu = useWorkspaceMenu(app);
  const logHeight = Math.max(
    3,
    props.height -
      (viewport === "compact" ? 13 : viewport === "regular" ? 20 : 14),
  );
  return (
    <AppShell width={props.width} height={props.height}>
      <WorkspaceAppBar
        activeMenu={menu.active}
        logo={props.logo}
        compact={viewport === "compact"}
      />
      <WorkspaceMenu
        active={menu.active}
        close={menu.close}
        onSelect={activity.recordMenuSelection}
      />
      <AppShell.Main paddingX={1} paddingY={1}>
        <WorkspaceContent
          height={props.height}
          logHeight={logHeight}
          viewport={viewport}
          logs={activity.logs}
          width={props.width}
          unicode={app.capabilities.unicode}
        />
      </AppShell.Main>
      <WorkspacePrompt
        prompt={activity.prompt}
        onPromptChange={activity.setPrompt}
        onSubmit={activity.submitPrompt}
      />
      <WorkspaceStatusBar
        compact={viewport === "compact"}
        unicode={app.capabilities.unicode}
      />
    </AppShell>
  );
}

function FullScreen(props: {
  readonly logo?: TerminalImageSource;
  readonly splashDurationMs?: number;
  readonly loadingMessageIntervalMs?: number;
}): ReactNode {
  const app = useApp();
  const { width, height } = useTerminalSize();
  const splash = useSplashState(
    app.mode,
    props.splashDurationMs ?? 1_800,
    props.loadingMessageIntervalMs ?? 450,
  );
  const logo = props.logo ?? fallbackLogo;
  return splash.visible ? (
    <Splash
      logo={logo}
      message={splash.message}
      width={width}
      height={height}
    />
  ) : (
    <Workspace logo={logo} width={width} height={height} />
  );
}

export function ExampleApplication(props: {
  readonly kind: ExampleKind;
  readonly logo?: TerminalImageSource;
  readonly splashDurationMs?: number;
  readonly loadingMessageIntervalMs?: number;
}): ReactNode {
  switch (props.kind) {
    case "minimal":
      return createElement(Minimal);
    case "forms":
      return createElement(Forms);
    case "dashboard":
      return createElement(Dashboard);
    case "project-wizard":
      return createElement(ProjectWizard);
    case "command-center":
      return createElement(CommandCenter);
    case "file-browser":
      return createElement(FileBrowser);
    case "ai-assistant":
      return createElement(AiAssistant);
    case "full-screen":
      return createElement(FullScreen, props);
    case "git-client":
    case "log-explorer":
    case "otel-console":
    case "ai-coding-assistant":
    case "deployment-dashboard":
    case "file-manager":
    case "workflow-runner":
    case "docs-browser":
      return createElement(ProductionExample, { kind: props.kind });
  }
}

export async function runExample(
  kind: ExampleKind,
  options: Omit<Parameters<typeof ExampleApplication>[0], "kind"> = {},
): Promise<void> {
  const app = createApp({
    id: `tuil-example-${kind}`,
    component: () => createElement(ExampleApplication, { kind, ...options }),
  });
  const instance = await render(app, {
    alternateScreen: kind === "full-screen" && app.capabilities.alternateScreen,
  });
  const stop = () => {
    void instance.unmount();
  };
  process.once("SIGINT", stop);
  try {
    await instance.waitUntilExit();
  } finally {
    process.off("SIGINT", stop);
  }
}

export async function runExampleApplication(
  id: string,
  component: () => ReactNode,
  options: { readonly plugins?: TuilAppOptions["plugins"] } = {},
): Promise<void> {
  const app = createApp({
    id: `tuil-example-${id}`,
    component,
    plugins: options.plugins,
  });
  const instance = await render(app);
  const stop = () => void instance.unmount();
  process.once("SIGINT", stop);
  try {
    await instance.waitUntilExit();
  } finally {
    process.off("SIGINT", stop);
  }
}
