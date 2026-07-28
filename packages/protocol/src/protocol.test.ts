import { expect, test } from "bun:test";
import {
  createProtocolError,
  createProtocolMessage,
  createProtocolRequest,
  createProtocolResult,
  InProcessProtocolTransport,
  isProtocolMessageType,
  isProtocolReply,
  ProtocolRecorder,
  protocolLimits,
  protocolRedactedValue,
  protocolVersion,
  redactProtocolValue,
  sanitizeProtocolMessage,
  validateProtocolMessage,
} from "./index.ts";

test("versioned protocol sends snapshots, events, commands, results, panels, queries, traces, and frames", () => {
  const transport = new InProcessProtocolTransport();
  const recorder = new ProtocolRecorder(transport);
  for (const type of [
    "snapshot",
    "event",
    "panel",
    "query",
    "trace",
    "frame",
    "export",
    "import",
  ] as const) {
    transport.send(createProtocolMessage(type, { type }));
  }
  const request = createProtocolRequest("command", { id: "focus" });
  transport.send(request);
  transport.send(createProtocolResult(request, { ok: true }));
  transport.send(createProtocolError(request, new Error("failed")));
  expect(recorder.messages()).toHaveLength(11);
  expect(recorder.messages("frame")).toHaveLength(1);
  expect(recorder.messages().at(-1)?.replyTo).toBe(request.id);
  recorder.dispose();
  transport.close();
});

test("recordings export, import, validate, and replay deterministically", async () => {
  const source = new InProcessProtocolTransport();
  const recorder = new ProtocolRecorder(source);
  source.send(createProtocolMessage("event", { id: 1 }, { timestamp: 1 }));
  const exported = recorder.export();
  const target = new InProcessProtocolTransport();
  const targetRecorder = new ProtocolRecorder(target);
  targetRecorder.import(exported);
  await recorder.replay(target);
  expect(targetRecorder.messages()).toHaveLength(2);
  expect(JSON.parse(exported).version).toBe(protocolVersion);
  expect(validateProtocolMessage({})).toBe(false);
  expect(
    validateProtocolMessage({
      version: 1,
      id: "bad",
      type: "unknown",
      timestamp: 1,
      payload: {},
    }),
  ).toBe(false);
  expect(() => targetRecorder.import('{"version":2,"messages":[]}')).toThrow(
    "Unsupported",
  );
  expect(() => targetRecorder.import('{"version":1,"messages":[{}]}')).toThrow(
    "invalid messages",
  );
  expect(() => targetRecorder.import('{"version":1}')).toThrow(
    "messages must be an array",
  );
  const limited = new InProcessProtocolTransport();
  const limitedRecorder = new ProtocolRecorder(limited);
  await recorder.replay(limited, { until: 0 });
  expect(limitedRecorder.messages()).toEqual([]);
  const unsubscribe = limited.subscribe(() => {
    throw new Error("should not run");
  });
  unsubscribe();
  limited.close();
  expect(() => limited.subscribe(() => undefined)).toThrow("closed");
  expect(() => limited.send(createProtocolMessage("event", {}))).toThrow(
    "closed",
  );
  recorder.dispose();
  targetRecorder.dispose();
  limitedRecorder.dispose();
  source.close();
  target.close();
});

test("protocol validation rejects malformed messages and stringifies non-error failures", () => {
  const request = createProtocolRequest("query", {});
  const failure = createProtocolError(request, "failed");
  expect(failure.payload.message).toBe("failed");
  expect(isProtocolReply(failure)).toBe(true);
  expect(isProtocolReply(request)).toBe(false);
  expect(isProtocolMessageType("performance")).toBe(true);
  expect(isProtocolMessageType(1)).toBe(false);
  const transport = new InProcessProtocolTransport();
  expect(() =>
    transport.send({
      version: 1,
      id: "",
      type: "unknown",
      timestamp: 0,
      payload: null,
    } as never),
  ).toThrow("Invalid");
});

test("recording boundaries redact credentials recursively before snapshots and exports", () => {
  const transport = new InProcessProtocolTransport();
  const recorder = new ProtocolRecorder(transport);
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMzQ1In0.signaturevalue123";
  transport.send(
    createProtocolMessage("snapshot", {
      authorization: "Bearer top-secret",
      nested: {
        password: "hunter2",
        url: "https://admin:password@example.com/private?token=query-secret",
        note: `token ${jwt}`,
        log: "credential=raw-secret",
      },
    }),
  );
  const snapshot = recorder.messages()[0];
  expect(snapshot?.payload).toEqual({
    authorization: protocolRedactedValue,
    nested: {
      password: protocolRedactedValue,
      url: "https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/private?token=[REDACTED]",
      note: `token ${protocolRedactedValue}`,
      log: `credential=${protocolRedactedValue}`,
    },
  });
  const exported = recorder.export();
  expect(exported).not.toContain("top-secret");
  expect(exported).not.toContain("hunter2");
  expect(exported).not.toContain("query-secret");
  expect(exported).not.toContain("raw-secret");
  expect(exported).not.toContain(jwt);
  expect(
    redactProtocolValue({
      client_secret: "secret",
      array: [{ apiKey: "key" }],
    }),
  ).toEqual({
    client_secret: protocolRedactedValue,
    array: [{ apiKey: protocolRedactedValue }],
  });
  recorder.dispose();
  transport.close();
});

test("protocol envelopes enforce complete invariants and bounded JSON data", () => {
  const valid = createProtocolMessage("event", { ok: true }, { timestamp: 1 });
  expect(sanitizeProtocolMessage(valid)).toEqual(valid);
  for (const malformed of [
    { ...valid, id: "" },
    { ...valid, id: "has spaces" },
    { ...valid, timestamp: Number.NaN },
    { ...valid, timestamp: -1 },
    { ...valid, replyTo: "" },
    { ...valid, extra: true },
    { ...valid, payload: { value: undefined } },
    { ...valid, payload: { value: BigInt(1) } },
  ]) {
    expect(validateProtocolMessage(malformed)).toBe(false);
  }
  expect(() =>
    createProtocolMessage("event", {
      value: "x".repeat(protocolLimits.maxPayloadBytes + 1),
    }),
  ).toThrow("maximum byte size");
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  expect(() => redactProtocolValue(cyclic)).toThrow("cycles");
});

test("recording import rejects malformed, oversized, and unsafe envelopes", () => {
  const transport = new InProcessProtocolTransport();
  const recorder = new ProtocolRecorder(transport, 1);
  const valid = createProtocolMessage("event", { ok: true }, { timestamp: 1 });
  expect(() => recorder.import("{")).toThrow("not valid JSON");
  expect(() => recorder.import("[]")).toThrow("must be an object");
  expect(() =>
    recorder.import(
      JSON.stringify({ version: 1, messages: [], unexpected: true }),
    ),
  ).toThrow("unknown fields");
  expect(() =>
    recorder.import(JSON.stringify({ version: 1, messages: [valid, valid] })),
  ).toThrow("message limit");
  expect(() =>
    recorder.import(
      JSON.stringify({
        version: 1,
        messages: [{ ...valid, payload: { token: "unsafe" }, replyTo: "" }],
      }),
    ),
  ).toThrow("invalid messages");
  expect(() =>
    recorder.import(" ".repeat(protocolLimits.maxRecordingBytes + 1)),
  ).toThrow("maximum byte size");
  expect(() => new ProtocolRecorder(transport, 0)).toThrow("between 1");
  expect(
    () => new ProtocolRecorder(transport, protocolLimits.maxMessages + 1),
  ).toThrow(String(protocolLimits.maxMessages));
  recorder.dispose();
  transport.close();
});
