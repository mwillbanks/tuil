import { BrowserEventEmitter, type EventListener } from "./emitter";

export interface GhosttyTerminalWriter {
  write(data: string | Uint8Array, callback?: () => void): void;
}

export class BrowserStream extends BrowserEventEmitter {
  pipe<T>(destination: T): T {
    return destination;
  }
}

export class BrowserReadableStream extends BrowserStream {
  columns: number;
  rows: number;
  readonly isTTY = true;
  readable = true;
  isRaw = false;
  #queuedBytes = 0;
  readonly #queue: string[] = [];

  constructor(
    columns: number,
    rows: number,
    readonly maxQueuedBytes = 65_536,
  ) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  push(data: string): void {
    if (!this.readable || data.length === 0) return;
    const bytes = new TextEncoder().encode(data).byteLength;
    if (this.#queuedBytes + bytes > this.maxQueuedBytes) {
      this.emit(
        "error",
        new RangeError("Browser terminal input queue exceeded its limit"),
      );
      return;
    }
    this.#queue.push(data);
    this.#queuedBytes += bytes;
    this.emit("readable");
  }

  read(): string | null {
    const data = this.#queue.shift();
    if (data === undefined) return null;
    this.#queuedBytes -= new TextEncoder().encode(data).byteLength;
    return data;
  }

  setEncoding(_encoding = "utf8"): this {
    return this;
  }

  setRawMode(raw: boolean): this {
    this.isRaw = raw;
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  destroy(): this {
    this.readable = false;
    this.#queue.length = 0;
    this.#queuedBytes = 0;
    this.removeAllListeners();
    return this;
  }

  override on(event: string | symbol, listener: EventListener): this {
    return super.on(event, listener);
  }
}

interface PendingWrite {
  readonly data: string | Uint8Array;
  readonly bytes: number;
  readonly callback?: (error?: Error | null) => void;
}

export class BrowserWritableStream extends BrowserStream {
  columns: number;
  rows: number;
  readonly isTTY = true;
  writable = true;
  #queuedBytes = 0;
  #writing = false;
  readonly #queue: PendingWrite[] = [];
  readonly #idleWaiters = new Set<() => void>();

  constructor(
    readonly terminal: GhosttyTerminalWriter,
    columns: number,
    rows: number,
    readonly maxQueuedBytes = 1_048_576,
  ) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write(
    chunk: string | Uint8Array,
    encodingOrCallback?: string | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    const onComplete =
      typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (!this.writable) {
      onComplete?.(new Error("Browser terminal output is closed"));
      return false;
    }
    const data = typeof chunk === "string" ? chunk : chunk.slice();
    const bytes =
      typeof data === "string"
        ? new TextEncoder().encode(data).byteLength
        : data.byteLength;
    if (this.#queuedBytes + bytes > this.maxQueuedBytes) {
      const error = new RangeError(
        "Browser terminal output queue exceeded its limit",
      );
      onComplete?.(error);
      this.emit("error", error);
      return false;
    }
    this.#queue.push({ data, bytes, callback: onComplete });
    this.#queuedBytes += bytes;
    this.#flush();
    return this.#queuedBytes < this.maxQueuedBytes;
  }

  getColorDepth(): number {
    return 24;
  }

  hasColors(count = 16): boolean {
    return count <= 16_777_216;
  }

  setDefaultEncoding(_encoding: string): this {
    return this;
  }

  cork(): void {}

  uncork(): void {
    this.#flush();
  }

  whenIdle(): Promise<void> {
    if (!this.#writing && this.#queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.add(resolve));
  }

  resize(columns: number, rows: number): void {
    if (this.columns === columns && this.rows === rows) return;
    this.columns = columns;
    this.rows = rows;
    this.emit("resize");
  }

  destroy(): void {
    this.writable = false;
    const error = new Error("Browser terminal output was disposed");
    for (const write of this.#queue.splice(0)) write.callback?.(error);
    this.#queuedBytes = 0;
    this.#writing = false;
    for (const resolve of this.#idleWaiters) resolve();
    this.#idleWaiters.clear();
    this.removeAllListeners();
  }

  #flush(): void {
    if (this.#writing || !this.writable) return;
    const next = this.#queue.shift();
    if (!next) {
      for (const resolve of this.#idleWaiters) resolve();
      this.#idleWaiters.clear();
      this.emit("drain");
      return;
    }
    this.#writing = true;
    try {
      this.terminal.write(next.data, () => {
        this.#queuedBytes -= next.bytes;
        this.#writing = false;
        next.callback?.(null);
        this.#flush();
      });
    } catch (cause) {
      this.#queuedBytes -= next.bytes;
      this.#writing = false;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      next.callback?.(error);
      this.emit("error", error);
      this.#flush();
    }
  }
}
