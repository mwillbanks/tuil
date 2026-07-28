import {
  defineCommand,
  type TuilAppOptions,
  useApp,
  useEditorSession,
  useLogPipeline,
  useStreamingPipeline,
} from "@mwillbanks/tuil";
import { TuilDevtools } from "@mwillbanks/tuil-devtools";
import { Box, Progress, Text, useTerminalInput } from "@mwillbanks/tuil-ink";
import {
  LogDetail,
  LogFilterBar,
  LogViewer,
  LogViewerModel,
  TraceContext,
} from "@mwillbanks/tuil-log-viewer";
import {
  compileLogQuery,
  createFieldRedactor,
  jsonLogParser,
  type LogParser,
  type LogPipeline,
  type LogRecord,
} from "@mwillbanks/tuil-logging";
import {
  createOperation,
  type OperationContext,
  type OperationExecutor,
} from "@mwillbanks/tuil-operations";
import { createPlugin } from "@mwillbanks/tuil-plugin";
import type {
  DocumentTransformer,
  PartialDocument,
  StreamingPipeline,
} from "@mwillbanks/tuil-streaming";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Dialog } from "../../../registry/feedback/overlays.tsx";
import { SplitPane } from "../../../registry/layout/panes.tsx";
import {
  createProductionApplicationAdapter,
  ProductionApplicationShell,
  type ProductionRecordSource,
  readProductionRecordBatches,
  readTextLineBatches,
  runExampleApplication,
  useLogViewerModelLifecycle,
} from "../../_shared.tsx";

export const defaultOpenTelemetryRecords = Object.freeze([
  JSON.stringify({
    timeUnixNano: "1000000000",
    severityText: "INFO",
    body: "gateway ready",
    resource: { "service.name": "gateway" },
    scope: { name: "http-server", version: "1.0.0" },
    traceId: "abc123",
    spanId: "def456",
  }),
  JSON.stringify({
    timeUnixNano: "2000000000",
    severityText: "ERROR",
    body: "worker timeout",
    resource: { "service.name": "worker" },
    scope: { name: "job-runner", version: "1.0.0" },
    traceId: "fed321",
    spanId: "cba654",
  }),
]);

const openTelemetryBatchSize = 128;

export const localOpenTelemetrySource: ProductionRecordSource = {
  batchSize: openTelemetryBatchSize,
  retentionLimit: 100_000,
  async *stream(signal) {
    const path =
      typeof process === "undefined"
        ? undefined
        : process.env["TUIL_OTEL_FILE"];
    if (!path || typeof Bun === "undefined") {
      yield defaultOpenTelemetryRecords;
      return;
    }
    yield* readTextLineBatches(
      Bun.file(path).stream(),
      signal,
      openTelemetryBatchSize,
    );
  },
};

export function openTelemetryConsoleQuery(source: string): string {
  const term = source.trim();
  if (!term || compileLogQuery(term).diagnostics.length === 0) return term;
  const value = JSON.stringify(term);
  return [
    `body contains ${value}`,
    `service contains ${value}`,
    `trace_id contains ${value}`,
    `span_id contains ${value}`,
  ].join(" or ");
}

export const openTelemetryConsoleLogParser: LogParser = Object.freeze({
  id: "otel-console",
  detect(input: string) {
    return /"(?:timeUnixNano|traceId|spanId|severityText)"\s*:/.test(input)
      ? 1
      : 0;
  },
  parse(input: string) {
    return Object.freeze(
      jsonLogParser.parse(input).map((record) =>
        Object.freeze({
          ...record,
          attributes: Object.freeze({
            ...record.attributes,
            "tuil.parser": "otel-console",
          }),
        }),
      ),
    );
  },
});

export const openTelemetryStreamTransformer: DocumentTransformer =
  Object.freeze({
    id: "otel-console",
    transform(document: PartialDocument) {
      return Object.freeze({
        ...document,
        root: Object.freeze({
          ...document.root,
          attributes: Object.freeze({
            ...document.root.attributes,
            "tuil.transformer": "otel-console",
          }),
        }),
      });
    },
  });

const openTelemetryConsolePluginDefinition: NonNullable<
  TuilAppOptions["plugins"]
>[number] = {
  id: "otel-console",
  version: "1.0.0",
  setup({ logParsers }) {
    return logParsers.register(openTelemetryConsoleLogParser);
  },
};

export const openTelemetryConsolePlugin = createPlugin(
  openTelemetryConsolePluginDefinition,
);

const openTelemetryLogPipelineOptions = Object.freeze({
  capacity: 100_000,
  redactors: Object.freeze([
    createFieldRedactor([
      "password",
      "token",
      "authorization",
      "secret",
      "apiKey",
      "api_key",
    ]),
  ]),
});

const openTelemetryStreamingPipelineOptions = Object.freeze({
  format: "json" as const,
  transformers: Object.freeze([openTelemetryStreamTransformer]),
});
const openTelemetryQueryOptions = Object.freeze({
  id: "otel-query",
  documentType: "application/query",
});

function staticLogRecord(record: LogRecord): Readonly<Record<string, unknown>> {
  return Object.freeze({
    timestamp: record.timestamp?.toString(),
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    body: record.body,
    attributes: record.attributes,
    resource: record.resource,
    scope: record.scope,
    traceId: record.traceId,
    spanId: record.spanId,
  });
}

export function exportOpenTelemetrySnapshot(pipeline: LogPipeline): string {
  return pipeline.buffer
    .records()
    .map((record) => JSON.stringify(staticLogRecord(record)))
    .join("\n");
}

async function transformOpenTelemetryRecord(
  line: string,
  streaming: StreamingPipeline,
  context: OperationContext,
): Promise<PartialDocument> {
  streaming.reset();
  await streaming.write(line, context.signal);
  return streaming.end(context.signal);
}

async function ingestOpenTelemetryRecords(
  source: ProductionRecordSource,
  pipeline: LogPipeline,
  streaming: StreamingPipeline,
  context: OperationContext,
): Promise<OpenTelemetryLoadSummary> {
  pipeline.clear();
  let processed = 0;
  context.updateProgress({
    current: 0,
    message: "connecting OpenTelemetry stream",
  });
  for await (const batch of readProductionRecordBatches(
    source,
    context.signal,
  )) {
    for (const line of batch) {
      context.signal.throwIfAborted();
      const document = await transformOpenTelemetryRecord(
        line,
        streaming,
        context,
      );
      context.signal.throwIfAborted();
      pipeline.ingest(document.source);
      processed += 1;
    }
    context.updateProgress({
      current: processed,
      message: `normalized ${processed} records`,
    });
    // Yield between bounded batches so cancellation and competing work are
    // observed before the source is asked for more data.
    await Promise.resolve();
  }
  return Object.freeze({
    processed,
    retained: pipeline.buffer.statistics().size,
  });
}

interface OpenTelemetryLoadSummary {
  readonly processed: number;
  readonly retained: number;
}

function createOpenTelemetryLoadOperation(
  source: ProductionRecordSource,
  pipeline: LogPipeline,
  streaming: StreamingPipeline,
): OperationExecutor<OpenTelemetryLoadSummary> {
  return createOperation({
    id: "otel-console.load",
    title: "Load OpenTelemetry records",
    description: "Stream, transform, parse, and index OpenTelemetry records.",
    metadata: { example: "otel-console", longRunning: true },
    run: (context) =>
      ingestOpenTelemetryRecords(source, pipeline, streaming, context),
  });
}

function useOperationSnapshot(
  operation: OperationExecutor<OpenTelemetryLoadSummary>,
) {
  const subscribe = useCallback(
    (observer: () => void) => operation.subscribe(observer),
    [operation],
  );
  const snapshot = useCallback(() => operation.state, [operation]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function useModelRevision(model: LogViewerModel): number {
  const subscribe = useCallback(
    (observer: () => void) => model.subscribe(observer),
    [model],
  );
  const snapshot = useCallback(() => model.revision(), [model]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function OpenTelemetryStream(props: {
  readonly model: LogViewerModel;
  readonly query: string;
}): ReactNode {
  const query = openTelemetryConsoleQuery(props.query);
  useEffect(() => {
    props.model.setQuery(query);
  }, [props.model, query]);
  return (
    <>
      {query ? <LogFilterBar query={query} /> : null}
      <LogViewer id="otel-stream" model={props.model} query={props.query} />
    </>
  );
}

function OpenTelemetryDetailOverlay(props: {
  readonly open: boolean;
  readonly record?: LogRecord;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  return (
    <Dialog
      id="otel-log-detail"
      open={props.open && Boolean(props.record)}
      onOpenChange={props.onOpenChange}
    >
      {props.record ? (
        <Dialog.Content label="OpenTelemetry log detail" width={64}>
          <Dialog.Title>OpenTelemetry log detail</Dialog.Title>
          <TraceContext record={props.record} />
          <LogDetail record={props.record} />
          <Dialog.Actions>
            <Dialog.Cancel>Close detail</Dialog.Cancel>
          </Dialog.Actions>
        </Dialog.Content>
      ) : null}
    </Dialog>
  );
}

export interface OpenTelemetryConsoleApplicationProps {
  readonly source?: ProductionRecordSource;
  readonly devtoolsInitiallyOpen?: boolean;
  readonly onExport?: (snapshot: string) => void;
}

function useOpenTelemetryCommands(
  app: ReturnType<typeof useApp>,
  operation: ReturnType<typeof createOpenTelemetryLoadOperation>,
  exportSnapshot: () => string,
): {
  readonly detail: boolean;
  readonly setDetail: (open: boolean) => void;
} {
  const [detail, setDetail] = useState(false);
  useEffect(() => {
    const registrations = [
      app.extensions.operationExecutors.register(operation),
      app.commands.register(
        defineCommand({
          id: "otel-console.export",
          title: "Export OpenTelemetry snapshot",
          category: "Example",
          execute: exportSnapshot,
        }),
      ),
      app.commands.register(
        defineCommand({
          id: "otel-console.toggle-detail",
          title: "Toggle OpenTelemetry detail",
          category: "Example",
          execute: () => setDetail((value) => !value),
        }),
      ),
    ];
    return () => {
      for (const registration of registrations) {
        void registration.dispose();
      }
      operation.dispose();
    };
  }, [
    app.commands,
    app.extensions.operationExecutors,
    exportSnapshot,
    operation,
  ]);
  useTerminalInput((input) => {
    if (input === "d") {
      setDetail((value) => !value);
      return true;
    }
    if (input !== "e") return false;
    exportSnapshot();
    return true;
  });
  return { detail, setDetail };
}

export function OpenTelemetryConsoleApplication(
  props: OpenTelemetryConsoleApplicationProps = {},
): ReactNode {
  const app = useApp();
  const source = props.source ?? localOpenTelemetrySource;
  const pipeline = useLogPipeline(openTelemetryLogPipelineOptions);
  const streaming = useStreamingPipeline(openTelemetryStreamingPipelineOptions);
  const queryEditor = useEditorSession(openTelemetryQueryOptions);
  const operation = useMemo(
    () => createOpenTelemetryLoadOperation(source, pipeline, streaming),
    [pipeline, source, streaming],
  );
  const operationSnapshot = useOperationSnapshot(operation);
  const model = useMemo(
    () =>
      new LogViewerModel(pipeline, {
        id: "otel-stream",
        height: 10,
        width: 48,
        queryEditor,
        queryEditorOwnership: "borrowed",
      }),
    [pipeline, queryEditor],
  );
  useModelRevision(model);
  const adapter = useMemo(
    () =>
      createProductionApplicationAdapter("otel-console", {
        retentionLimit: source.retentionLimit,
        async *stream(signal) {
          const summary = await operation.execute(signal);
          yield [JSON.stringify(summary)];
        },
      }),
    [operation, source.retentionLimit],
  );
  const [exportStatus, setExportStatus] = useState("not exported");
  const exportSnapshot = useCallback(() => {
    const snapshot = exportOpenTelemetrySnapshot(pipeline);
    setExportStatus(`exported ${snapshot.length} bytes`);
    props.onExport?.(snapshot);
    return snapshot;
  }, [pipeline, props.onExport]);
  const { detail, setDetail } = useOpenTelemetryCommands(
    app,
    operation,
    exportSnapshot,
  );
  useLogViewerModelLifecycle(app, model);
  const selected = model.snapshot().selected;
  const transformed = streaming
    .events()
    .some(
      (event) =>
        event.type === "document" &&
        event.document.root.attributes?.["tuil.transformer"] === "otel-console",
    );
  return (
    <Fragment>
      <ProductionApplicationShell kind="otel-console" adapter={adapter}>
        {({ query }) => (
          <Box flexDirection="column">
            <Text bold>OpenTelemetry stream and trace correlation</Text>
            <SplitPane
              id="otel-console-panes"
              label="OpenTelemetry stream and trace correlation"
              defaultSizes={[68, 32]}
              panes={[
                {
                  id: "stream",
                  minSize: 45,
                  content: <OpenTelemetryStream model={model} query={query} />,
                },
                {
                  id: "correlation",
                  minSize: 20,
                  content: (
                    <Box flexDirection="column">
                      <Text bold>Trace correlation</Text>
                      {selected ? (
                        <TraceContext record={selected} />
                      ) : (
                        <Text dimColor>No record selected</Text>
                      )}
                      <Progress
                        label="OpenTelemetry ingestion"
                        value={operationSnapshot.progress?.current ?? 0}
                        max={operationSnapshot.progress?.total ?? 1}
                      />
                      <Text>
                        operation: {operationSnapshot.status} · transformer:{" "}
                        {transformed ? "otel-console" : "pending"}
                      </Text>
                    </Box>
                  ),
                },
              ]}
            />
            <Text dimColor>
              d detail · e static export · p pause · r resume · arrows navigate
            </Text>
            <Text role="status">export: {exportStatus}</Text>
            <OpenTelemetryDetailOverlay
              open={detail}
              record={selected}
              onOpenChange={setDetail}
            />
          </Box>
        )}
      </ProductionApplicationShell>
      <TuilDevtools
        initiallyOpen={props.devtoolsInitiallyOpen}
        refreshIntervalMs={16}
      />
    </Fragment>
  );
}

if (import.meta.main) {
  await runExampleApplication("otel-console", OpenTelemetryConsoleApplication, {
    plugins: [openTelemetryConsolePlugin],
  });
}
