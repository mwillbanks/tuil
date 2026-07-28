import { useApp, useEditorSession, useLogPipeline } from "@mwillbanks/tuil";
import {
  LogSearchBar,
  LogViewer,
  LogViewerModel,
} from "@mwillbanks/tuil-log-viewer";
import { textLogParser } from "@mwillbanks/tuil-logging";
import { useMemo } from "react";
import {
  createProductionApplicationAdapter,
  ProductionApplicationShell,
  type ProductionRecordSource,
  readProductionRecordBatches,
  readTextLineBatches,
  runExampleApplication,
  useLogViewerModelLifecycle,
} from "../../_shared.tsx";

const localLogSource: ProductionRecordSource = {
  batchSize: 250,
  async *stream(signal) {
    const path =
      typeof process === "undefined" ? undefined : process.env["TUIL_LOG_FILE"];
    if (!path || typeof Bun === "undefined") {
      yield [];
      return;
    }
    yield* readTextLineBatches(Bun.file(path).stream(), signal, 250);
  },
};

const logExplorerPipelineOptions = Object.freeze({
  parsers: Object.freeze([textLogParser]),
});
const logExplorerQueryOptions = Object.freeze({
  id: "log-explorer-query",
  documentType: "application/query",
});

export function LogExplorerApplication(
  props: { readonly source?: ProductionRecordSource } = {},
) {
  const app = useApp();
  const pipeline = useLogPipeline(logExplorerPipelineOptions);
  const queryEditor = useEditorSession(logExplorerQueryOptions);
  const source = props.source ?? localLogSource;
  const model = useMemo(
    () =>
      new LogViewerModel(pipeline, {
        id: "log-stream",
        height: 12,
        width: 70,
        queryEditor,
        queryEditorOwnership: "borrowed",
      }),
    [pipeline, queryEditor],
  );
  const adapter = useMemo(
    () =>
      createProductionApplicationAdapter("log-explorer", {
        batchSize: source.batchSize,
        retentionLimit: source.retentionLimit,
        async *stream(signal) {
          pipeline.clear();
          for await (const batch of readProductionRecordBatches(
            source,
            signal,
          )) {
            signal.throwIfAborted();
            if (batch.length > 0) pipeline.ingest(batch.join("\n"), "text");
            yield batch;
          }
        },
        subscribe: source.subscribe?.bind(source),
      }),
    [pipeline, source],
  );
  useLogViewerModelLifecycle(app, model);
  return (
    <ProductionApplicationShell kind="log-explorer" adapter={adapter}>
      {({ query }) => (
        <>
          <LogSearchBar model={model} query={query} />
          <LogViewer id="log-stream" model={model} query={query} />
        </>
      )}
    </ProductionApplicationShell>
  );
}

if (import.meta.main)
  await runExampleApplication("log-explorer", LogExplorerApplication);
