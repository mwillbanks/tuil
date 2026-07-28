import { expect, test } from "bun:test";
import { TextBufferSession } from "@mwillbanks/tuil-editor/buffer";
import { LogPipeline } from "@mwillbanks/tuil-logging";
import { renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement, Fragment } from "react";
import {
  createLogTheme,
  LiveIndicator,
  LogDetail,
  LogExportDialog,
  LogFacetPanel,
  LogFilterBar,
  LogRow,
  LogSearchBar,
  LogSourceBadge,
  LogTimeline,
  LogViewer,
  LogViewerModel,
  type LogViewerModelOptions,
  logThemeTextStyle,
  ParseErrorRow,
  StructuredValue,
  TraceContext,
} from "./index.tsx";

function model() {
  const pipeline = new LogPipeline();
  pipeline.ingest(
    [
      '{"severity":"info","body":"ready","resource":{"service.name":"web"},"timeUnixNano":"1000000000"}',
      '{"severity":"error","body":"timeout","resource":{"service.name":"api"},"traceId":"abc","spanId":"def","timeUnixNano":"2000000000"}',
      "{bad",
    ].join("\n"),
    "json",
  );
  return new LogViewerModel(pipeline, {
    height: 2,
    queryEditor: new TextBufferSession({ id: "query" }),
    queryEditorOwnership: "owned",
  });
}

test("log viewer virtualizes, searches through editor contracts, selects, scrolls, and exports", () => {
  const viewer = model();
  expect(viewer.snapshot().rows).toHaveLength(2);
  expect(viewer.setQuery("severity >= error")).toEqual([]);
  expect(viewer.snapshot().total).toBe(1);
  viewer.select(0);
  viewer.move(10);
  expect(viewer.snapshot().selected?.body).toBe("timeout");
  expect(viewer.export("text")).toBe("timeout");
  expect(viewer.export()).toContain("timeout");
  viewer.setTheme("high-contrast");
  expect(viewer.snapshot().theme.variant).toBe("high-contrast");
  expect(viewer.setQuery("bad clause")).not.toEqual([]);
  viewer.pause();
  expect(viewer.snapshot().live).toBe(false);
  viewer.resume();
  expect(viewer.snapshot().live).toBe(true);
  viewer.dispose();
});

test("log viewer copies through an injected clipboard and requires an editor provider", async () => {
  const pipeline = new LogPipeline();
  pipeline.ingest("ready", "text");
  expect(() => new LogViewerModel(pipeline)).toThrow("requires a queryEditor");
  expect(
    () =>
      new LogViewerModel(pipeline, {
        queryEditor: new TextBufferSession({ id: "ambiguous-query" }),
      } as unknown as LogViewerModelOptions),
  ).toThrow("explicit");
  const viewer = new LogViewerModel(pipeline, {
    queryEditor: new TextBufferSession({ id: "copy-query" }),
    queryEditorOwnership: "owned",
  });
  const writes: string[] = [];
  expect(
    await viewer.copy({
      read: () => undefined,
      write: (value) => {
        writes.push(value);
      },
    }),
  ).toBe("ready");
  expect(writes).toEqual(["ready"]);
  viewer.dispose();
});

test("log viewer disposes query editors only when ownership is explicit", () => {
  const borrowed = new TextBufferSession({ id: "borrowed-query" });
  const borrowedViewer = new LogViewerModel(new LogPipeline(), {
    queryEditor: borrowed,
    queryEditorOwnership: "borrowed",
  });
  borrowedViewer.dispose();
  expect(() => borrowed.serialize()).not.toThrow();
  borrowed.dispose();

  const owned = new TextBufferSession({ id: "owned-query" });
  const ownedViewer = new LogViewerModel(new LogPipeline(), {
    queryEditor: owned,
    queryEditorOwnership: "owned",
  });
  ownedViewer.dispose();
  expect(() => owned.dispatch({ changes: [] })).toThrow("disposed");
});

test("renderable viewer reacts to live pipeline ingestion", async () => {
  const pipeline = new LogPipeline();
  const viewer = new LogViewerModel(pipeline, {
    queryEditor: new TextBufferSession({ id: "query" }),
    queryEditorOwnership: "owned",
  });
  const rendered = renderTuil(createElement(LogViewer, { model: viewer }));
  await rendered.ready;
  expect(rendered.screen.frame()).toContain("No log records");
  pipeline.ingest('{"severity":"info","body":"ready"}', "json");
  await Bun.sleep(50);
  expect(rendered.screen.frame()).toContain("ready");
  await rendered.cleanup();
});

test("log components expose facets, details, timeline, trace, errors, filters, and live state", async () => {
  const viewer = model();
  const snapshot = viewer.snapshot();
  const records = snapshot.rows
    .map((_row, index) => {
      viewer.select(index);
      return viewer.snapshot().selected;
    })
    .filter((record) => record !== undefined);
  const first = records[0];
  const second = records[1];
  const last = records.at(-1);
  if (!first || !second || !last) {
    throw new Error("Expected log viewer records");
  }
  expect(LogRow(first, 0, true).selected).toBeTrue();
  const rendered = renderTuil(
    createElement(
      Fragment,
      null,
      createElement(LogFacetPanel, { records }),
      createElement(LogDetail, { record: first }),
      createElement(LogSourceBadge, { record: first }),
      createElement(StructuredValue, { value: { ready: true } }),
      createElement(LogTimeline, { records }),
      createElement(TraceContext, { record: second }),
      createElement(ParseErrorRow, { record: last }),
      createElement(LogFilterBar, { query: "bad clause" }),
      createElement(LiveIndicator, {
        live: true,
        dropped: 2,
        sampled: 3,
        rateLimited: 4,
      }),
      createElement(LogExportDialog, { model: viewer }),
      createElement(LogSearchBar, {
        model: viewer,
        query: "severity >= error",
      }),
    ),
  );
  await rendered.ready;
  expect(rendered.screen.frame()).toContain("web: 1");
  expect(rendered.screen.frame()).toContain("trace=abc");
  expect(rendered.screen.frame()).toContain(
    "LIVE · 2 dropped · 3 sampled · 4 rate-limited",
  );
  await rendered.cleanup();
  viewer.dispose();
});

test("pause freezes the viewport while bounded ingress remains observable and resumes historically", async () => {
  const pipeline = new LogPipeline({ capacity: 2 });
  pipeline.ingest("before", "text");
  const viewer = new LogViewerModel(pipeline, {
    height: 4,
    queryEditor: new TextBufferSession({ id: "pause-query" }),
    queryEditorOwnership: "owned",
  });
  const rendered = renderTuil(createElement(LogViewer, { model: viewer }));
  await rendered.ready;
  viewer.pause();
  pipeline.ingest("during-one", "text");
  pipeline.ingest("during-two", "text");
  await Bun.sleep(10);
  expect(rendered.screen.frame()).toContain("PAUSED · 1 records · 1 dropped");
  expect(rendered.screen.frame()).toContain("before");
  expect(rendered.screen.frame()).not.toContain("during-two");

  viewer.resume();
  await Bun.sleep(10);
  expect(rendered.screen.frame()).toContain("LIVE · 2 records · 1 dropped");
  expect(rendered.screen.frame()).toContain("during-one");
  expect(rendered.screen.frame()).toContain("during-two");
  expect(rendered.screen.frame()).not.toContain("before");
  await rendered.cleanup();
  viewer.dispose();
});

test("sampling and rate-limit decisions are visible in the viewer", async () => {
  const pipeline = new LogPipeline({
    sampleEvery: 2,
    maxPerSecond: 1,
    now: () => 1_000,
  });
  const viewer = new LogViewerModel(pipeline, {
    height: 4,
    queryEditor: new TextBufferSession({ id: "indicator-query" }),
    queryEditorOwnership: "owned",
  });
  const rendered = renderTuil(createElement(LogViewer, { model: viewer }));
  await rendered.ready;
  pipeline.ingest("sampled-one", "text");
  pipeline.ingest("retained", "text");
  pipeline.ingest("sampled-two", "text");
  pipeline.ingest("limited", "text");
  await Bun.sleep(10);
  expect(viewer.snapshot()).toMatchObject({
    sampled: 2,
    rateLimited: 1,
    total: 1,
  });
  expect(rendered.screen.frame()).toContain(
    "LIVE · 1 records · 2 sampled · 1 rate-limited",
  );
  expect(rendered.screen.frame()).toContain("retained");
  expect(rendered.screen.frame()).not.toContain("INFO limited");
  await rendered.cleanup();
  viewer.dispose();
});

test("dense, comfortable, monochrome, high-contrast, and color-blind themes are complete", () => {
  for (const variant of [
    "dense",
    "comfortable",
    "monochrome",
    "high-contrast",
    "color-blind-safe",
  ] as const) {
    const theme = createLogTheme(variant);
    expect(Object.keys(theme.tokens)).toHaveLength(16);
  }
  expect(
    logThemeTextStyle(createLogTheme("comfortable").tokens.timestamp),
  ).toEqual({ dimColor: true });
  expect(
    logThemeTextStyle(createLogTheme("monochrome").tokens.selected),
  ).toEqual({ inverse: true });
  expect(logThemeTextStyle(createLogTheme("monochrome").tokens.match)).toEqual({
    underline: true,
  });
  expect(
    logThemeTextStyle(createLogTheme("high-contrast").tokens.error),
  ).toEqual({ color: "brightRed" });
});

test("log rows project themed metadata and density changes vertical layout", async () => {
  const pipeline = new LogPipeline();
  pipeline.ingest(
    '{"severity":"error","body":"ready","resource":{"service.name":"web"},"attributes":{"region":"us"},"traceId":"abc","timeUnixNano":"1000000000"}\n{"severity":"info","body":"next"}',
    "json",
  );
  const comfortableModel = new LogViewerModel(pipeline, {
    height: 10,
    queryEditor: new TextBufferSession({ id: "comfortable-query" }),
    queryEditorOwnership: "owned",
  });
  const comfortable = renderTuil(
    createElement(LogViewer, {
      model: comfortableModel,
      query: "ready",
    }),
  );
  await comfortable.ready;
  expect(comfortable.screen.frame()).toContain("otel web ready");
  expect(comfortable.screen.frame()).toContain('{"region":"us"}');
  expect(comfortable.screen.frame()).toContain("trace=abc");

  const denseModel = new LogViewerModel(pipeline, {
    height: 10,
    queryEditor: new TextBufferSession({ id: "dense-query" }),
    queryEditorOwnership: "owned",
    theme: "dense",
  });
  const dense = renderTuil(createElement(LogViewer, { model: denseModel }));
  await dense.ready;
  expect(comfortable.screen.frame().split("\n").length).toBeGreaterThan(
    dense.screen.frame().split("\n").length,
  );

  await comfortable.cleanup();
  await dense.cleanup();
  comfortableModel.dispose();
  denseModel.dispose();
});
