import { expect, test } from "bun:test";
import {
  TextBufferSession,
  insertText,
} from "../../packages/editor/src/buffer.ts";
import { position, selection } from "../../packages/editor/src/index.ts";
import {
  LogPipeline,
  LogRingBuffer,
} from "../../packages/logging/src/index.ts";
import { TerminalVirtualizerAdapter } from "../../packages/virtual/src/index.ts";

test("large editor buffers remain responsive and stable across widths", () => {
  const value = Array.from(
    { length: 10_000 },
    (_, index) => `line ${index}`,
  ).join("\n");
  const started = performance.now();
  const session = new TextBufferSession({ value });
  session.dispatch({
    selections: [selection(position(9_999, 9))],
  });
  insertText(session, "!");
  expect(session.serialize()).toEndWith("line 9999!");
  expect(performance.now() - started).toBeLessThan(250);
});

test("100,000 records remain searchable and ring retention reports drops without silent loss", () => {
  const buffer = new LogRingBuffer(100_000);
  const pipeline = new LogPipeline({ capacity: 100_000 });
  const started = performance.now();
  const input = Array.from(
    { length: 100_000 },
    (_, index) =>
      `{"severity":"${index % 100 === 0 ? "error" : "info"}","body":"record ${index}","attributes":{"index":${index}}}`,
  ).join("\n");
  pipeline.ingest(input, "json");
  expect(pipeline.query("severity >= error")).toHaveLength(1_000);
  expect(performance.now() - started).toBeLessThan(2_500);
  const item = pipeline.buffer.records()[0];
  if (item) {
    for (let index = 0; index < 100_001; index += 1) {
      buffer.push(item);
    }
  }
  expect(buffer.statistics()).toMatchObject({
    size: 100_000,
    dropped: 1,
  });
  const empty = new LogRingBuffer(1);
  const first = pipeline.buffer.records()[0];
  if (first) {
    empty.replaceLast(first);
    empty.push(first);
  }
  empty.clear();
  expect(empty.statistics()).toMatchObject({ size: 0, dropped: 0 });
});

test("terminal virtualizer measures large cell ranges within frame budgets", () => {
  const adapter = new TerminalVirtualizerAdapter({
    count: 1_000_000,
    viewportSize: 20,
    scrollOffset: 900_000,
    overscan: 2,
  });
  const started = performance.now();
  let range = adapter.measure({
    count: 1_000_000,
    viewportSize: 20,
    scrollOffset: 0,
    overscan: 2,
  });
  for (let index = 1; index < 10_000; index += 1) {
    range = adapter.measure({
      count: 1_000_000,
      viewportSize: 20,
      scrollOffset: index * 10,
      overscan: 2,
    });
  }
  const elapsed = performance.now() - started;
  adapter.dispose();
  adapter.dispose();
  expect(range.indexes.length).toBeLessThanOrEqual(24);
  expect(elapsed).toBeLessThan(250);
});
