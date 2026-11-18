import { expect, test } from "bun:test";
import {
  ProductionApplicationAdapter,
  readProductionRecordBatches,
} from "../../examples/_shared.tsx";

test("reports source cleanup failure after a producer finishes normally", async () => {
  const failure = new Error("producer cleanup failed");
  const records = readProductionRecordBatches(
    {
      stream() {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => ({ done: true, value: undefined }),
              return: async () => {
                throw failure;
              },
            };
          },
        };
      },
    },
    new AbortController().signal,
  );
  await expect(records.next()).rejects.toThrow(failure.message);
});

test("rejects unregistered actions inherited from the object prototype", async () => {
  const adapter = new ProductionApplicationAdapter({
    id: "log-explorer",
    records: ["ready"],
  });
  try {
    await expect(adapter.execute("toString")).rejects.toThrow(
      'action "toString" is unavailable',
    );
    expect(adapter.snapshot()).toEqual({ records: ["ready"], revision: 0 });
  } finally {
    adapter.dispose();
  }
});
