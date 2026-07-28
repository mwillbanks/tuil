export const protocolVersion = 1 as const;

export const protocolLimits = Object.freeze({
  maxIdLength: 128,
  maxMessages: 10_000,
  maxMessageBytes: 1_048_576,
  maxPayloadBytes: 786_432,
  maxRecordingBytes: 8_388_608,
  maxValueDepth: 32,
});

export const protocolRedactedValue = "[REDACTED]" as const;

export type ProtocolMessageType =
  | "snapshot"
  | "event"
  | "command"
  | "result"
  | "panel"
  | "query"
  | "trace"
  | "frame"
  | "export"
  | "import"
  | "error"
  | "contribution"
  | "performance";

const protocolMessageTypes = new Set<ProtocolMessageType>([
  "snapshot",
  "event",
  "command",
  "result",
  "panel",
  "query",
  "trace",
  "frame",
  "export",
  "import",
  "error",
  "contribution",
  "performance",
]);
const envelopeKeys = new Set([
  "version",
  "id",
  "type",
  "timestamp",
  "payload",
  "replyTo",
]);
const jwtPattern =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g;
const authorizationPattern = /^(?:basic|bearer)\s+\S+/i;
const inlineCredentialPattern =
  /(\b(?:authorization|cookie|credential|password|passwd|secret|session|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const nonAlphaNumericPattern = /[^a-z0-9]/gi;
const protocolIdPattern = /^[A-Za-z0-9._:-]+$/;
const textEncoder = new TextEncoder();

export function isProtocolMessageType(
  value: unknown,
): value is ProtocolMessageType {
  return (
    typeof value === "string" &&
    protocolMessageTypes.has(value as ProtocolMessageType)
  );
}

export interface ProtocolMessage<T = unknown> {
  readonly version: typeof protocolVersion;
  readonly id: string;
  readonly type: ProtocolMessageType;
  readonly timestamp: number;
  readonly payload: T;
  readonly replyTo?: string;
}

export interface ProtocolTransport {
  send(message: ProtocolMessage): void | Promise<void>;
  subscribe(listener: (message: ProtocolMessage) => void): () => void;
  close(): void | Promise<void>;
}

export {
  createProtocolError,
  createProtocolMessage,
  createProtocolRequest,
  createProtocolResult,
  InProcessProtocolTransport,
  isProtocolReply,
  ProtocolRecorder,
  redactProtocolValue,
  sanitizeProtocolMessage,
  validateProtocolMessage,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Protocol values must be JSON serializable");
  }
  return textEncoder.encode(serialized).byteLength;
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.username && !parsed.password) return value;
    parsed.username = protocolRedactedValue;
    parsed.password = protocolRedactedValue;
    return parsed.toString();
  } catch {
    return value;
  }
}

function redactString(value: string): string {
  if (authorizationPattern.test(value)) return protocolRedactedValue;
  return redactUrl(value)
    .replace(jwtPattern, protocolRedactedValue)
    .replace(inlineCredentialPattern, `$1${protocolRedactedValue}`);
}

function isSensitiveKey(value: string): boolean {
  const normalized = value.replace(nonAlphaNumericPattern, "").toLowerCase();
  return [
    "authorization",
    "cookie",
    "credential",
    "password",
    "passwd",
    "secret",
    "session",
    "token",
    "apikey",
    "accesskey",
    "privatekey",
    "clientsecret",
  ].some((term) => normalized.includes(term));
}

function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth > protocolLimits.maxValueDepth) {
    throw new TypeError("Protocol value exceeds the maximum nesting depth");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number") return assertFiniteProtocolNumber(value);
  if (typeof value !== "object") {
    throw new TypeError("Protocol values must contain only JSON data");
  }
  return redactProtocolObject(value, depth, seen);
}

function assertFiniteProtocolNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("Protocol numbers must be finite");
  }
  return value;
}

function redactProtocolObject(
  value: object,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (seen.has(value)) {
    throw new TypeError("Protocol values cannot contain cycles");
  }
  seen.add(value);
  try {
    return Array.isArray(value)
      ? redactProtocolArray(value, depth, seen)
      : redactProtocolRecord(value, depth, seen);
  } finally {
    seen.delete(value);
  }
}

function redactProtocolArray(
  value: readonly unknown[],
  depth: number,
  seen: WeakSet<object>,
): readonly unknown[] {
  return Object.freeze(value.map((item) => redactValue(item, depth + 1, seen)));
}

function redactProtocolRecord(
  value: object,
  depth: number,
  seen: WeakSet<object>,
): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) {
    throw new TypeError("Protocol objects must be plain JSON objects");
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key)
          ? protocolRedactedValue
          : redactValue(item, depth + 1, seen),
      ]),
    ),
  );
}

/**
 * Recursively clones JSON-compatible protocol data and removes credentials,
 * tokens, JWTs, and URL userinfo. This is the safe boundary for devtools
 * snapshots and exports.
 */
function redactProtocolValue<T>(value: T): T {
  const redacted = redactValue(value, 0, new WeakSet());
  if (jsonByteLength(redacted) > protocolLimits.maxPayloadBytes) {
    throw new RangeError("Protocol payload exceeds the maximum byte size");
  }
  return redacted as T;
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= protocolLimits.maxIdLength &&
    protocolIdPattern.test(value)
  );
}

function assertProtocolEnvelope(
  value: Readonly<Record<string, unknown>>,
): void {
  if (Object.keys(value).some((key) => !envelopeKeys.has(key))) {
    throw new TypeError("Protocol message contains unknown envelope fields");
  }
  if (value["version"] !== protocolVersion) {
    throw new TypeError("Protocol message has an unsupported version");
  }
  if (!validId(value["id"])) {
    throw new TypeError("Protocol message id is invalid");
  }
  if (!isProtocolMessageType(value["type"])) {
    throw new TypeError("Protocol message type is invalid");
  }
}

function assertProtocolRouting(value: Readonly<Record<string, unknown>>): void {
  const timestamp = value["timestamp"];
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  ) {
    throw new TypeError("Protocol message timestamp is invalid");
  }
  if (value["replyTo"] !== undefined && !validId(value["replyTo"])) {
    throw new TypeError("Protocol message replyTo is invalid");
  }
}

function assertProtocolPayload(value: Readonly<Record<string, unknown>>): void {
  if (!Object.hasOwn(value, "payload")) {
    throw new TypeError("Protocol message payload is required");
  }
  redactProtocolValue(value["payload"]);
  if (jsonByteLength(value) > protocolLimits.maxMessageBytes) {
    throw new RangeError("Protocol message exceeds the maximum byte size");
  }
}

function assertProtocolMessage(
  value: unknown,
): asserts value is ProtocolMessage {
  if (!isPlainObject(value)) {
    throw new TypeError("Protocol message must be a plain object");
  }
  assertProtocolEnvelope(value);
  assertProtocolRouting(value);
  assertProtocolPayload(value);
}

function validateProtocolMessage(value: unknown): value is ProtocolMessage {
  try {
    assertProtocolMessage(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an envelope and returns an immutable, recursively redacted clone.
 */
function sanitizeProtocolMessage<T>(
  message: ProtocolMessage<T>,
): ProtocolMessage<T> {
  assertProtocolMessage(message);
  const sanitized = Object.freeze({
    version: protocolVersion,
    id: message.id,
    type: message.type,
    timestamp: message.timestamp,
    payload: redactProtocolValue(message.payload),
    ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
  }) as ProtocolMessage<T>;
  if (jsonByteLength(sanitized) > protocolLimits.maxMessageBytes) {
    throw new RangeError("Protocol message exceeds the maximum byte size");
  }
  return sanitized;
}

let nextMessageId = 0;

function createProtocolMessage<T>(
  type: ProtocolMessageType,
  payload: T,
  options: { readonly replyTo?: string; readonly timestamp?: number } = {},
): ProtocolMessage<T> {
  return sanitizeProtocolMessage({
    version: protocolVersion,
    id: `tuil-${++nextMessageId}`,
    type,
    timestamp: options.timestamp ?? Date.now(),
    payload,
    ...(options.replyTo === undefined ? {} : { replyTo: options.replyTo }),
  });
}

function isProtocolReply(message: ProtocolMessage): boolean {
  return message.replyTo !== undefined;
}

class InProcessProtocolTransport implements ProtocolTransport {
  readonly #listeners = new Set<(message: ProtocolMessage) => void>();
  #closed = false;

  send(message: ProtocolMessage): void {
    if (this.#closed) throw new Error("Protocol transport is closed");
    if (!validateProtocolMessage(message)) {
      throw new Error("Invalid tuil protocol message");
    }
    for (const listener of this.#listeners) listener(message);
  }

  subscribe(listener: (message: ProtocolMessage) => void): () => void {
    if (this.#closed) throw new Error("Protocol transport is closed");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    this.#closed = true;
    this.#listeners.clear();
  }
}

function parseProtocolRecordingJson(source: string): unknown {
  if (
    textEncoder.encode(source).byteLength > protocolLimits.maxRecordingBytes
  ) {
    throw new RangeError("Protocol recording exceeds the maximum byte size");
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("Protocol recording is not valid JSON");
  }
}

function assertProtocolRecordingEnvelope(
  value: unknown,
): asserts value is Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) {
    throw new Error("Protocol recording must be an object");
  }
  if (
    Object.keys(value).some((key) => key !== "version" && key !== "messages")
  ) {
    throw new Error("Protocol recording contains unknown fields");
  }
  if (value["version"] !== protocolVersion) {
    throw new Error(
      `Unsupported tuil protocol version ${String(value["version"])}`,
    );
  }
}

function protocolRecordingMessages(
  value: Readonly<Record<string, unknown>>,
  maxMessages: number,
): readonly ProtocolMessage[] {
  const messages = value["messages"];
  if (!Array.isArray(messages)) {
    throw new Error("Protocol recording messages must be an array");
  }
  if (messages.length > maxMessages) {
    throw new RangeError(
      `Protocol recording exceeds the configured ${maxMessages} message limit`,
    );
  }
  if (!messages.every(validateProtocolMessage)) {
    throw new Error("Protocol recording contains invalid messages");
  }
  return messages;
}

class ProtocolRecorder {
  readonly #messages: ProtocolMessage[] = [];
  readonly #dispose: () => void;
  readonly #maxMessages: number;

  constructor(
    transport: ProtocolTransport,
    maxMessages: number = protocolLimits.maxMessages,
  ) {
    if (
      !Number.isSafeInteger(maxMessages) ||
      maxMessages < 1 ||
      maxMessages > protocolLimits.maxMessages
    ) {
      throw new TypeError(
        `Protocol recording limit must be between 1 and ${protocolLimits.maxMessages}`,
      );
    }
    this.#maxMessages = maxMessages;
    this.#dispose = transport.subscribe((message) => {
      this.#record(message);
    });
  }

  messages(type?: ProtocolMessageType): readonly ProtocolMessage[] {
    return Object.freeze(
      type
        ? this.#messages.filter((message) => message.type === type)
        : [...this.#messages],
    );
  }

  export(): string {
    const serialized = JSON.stringify({
      version: protocolVersion,
      messages: this.#messages.map((message) =>
        sanitizeProtocolMessage(message),
      ),
    });
    if (
      textEncoder.encode(serialized).byteLength >
      protocolLimits.maxRecordingBytes
    ) {
      throw new RangeError("Protocol recording exceeds the maximum byte size");
    }
    return serialized;
  }

  import(source: string): readonly ProtocolMessage[] {
    const value = parseProtocolRecordingJson(source);
    assertProtocolRecordingEnvelope(value);
    const messages = protocolRecordingMessages(value, this.#maxMessages);
    for (const message of messages) this.#record(message);
    return this.messages();
  }

  async replay(
    transport: ProtocolTransport,
    options: { readonly until?: number } = {},
  ): Promise<void> {
    const until = options.until;
    const firstAfterLimit =
      until === undefined
        ? -1
        : this.#messages.findIndex((message) => message.timestamp > until);
    const messages =
      firstAfterLimit === -1
        ? this.#messages
        : this.#messages.slice(0, firstAfterLimit);
    await messages.reduce<Promise<void>>(
      (previous, message) =>
        previous.then(async () => {
          await transport.send(message);
        }),
      Promise.resolve(),
    );
  }

  dispose(): void {
    this.#dispose();
  }

  #record(message: ProtocolMessage): void {
    this.#messages.push(sanitizeProtocolMessage(message));
    if (this.#messages.length > this.#maxMessages) {
      this.#messages.splice(0, this.#messages.length - this.#maxMessages);
    }
  }
}

function createProtocolRequest<T>(
  type: Extract<ProtocolMessageType, "command" | "query">,
  payload: T,
): ProtocolMessage<T> {
  return createProtocolMessage(type, payload);
}

function createProtocolResult<T>(
  request: ProtocolMessage,
  payload: T,
): ProtocolMessage<T> {
  return createProtocolMessage("result", payload, {
    replyTo: request.id,
  });
}

function createProtocolError(
  request: ProtocolMessage,
  error: unknown,
): ProtocolMessage<{ readonly message: string }> {
  return createProtocolMessage(
    "error",
    {
      message: error instanceof Error ? error.message : String(error),
    },
    { replyTo: request.id },
  );
}
