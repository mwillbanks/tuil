import { useApp, useEditorSession, useLogPipeline } from "@mwillbanks/tuil";
import type { CommonComponentProps } from "@mwillbanks/tuil-ink";
import {
  LogSearchBar,
  LogViewerModel,
  LogViewer as NormalizedLogViewer,
} from "@mwillbanks/tuil-log-viewer";
import type { LogPipeline } from "@mwillbanks/tuil-logging";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

export type LogLevel = "trace" | "debug" | "info" | "warning" | "error";

export interface LogEntry {
  readonly id: string;
  readonly message: string;
  readonly level?: LogLevel;
  readonly timestamp?: string | number | Date;
}

export interface LogViewerProps extends CommonComponentProps {
  readonly lines: readonly (string | LogEntry)[];
  readonly height?: number;
  readonly width?: number;
  readonly maxLines?: number;
  readonly filter?: string;
  readonly follow?: boolean;
  readonly defaultFollow?: boolean;
  readonly onFollowChange?: (follow: boolean) => void | Promise<void>;
  readonly showTimestamp?: boolean;
  readonly staticLimit?: number;
  readonly autoFocus?: boolean;
}

interface RegistryLogSource {
  readonly source: string;
  readonly format: "text" | "json";
}

function logEntrySources(
  entry: string | LogEntry,
): readonly RegistryLogSource[] {
  if (typeof entry === "string") {
    return entry
      .split("\n")
      .map((source) => Object.freeze({ source, format: "text" as const }));
  }
  return entry.message.split("\n").map((body) =>
    Object.freeze({
      source: JSON.stringify({
        id: entry.id,
        body,
        severityText: entry.level ?? "info",
        timestamp:
          entry.timestamp instanceof Date
            ? entry.timestamp.toISOString()
            : entry.timestamp,
      }),
      format: "json" as const,
    }),
  );
}

function ingestRegistryLogs(
  pipeline: LogPipeline,
  lines: readonly (string | LogEntry)[],
  capacity: number,
): void {
  const sources = lines.flatMap(logEntrySources).slice(-capacity);
  for (const input of sources) pipeline.ingest(input.source, input.format);
}

function useRegistryLogModel(
  props: LogViewerProps,
  id: string,
): { readonly model: LogViewerModel; readonly query: string } {
  const app = useApp();
  const capacity = Math.max(1, Math.floor(props.maxLines ?? 10_000));
  const retainedLimit =
    app.mode === "interactive"
      ? capacity
      : Math.max(0, Math.floor(props.staticLimit ?? 100));
  const linesKey = JSON.stringify(
    retainedLimit === 0 ? [] : props.lines.slice(-retainedLimit),
  );
  const retainedLines = useMemo(
    () => JSON.parse(linesKey) as readonly (string | LogEntry)[],
    [linesKey],
  );
  const pipeline = useLogPipeline();
  const queryEditorOptions = useMemo(
    () => ({
      id: `${id}-query`,
      documentType: "application/query",
    }),
    [id],
  );
  const queryEditor = useEditorSession(queryEditorOptions);
  const model = useMemo(
    () =>
      new LogViewerModel(pipeline, {
        id: `${id}-scroll`,
        width: props.width ?? 100,
        height: props.height ?? 12,
        queryEditor,
        queryEditorOwnership: "borrowed",
      }),
    [id, pipeline, props.height, props.width, queryEditor],
  );
  useEffect(() => {
    const unregisterScroll = app.scroll.register(model.scroll);
    return () => {
      unregisterScroll();
      model.dispose();
    };
  }, [app, model]);
  useEffect(() => {
    pipeline.clear();
    ingestRegistryLogs(pipeline, retainedLines, retainedLimit);
  }, [pipeline, retainedLimit, retainedLines]);
  useEffect(() => {
    const registration = app.extensions.devtoolsPanels.register({
      id: `log-viewer:${id}`,
      title: `Log viewer ${id}`,
      kind: "panel",
      permissions: new Set(["read"]),
      serialization: "json",
      inspect: () => ({
        ...model.snapshot(),
        scroll: model.scroll.snapshot(),
        query: model.queryEditor.serialize(),
      }),
    });
    return () => {
      registration.dispose();
    };
  }, [app.extensions.devtoolsPanels, id, model]);
  const query = props.filter?.trim()
    ? `body contains ${JSON.stringify(props.filter.trim())}`
    : "";
  useEffect(() => {
    model.setQuery(query);
  }, [model, query]);
  return { model, query };
}

function useRegistryLogFollowing(
  model: LogViewerModel,
  props: LogViewerProps,
): (next: boolean) => Promise<void> {
  const [internalFollow, setInternalFollow] = useState(
    props.defaultFollow ?? true,
  );
  const following = props.follow ?? internalFollow;
  const setFollowing = useCallback(
    async (next: boolean) => {
      if (props.follow === undefined) setInternalFollow(next);
      await props.onFollowChange?.(next);
    },
    [props.follow, props.onFollowChange],
  );
  useEffect(() => {
    if (following) model.resume();
    else model.pause();
  }, [following, model]);
  return setFollowing;
}

export function LogViewer(props: LogViewerProps): ReactNode {
  const generated = useId();
  const id = props.id ?? generated;
  const { model, query } = useRegistryLogModel(props, id);
  const setFollowing = useRegistryLogFollowing(model, props);
  return (
    <>
      {query ? <LogSearchBar model={model} query={query} /> : null}
      <NormalizedLogViewer
        id={id}
        label={props.label ?? "Log viewer"}
        model={model}
        query={props.filter ?? ""}
        emptyMessage="No log entries"
        autoFocus={props.autoFocus ?? false}
        showTimestamp={props.showTimestamp ?? false}
        onLiveChange={setFollowing}
      />
    </>
  );
}
