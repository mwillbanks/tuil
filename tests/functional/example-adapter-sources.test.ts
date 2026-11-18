import { expect, test } from "bun:test";
import {
  ProductionApplicationAdapter,
  readProductionRecordBatches,
  readTextLineBatches,
} from "../../examples/_shared.tsx";

test("subscribed sources supersede pending refreshes and publish within retention", async () => {
  const entered = Promise.withResolvers<void>();
  let publish: ((records: readonly string[]) => void) | undefined;
  const calls: unknown[] = [];
  const adapter = new ProductionApplicationAdapter({
    id: "log-explorer",
    records: ["initial"],
    source: {
      retentionLimit: 2,
      async *stream(signal) {
        if (calls.length) return;
        entered.resolve();
        await new Promise<void>((done) =>
          signal.addEventListener("abort", () => done(), { once: true }),
        );
        yield ["stale"];
      },
    },
    subscribe(listener) {
      publish = listener;
      return () => {
        publish = undefined;
      };
    },
    execute: (action, input) => {
      calls.push([action, input]);
    },
    read: async (id) => "detail:" + id,
  });
  const disconnect = adapter.connect();
  try {
    const pending = adapter.refresh();
    await entered.promise;
    publish?.(["first", "second", "third"]);
    await pending;
    expect(adapter.snapshot()).toEqual({
      records: ["second", "third"],
      revision: 1,
    });
    expect(await adapter.read("section")).toBe("detail:section");
    await adapter.execute("reload", { filter: "all" });
    expect(calls).toEqual([["reload", { filter: "all" }]]);
    expect(adapter.snapshot()).toEqual({ records: [], revision: 2 });
    adapter.dispose();
    publish?.(["ignored"]);
    await adapter.refresh();
    expect(adapter.snapshot().revision).toBe(2);
  } finally {
    disconnect();
    adapter.dispose();
  }
  expect(publish).toBeUndefined();
});

test("reserved invalid batching requests fail before consuming the supplied stream", async () => {
  const signal = new AbortController().signal;
  const batches = readProductionRecordBatches(
    {
      batchSize: 0,
      stream() {
        throw new Error("should not read");
      },
    },
    signal,
  );
  await expect(batches.next()).rejects.toThrow("positive safe integers");
  const encoder = new TextEncoder();
  const chunks = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("long-line\nshort\n"));
      controller.close();
    },
  });
  await expect(
    readTextLineBatches(chunks, signal, 2, 5).next(),
  ).rejects.toThrow("5-character limit");
  expect(chunks.locked).toBe(false);
});
