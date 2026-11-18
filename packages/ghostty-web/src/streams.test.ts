import { expect, test } from "bun:test";
import { BrowserEventEmitter } from "./emitter.ts";
import { BrowserReadableStream, BrowserWritableStream } from "./streams.ts";

test("one-time listeners remove themselves before recursive delivery", () => {
  const emitter = new BrowserEventEmitter();
  const topic = Symbol("topic");
  const received: unknown[] = [];
  const listener = (value: unknown) => received.push(value);
  emitter.addListener(topic, listener);
  emitter.once(topic, (value) => {
    received.push(["once", value]);
    emitter.emit(topic, "nested");
  });
  expect(emitter.setMaxListeners(3)).toBe(emitter);
  expect(emitter.listenerCount(topic)).toBe(2);
  expect(emitter.emit(topic, "outer")).toBe(true);
  expect(received).toEqual(["outer", ["once", "outer"], "nested"]);
  expect(emitter.listenerCount(topic)).toBe(1);
  emitter.removeListener(topic, listener);
  emitter.removeAllListeners(topic);
  expect(emitter.emit(topic, "closed")).toBe(false);
});

test("sets terminal input properties and destroys its listener and queue state", () => {
  const input = new BrowserReadableStream(80, 24, 2);
  const messages: string[] = [];
  input.on("readable", () => {
    messages.push("readable");
  });
  expect(input.pipe("destination")).toBe("destination");
  expect(
    input.setRawMode(true).setEncoding("utf8").resume().pause().ref().unref(),
  ).toBe(input);
  expect(input.isRaw).toBe(true);
  input.push("");
  input.push("é");
  expect(messages).toEqual(["readable"]);
  expect(input.destroy()).toBe(input);
  input.push("ignored");
  expect(input.read()).toBeNull();
  expect(input.listenerCount("readable")).toBe(0);
});

test("enforces write backpressure and resumes after terminal errors", async () => {
  let acknowledge: (() => void) | undefined;
  const data: (string | Uint8Array)[] = [];
  const stream = new BrowserWritableStream(
    {
      write(value, done) {
        if (value === "bad") throw new Error("terminal rejected a write");
        if (value === "odd") throw "terminal failure";
        data.push(value);
        acknowledge = done;
      },
    },
    60,
    20,
    5,
  );
  const errors: unknown[] = [];
  stream.on("error", (error) => errors.push(error));
  const bytes = new Uint8Array([1, 2, 3]);
  expect(stream.setDefaultEncoding("utf8")).toBe(stream);
  expect(stream.getColorDepth()).toBe(24);
  expect(stream.hasColors()).toBe(true);
  expect(stream.hasColors(16_777_217)).toBe(false);
  stream.cork();
  expect(stream.write(bytes)).toBe(true);
  bytes[0] = 5;
  expect(stream.write("longer")).toBe(false);
  stream.uncork();
  const idle = stream.whenIdle();
  acknowledge?.();
  await idle;
  expect(data).toEqual([new Uint8Array([1, 2, 3])]);
  expect(stream.write("bad", "utf8", (error) => errors.push(error))).toBe(true);
  expect(stream.write("odd")).toBe(true);
  expect(errors).toHaveLength(4);
  expect(errors[0]).toBeInstanceOf(RangeError);
  expect((errors[1] as Error).message).toBe("terminal rejected a write");
  expect((errors[3] as Error).message).toBe("terminal failure");
  stream.destroy();
});
