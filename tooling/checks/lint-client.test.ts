import { describe, expect, test } from "bun:test";
import { OxlintClient, type OxlintTransport } from "./lint-client.ts";
import { useTestClock } from "../../tests/helpers/clock.ts";

const clock = useTestClock();
function harness() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stdout = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  const messages: Array<{
    id?: number;
    method?: string;
    params: { rootUri?: string; textDocument: { languageId: string } };
    result?: unknown;
  }> = [];
  const done = Promise.withResolvers<number>();
  let killed = false;
  const transport: OxlintTransport = {
    stdin: {
      write(value) {
        messages.push(JSON.parse(value.split("\r\n\r\n")[1]!));
      },
      flush() {},
    },
    stdout,
    kill() {
      killed = true;
      try {
        controller.close();
      } catch {
        /* A rejected async iterator cancels its stream. */
      }
      done.resolve(0);
    },
    exited: done.promise,
  };
  function raw(value: string) {
    controller.enqueue(Buffer.from(value));
  }
  function send(value: unknown, split = false) {
    const body = JSON.stringify(value);
    const frame =
      "Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body;
    if (split) {
      raw(frame.slice(0, 8));
      raw(frame.slice(8, frame.length - 2));
      raw(frame.slice(-2));
    } else raw(frame);
  }
  const client = new OxlintClient("unused", "/workspace", transport);
  async function ready() {
    send({ id: 1, result: {} }, true);
    await clock.flush();
  }
  async function diagnostic(
    path: string,
    source: string,
    result: unknown = { items: [] },
  ) {
    const pending = client.diagnose(path, source);
    await clock.flush();
    const request = messages.findLast(
      (message) => message.method === "textDocument/diagnostic",
    )!;
    send({ id: request.id, result });
    return pending;
  }
  return {
    client,
    ready,
    diagnostic,
    messages,
    send,
    raw,
    controller,
    killed: () => killed,
  };
}
describe("persistent Oxlint protocol", () => {
  test("frames UTF-8, opens once, changes documents, and answers server requests", async () => {
    const h = harness();
    await h.ready();
    expect(h.messages[0]!.params.rootUri).toBe("file:///workspace");
    expect(h.messages[1]!.method).toBe("initialized");
    await h.diagnostic("/workspace/a.ts", "const café = 1;");
    await h.diagnostic("/workspace/a.ts", "const café = 1;");
    await h.diagnostic("/workspace/a.ts", "const café = 2;");
    await h.diagnostic("/workspace/b.jsx", "hello");
    expect(
      h.messages.filter((m) => m.method === "textDocument/didOpen"),
    ).toHaveLength(2);
    expect(
      h.messages.filter((m) => m.method === "textDocument/didChange"),
    ).toHaveLength(1);
    expect(
      h.messages.findLast((m) => m.method === "textDocument/didOpen")!.params
        .textDocument.languageId,
    ).toBe("javascript");
    h.send({ method: "notification" });
    h.send({
      id: 70,
      method: "workspace/configuration",
      params: { items: [{}, {}] },
    });
    h.send({ id: 71, method: "workspace/configuration" });
    h.send({ id: 72, method: "client/registerCapability" });
    await clock.flush();
    expect(h.messages.slice(-3).map((m) => m.result)).toEqual([
      [{}, {}],
      [],
      null,
    ]);
    await h.client.close();
    expect(h.killed()).toBe(true);
  });
  test("rejects RPC errors and malformed diagnostic results", async () => {
    const h = harness();
    await h.ready();
    const request = h.client.diagnose("/workspace/a.tsx", "x");
    await clock.flush();
    h.send({ id: h.messages.at(-1)!.id, error: { code: -1, message: "bad" } });
    await expect(request).rejects.toThrow("bad");
    await expect(h.diagnostic("/workspace/a.tsx", "x", {})).rejects.toThrow(
      "did not return diagnostics",
    );
    await h.client.close();
  });
  test("times out at the exact deadline and removes pending requests", async () => {
    const h = harness();
    await h.ready();
    const pending = h.client
      .diagnose("/workspace/a.ts", "x")
      .catch((error: Error) => error);
    await clock.advance(9_999);
    expect(clock.pending()).toBe(1);
    await clock.advance(1);
    expect(String(await pending)).toContain("timed out");
    expect(clock.pending()).toBe(0);
    await h.client.close();
  });
  for (const invalid of [
    "Content-Length: nope\r\n\r\n",
    "Content-Length: 1\r\n\r\nx",
  ]) {
    test(
      "rejects pending and future requests after invalid frame " + invalid,
      async () => {
        const h = harness();
        await h.ready();
        const pending = h.client
          .diagnose("/workspace/a.ts", "x")
          .catch((error: Error) => error);
        await clock.flush();
        h.raw(invalid);
        await clock.flush();
        expect(String(await pending)).toContain("disconnected");
        await expect(h.client.diagnose("/workspace/b.ts", "x")).rejects.toThrow(
          "disconnected",
        );
        expect(clock.pending()).toBe(0);
        await h.client.close();
      },
    );
  }
  test("rejects initialization when the server exits", async () => {
    const h = harness();
    await h.client.close();
    await expect(h.client.diagnose("/workspace/a.ts", "x")).rejects.toThrow(
      "disconnected",
    );
  });
});
