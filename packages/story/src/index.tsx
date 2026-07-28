import type { Disposable, ObservedEvent } from "@mwillbanks/tuil";
import {
  defaultTerminalStoryControls,
  type QueryableSemanticNode,
  type TerminalStoryControls,
  type TuilStory,
  type TuilStoryDefinition,
} from "@mwillbanks/tuil-testing";
import {
  renderTuil,
  type TuilTestInstance,
} from "@mwillbanks/tuil-testing-ink";
import {
  createDefaultThemeRegistry,
  defaultTheme,
  type Theme,
  type ThemeRegistry,
} from "@mwillbanks/tuil-theme";
import chalk from "chalk";
import { createElement, type ReactElement } from "react";

export type {
  TerminalStoryControls,
  TuilStory,
  TuilStoryDefinition,
} from "@mwillbanks/tuil-testing";
export {
  defaultTerminalStoryControls,
  defineTuilStories,
} from "@mwillbanks/tuil-testing";

export interface TuilStorySet {
  readonly id: string;
  readonly title: string;
  readonly definition: TuilStoryDefinition<
    Record<string, unknown>,
    Readonly<Record<string, TuilStory<Record<string, unknown>>>>
  >;
}

export interface StoryAction {
  readonly type: "render" | "args" | "controls" | "input" | "resize";
  readonly timestamp: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface StoryFrame {
  readonly storyId: string;
  readonly variant: string;
  readonly frame: string;
  readonly ansiFrame: string;
  readonly semantics: readonly QueryableSemanticNode[];
  readonly focus: {
    readonly focusedId?: string;
    readonly nodes: readonly {
      readonly id: string;
      readonly label?: string;
      readonly role?: string;
    }[];
  };
  readonly events: readonly ObservedEvent[];
  readonly actions: readonly StoryAction[];
  readonly controls: TerminalStoryControls;
}

function asStorySet<TProps>(
  id: string,
  title: string,
  definition: TuilStoryDefinition<
    TProps,
    Readonly<Record<string, { readonly args: Partial<TProps> }>>
  >,
): TuilStorySet {
  return {
    id,
    title,
    definition: definition as unknown as TuilStorySet["definition"],
  };
}

export class TuilStoryCatalog {
  readonly #sets = new Map<string, TuilStorySet>();

  register<TProps>(
    id: string,
    title: string,
    definition: TuilStoryDefinition<
      TProps,
      Readonly<Record<string, { readonly args: Partial<TProps> }>>
    >,
  ): Disposable {
    if (!id.trim()) throw new Error("Story set id cannot be empty");
    if (this.#sets.has(id)) {
      throw new Error(`Story set "${id}" is already registered`);
    }
    const registered = Object.freeze(asStorySet(id, title, definition));
    this.#sets.set(id, registered);
    return {
      dispose: () => {
        if (this.#sets.get(id) === registered) this.#sets.delete(id);
      },
    };
  }

  get(id: string): TuilStorySet | undefined {
    return this.#sets.get(id);
  }

  list(): readonly TuilStorySet[] {
    return [...this.#sets.values()].sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  }
}

export interface OpenStoryOptions {
  readonly storyId: string;
  readonly variant: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly controls?: Partial<TerminalStoryControls>;
  readonly themeRegistry?: ThemeRegistry;
  readonly signal?: AbortSignal;
}

function resolveTheme(
  controls: TerminalStoryControls,
  registry?: ThemeRegistry,
): Theme {
  if (!registry) {
    return controls.theme === defaultTheme.id
      ? defaultTheme
      : createDefaultThemeRegistry().resolve(controls.theme);
  }
  return registry.resolve(controls.theme);
}

async function waitWithSignal<T>(
  value: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return value;
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () =>
      reject(
        signal.reason ??
          new DOMException("The operation was aborted", "AbortError"),
      );
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([value, aborted]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

interface StoryRenderWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal?: AbortSignal;
  readonly abort?: () => void;
}

class StoryRenderLock {
  #locked = false;
  readonly #waiters: StoryRenderWaiter[] = [];

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (!this.#locked) {
      this.#locked = true;
      return this.#release;
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: StoryRenderWaiter = {
        resolve,
        reject,
        signal,
        abort: signal
          ? () => {
              const index = this.#waiters.indexOf(waiter);
              if (index >= 0) this.#waiters.splice(index, 1);
              reject(
                signal.reason ??
                  new DOMException("The operation was aborted", "AbortError"),
              );
            }
          : undefined,
      };
      this.#waiters.push(waiter);
      if (waiter.abort) {
        signal?.addEventListener("abort", waiter.abort, { once: true });
      }
    });
  }

  readonly #release = (): void => {
    const waiter = this.#waiters.shift();
    if (!waiter) {
      this.#locked = false;
      return;
    }
    if (waiter.abort) {
      waiter.signal?.removeEventListener("abort", waiter.abort);
    }
    waiter.resolve(this.#release);
  };
}

const storyRenderLock = new StoryRenderLock();

function chalkLevel(
  colorDepth: TerminalStoryControls["colorDepth"],
): 0 | 1 | 2 | 3 {
  if (colorDepth === 1) return 0;
  if (colorDepth === 4) return 1;
  if (colorDepth === 8) return 2;
  return 3;
}

export class TuilStorySession {
  readonly #catalog: TuilStoryCatalog;
  readonly #storyId: string;
  readonly #variant: string;
  readonly #themeRegistry?: ThemeRegistry;
  readonly #signal?: AbortSignal;
  readonly #releaseRenderLock: () => void;
  readonly #previousChalkLevel: 0 | 1 | 2 | 3;
  readonly #events: ObservedEvent[] = [];
  readonly #actions: StoryAction[] = [];
  #args: Readonly<Record<string, unknown>>;
  #controls: TerminalStoryControls;
  #instance?: TuilTestInstance;
  #stopObserving?: () => void;
  #closed = false;

  private constructor(
    catalog: TuilStoryCatalog,
    options: OpenStoryOptions,
    releaseRenderLock: () => void,
    previousChalkLevel: 0 | 1 | 2 | 3,
  ) {
    this.#catalog = catalog;
    this.#storyId = options.storyId;
    this.#variant = options.variant;
    this.#themeRegistry = options.themeRegistry;
    this.#signal = options.signal;
    this.#releaseRenderLock = releaseRenderLock;
    this.#previousChalkLevel = previousChalkLevel;
    const story = this.#story();
    this.#args = Object.freeze({ ...story.args, ...options.args });
    this.#controls = Object.freeze({
      ...defaultTerminalStoryControls,
      ...story.terminal,
      ...options.controls,
    });
  }

  static async open(
    catalog: TuilStoryCatalog,
    options: OpenStoryOptions,
  ): Promise<TuilStorySession> {
    const releaseRenderLock = await storyRenderLock.acquire(options.signal);
    const previousChalkLevel = chalk.level;
    let session: TuilStorySession;
    try {
      session = new TuilStorySession(
        catalog,
        options,
        releaseRenderLock,
        previousChalkLevel,
      );
    } catch (error) {
      chalk.level = previousChalkLevel;
      releaseRenderLock();
      throw error;
    }
    try {
      await session.#render(options.signal);
      return session;
    } catch (error) {
      try {
        await session.#disposeInstance();
      } catch (cleanupError) {
        session.#releaseRenderer();
        throw new AggregateError(
          [error, cleanupError],
          "Story rendering and cleanup failed",
        );
      }
      session.#releaseRenderer();
      throw error;
    }
  }

  get args(): Readonly<Record<string, unknown>> {
    return this.#args;
  }

  get controls(): TerminalStoryControls {
    return this.#controls;
  }

  async setArgs(
    args: Readonly<Record<string, unknown>>,
    signal = this.#signal,
  ): Promise<void> {
    this.#assertOpen();
    signal?.throwIfAborted();
    chalk.level = chalkLevel(this.#controls.colorDepth);
    this.#args = Object.freeze({ ...this.#args, ...args });
    this.#recordAction({ type: "args", timestamp: Date.now(), detail: args });
    this.#instance?.rerender(this.#element());
    await waitWithSignal(Bun.sleep(10), signal);
  }

  async setControls(
    controls: Partial<TerminalStoryControls>,
    signal = this.#signal,
  ): Promise<void> {
    this.#assertOpen();
    signal?.throwIfAborted();
    const previous = this.#controls;
    this.#controls = Object.freeze({ ...previous, ...controls });
    this.#recordAction({
      type: "controls",
      timestamp: Date.now(),
      detail: controls,
    });
    if (controls.width !== undefined || controls.height !== undefined) {
      this.#recordAction({
        type: "resize",
        timestamp: Date.now(),
        detail: {
          width: this.#controls.width,
          height: this.#controls.height,
        },
      });
    }
    // Capabilities and normalized themes are immutable runtime state. Recreate
    // the renderer so every control, including dimensions, reaches components.
    await this.#disposeInstance();
    await this.#render(signal);
  }

  async press(input: string, signal = this.#signal): Promise<void> {
    this.#assertOpen();
    signal?.throwIfAborted();
    chalk.level = chalkLevel(this.#controls.colorDepth);
    this.#recordAction({
      type: "input",
      timestamp: Date.now(),
      detail: { input },
    });
    await waitWithSignal(this.#requireInstance().user.press(input), signal);
  }

  snapshot(): StoryFrame {
    this.#assertOpen();
    const instance = this.#requireInstance();
    const snapshot = instance.screen.snapshot();
    return Object.freeze({
      storyId: this.#storyId,
      variant: this.#variant,
      frame: snapshot.frame,
      ansiFrame: instance.frames.at(-1) ?? snapshot.frame,
      semantics: Object.freeze([...snapshot.nodes]),
      focus: Object.freeze({
        focusedId: instance.app.focus.focusedId,
        nodes: Object.freeze(
          instance.app.focus.nodes().map(({ id, label, role }) => ({
            id,
            label,
            role,
          })),
        ),
      }),
      events: Object.freeze([...this.#events]),
      actions: Object.freeze([...this.#actions]),
      controls: this.#controls,
    });
  }

  async close(signal?: AbortSignal): Promise<void> {
    if (this.#closed) {
      signal?.throwIfAborted();
      return;
    }
    this.#closed = true;
    try {
      await this.#disposeInstance();
    } finally {
      this.#releaseRenderer();
    }
    signal?.throwIfAborted();
  }

  #story() {
    const set = this.#catalog.get(this.#storyId);
    if (!set) throw new Error(`Unknown story set "${this.#storyId}"`);
    const story = set.definition.stories[this.#variant];
    if (!story) {
      throw new Error(
        `Unknown variant "${this.#variant}" in story set "${this.#storyId}"`,
      );
    }
    return story;
  }

  #element(): ReactElement {
    const set = this.#catalog.get(this.#storyId);
    if (!set) throw new Error(`Unknown story set "${this.#storyId}"`);
    return createElement(set.definition.component, this.#args);
  }

  #requireInstance(): TuilTestInstance {
    this.#assertOpen();
    if (!this.#instance) throw new Error("Story session is closed");
    return this.#instance;
  }

  async #render(signal = this.#signal): Promise<void> {
    signal?.throwIfAborted();
    const controls = this.#controls;
    chalk.level = chalkLevel(controls.colorDepth);
    const instance = renderTuil(this.#element() as ReactElement, {
      theme: resolveTheme(controls, this.#themeRegistry),
      terminal: {
        mode: controls.interactive ? "interactive" : "static",
        capabilities: {
          width: controls.width,
          height: controls.height,
          colorDepth: controls.colorDepth,
          unicode: controls.unicode,
          hyperlinks: controls.hyperlinks,
          interactive: controls.interactive,
          tty: controls.interactive,
          alternateScreen: controls.interactive,
          mouse: controls.mouse,
          images: false,
          reducedMotion: controls.reducedMotion,
          platform: controls.platform,
        },
      },
    });
    this.#instance = instance;
    instance.resize(controls.width, controls.height);
    this.#stopObserving = instance.app.events.observe((event) => {
      this.#events.push(event);
      if (this.#events.length > 200) this.#events.shift();
    });
    try {
      await waitWithSignal(instance.ready, signal);
    } catch (error) {
      await this.#disposeInstance().catch(() => undefined);
      throw error;
    }
    this.#recordAction({ type: "render", timestamp: Date.now() });
  }

  async #disposeInstance(): Promise<void> {
    this.#stopObserving?.();
    this.#stopObserving = undefined;
    const instance = this.#instance;
    this.#instance = undefined;
    if (instance) await instance.cleanup();
  }

  #recordAction(action: StoryAction): void {
    this.#actions.push(action);
    if (this.#actions.length > 200) this.#actions.shift();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Story session is closed");
  }

  #releaseRenderer(): void {
    if (this.#released) return;
    this.#released = true;
    chalk.level = this.#previousChalkLevel;
    this.#releaseRenderLock();
  }

  #released = false;
}

export interface StoryBridgeRequest {
  readonly storyId: string;
  readonly variant: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly controls?: Partial<TerminalStoryControls>;
  readonly inputs?: readonly string[];
}

export const storyHttpLimits = Object.freeze({
  maxBodyBytes: 65_536,
  maxArgsBytes: 32_768,
  maxArgsEntries: 100,
  maxArgsDepth: 8,
  maxArrayLength: 100,
  maxStringLength: 8_192,
  maxIdentifierLength: 128,
  maxInputs: 100,
  maxInputLength: 1_024,
  minWidth: 20,
  maxWidth: 500,
  minHeight: 1,
  maxHeight: 200,
  defaultTimeoutMs: 5_000,
  maxTimeoutMs: 60_000,
});

export interface StoryHttpHandlerOptions {
  readonly themeRegistry?: ThemeRegistry;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
}

const storyRequestKeys = new Set([
  "storyId",
  "variant",
  "args",
  "controls",
  "inputs",
]);
const storyControlKeys = new Set<keyof TerminalStoryControls>([
  "width",
  "height",
  "colorDepth",
  "unicode",
  "theme",
  "platform",
  "interactive",
  "reducedMotion",
  "mouse",
  "hyperlinks",
]);
const storyPlatforms = new Set<NodeJS.Platform>([
  "aix",
  "android",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "openbsd",
  "sunos",
  "win32",
  "cygwin",
  "netbsd",
]);
const storyTextEncoder = new TextEncoder();

function isPlainStoryObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertBoundedStoryValue(
  value: unknown,
  depth: number,
  state: { entries: number },
): void {
  if (depth > storyHttpLimits.maxArgsDepth) {
    throw new Error("Story args exceed the maximum nesting depth");
  }
  if (assertStoryScalar(value)) return;
  if (Array.isArray(value)) {
    assertStoryArray(value, depth, state);
    return;
  }
  assertStoryObject(value, depth, state);
}

function assertStoryScalar(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value === "string") {
    if (value.length > storyHttpLimits.maxStringLength) {
      throw new Error("A story arg string exceeds the maximum length");
    }
    return true;
  }
  if (typeof value !== "object") {
    throw new Error("Story args must contain only JSON data");
  }
  return false;
}

function addStoryEntries(state: { entries: number }, count: number): void {
  state.entries += count;
  if (state.entries > storyHttpLimits.maxArgsEntries) {
    throw new Error("Story args exceed the maximum entry count");
  }
}

function assertStoryArray(
  value: readonly unknown[],
  depth: number,
  state: { entries: number },
): void {
  if (value.length > storyHttpLimits.maxArrayLength) {
    throw new Error("A story arg array exceeds the maximum length");
  }
  addStoryEntries(state, value.length);
  for (const item of value) {
    assertBoundedStoryValue(item, depth + 1, state);
  }
}

function assertStoryObject(
  value: unknown,
  depth: number,
  state: { entries: number },
): void {
  if (!isPlainStoryObject(value)) {
    throw new Error("Story args must contain only JSON data");
  }
  const entries = Object.entries(value);
  addStoryEntries(state, entries.length);
  for (const [key, item] of entries) {
    if (key.length > storyHttpLimits.maxIdentifierLength) {
      throw new Error("A story arg key exceeds the maximum length");
    }
    assertBoundedStoryValue(item, depth + 1, state);
  }
}

function assertStoryDimension(
  value: unknown,
  name: "width" | "height",
  minimum: number,
  maximum: number,
): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) ||
      (value as number) < minimum ||
      (value as number) > maximum)
  ) {
    throw new Error(
      `Story ${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
}

function assertStoryBooleanControls(
  value: Readonly<Record<string, unknown>>,
): void {
  for (const key of [
    "unicode",
    "interactive",
    "reducedMotion",
    "mouse",
    "hyperlinks",
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      throw new Error(`Story ${key} control must be a boolean`);
    }
  }
}

function assertStoryNamedControls(
  value: Readonly<Record<string, unknown>>,
): void {
  const theme = value["theme"];
  if (
    theme !== undefined &&
    (typeof theme !== "string" ||
      theme.length === 0 ||
      theme.length > storyHttpLimits.maxIdentifierLength)
  ) {
    throw new Error("Story theme control is invalid");
  }
  const platform = value["platform"];
  if (
    platform !== undefined &&
    !storyPlatforms.has(platform as NodeJS.Platform)
  ) {
    throw new Error("Story platform control is invalid");
  }
}

function assertStoryControls(
  value: unknown,
): asserts value is Partial<TerminalStoryControls> {
  if (!isPlainStoryObject(value)) {
    throw new Error("Story controls must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!storyControlKeys.has(key as keyof TerminalStoryControls)) {
      throw new Error(`Unknown story control "${key}"`);
    }
  }
  assertStoryDimension(
    value["width"],
    "width",
    storyHttpLimits.minWidth,
    storyHttpLimits.maxWidth,
  );
  assertStoryDimension(
    value["height"],
    "height",
    storyHttpLimits.minHeight,
    storyHttpLimits.maxHeight,
  );
  if (
    value["colorDepth"] !== undefined &&
    ![1, 4, 8, 24].includes(value["colorDepth"] as number)
  ) {
    throw new Error("Story colorDepth must be 1, 4, 8, or 24");
  }
  assertStoryBooleanControls(value);
  assertStoryNamedControls(value);
}

function assertStoryRequestIdentities(
  value: Readonly<Record<string, unknown>>,
): void {
  for (const key of ["storyId", "variant"] as const) {
    const item = value[key];
    if (
      typeof item !== "string" ||
      item.trim().length === 0 ||
      item.length > storyHttpLimits.maxIdentifierLength
    ) {
      throw new Error(`Story ${key} is invalid`);
    }
  }
}

function assertStoryArgs(
  value: unknown,
): asserts value is Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return;
  if (!isPlainStoryObject(value)) {
    throw new Error("Story args must be an object");
  }
  assertBoundedStoryValue(value, 0, { entries: 0 });
  if (
    storyTextEncoder.encode(JSON.stringify(value)).byteLength >
    storyHttpLimits.maxArgsBytes
  ) {
    throw new Error("Story args exceed the maximum byte size");
  }
}

function assertStoryInputs(
  value: unknown,
): asserts value is readonly string[] | undefined {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length > storyHttpLimits.maxInputs ||
    value.some(
      (input) =>
        typeof input !== "string" ||
        input.length > storyHttpLimits.maxInputLength,
    )
  ) {
    throw new Error(
      `Story inputs must contain at most ${storyHttpLimits.maxInputs} strings of at most ${storyHttpLimits.maxInputLength} characters`,
    );
  }
}

export function validateStoryBridgeRequest(value: unknown): StoryBridgeRequest {
  if (!isPlainStoryObject(value)) {
    throw new Error("Story request body must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!storyRequestKeys.has(key)) {
      throw new Error(`Unknown story request field "${key}"`);
    }
  }
  assertStoryRequestIdentities(value);
  assertStoryArgs(value["args"]);
  if (value["controls"] !== undefined) {
    assertStoryControls(value["controls"]);
  }
  assertStoryInputs(value["inputs"]);
  return Object.freeze({
    storyId: value["storyId"] as string,
    variant: value["variant"] as string,
    ...(value["args"] === undefined ? {} : { args: value["args"] }),
    ...(value["controls"] === undefined ? {} : { controls: value["controls"] }),
    ...(value["inputs"] === undefined ? {} : { inputs: value["inputs"] }),
  });
}

async function readBoundedJson(
  request: Request,
  maxBodyBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBodyBytes) {
    throw new Error("Story request body exceeds the maximum byte size");
  }
  if (!request.body) throw new Error("Story request body is required");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let source = "";
  const abortRead = () => {
    void reader.cancel(signal.reason);
  };
  signal.addEventListener("abort", abortRead, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        throw new Error("Story request body exceeds the maximum byte size");
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } finally {
    signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("Story request body must be valid JSON");
  }
}

function normalizeStoryHttpOptions(options: StoryHttpHandlerOptions): {
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
} {
  const timeoutMs = options.timeoutMs ?? storyHttpLimits.defaultTimeoutMs;
  const maxBodyBytes = options.maxBodyBytes ?? storyHttpLimits.maxBodyBytes;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > storyHttpLimits.maxTimeoutMs
  ) {
    throw new TypeError(
      `Story timeout must be an integer between 1 and ${storyHttpLimits.maxTimeoutMs}`,
    );
  }
  if (
    !Number.isSafeInteger(maxBodyBytes) ||
    maxBodyBytes < 1 ||
    maxBodyBytes > storyHttpLimits.maxBodyBytes
  ) {
    throw new TypeError(
      `Story body limit must be an integer between 1 and ${storyHttpLimits.maxBodyBytes}`,
    );
  }
  return { timeoutMs, maxBodyBytes };
}

export async function handleStoryHttpRequest(
  request: Request,
  render: (
    request: StoryBridgeRequest,
    signal: AbortSignal,
  ) => Promise<StoryFrame>,
  options: Pick<StoryHttpHandlerOptions, "timeoutMs" | "maxBodyBytes"> = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Only POST is supported" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  const normalized = normalizeStoryHttpOptions(options);
  const controller = new AbortController();
  const abortFromRequest = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abortFromRequest, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Story rendering timed out", "TimeoutError"),
      ),
    normalized.timeoutMs,
  );
  try {
    request.signal.throwIfAborted();
    const body = validateStoryBridgeRequest(
      await readBoundedJson(
        request,
        normalized.maxBodyBytes,
        controller.signal,
      ),
    );
    return Response.json(
      await waitWithSignal(render(body, controller.signal), controller.signal),
    );
  } catch (error) {
    const reason = controller.signal.reason;
    const timedOut =
      reason instanceof DOMException && reason.name === "TimeoutError";
    return Response.json(
      {
        error: timedOut
          ? "Story rendering timed out"
          : error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: timedOut ? 504 : request.signal.aborted ? 499 : 400,
      },
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromRequest);
  }
}

export async function renderStoryRequest(
  catalog: TuilStoryCatalog,
  request: StoryBridgeRequest,
  options: {
    readonly themeRegistry?: ThemeRegistry;
    readonly signal?: AbortSignal;
  } = {},
): Promise<StoryFrame> {
  options.signal?.throwIfAborted();
  if ((request.inputs?.length ?? 0) > storyHttpLimits.maxInputs) {
    throw new Error(
      `Story requests support at most ${storyHttpLimits.maxInputs} simulated inputs`,
    );
  }
  if (
    request.inputs?.some(
      (input) => input.length > storyHttpLimits.maxInputLength,
    )
  ) {
    throw new Error(
      `A simulated story input cannot exceed ${storyHttpLimits.maxInputLength} characters`,
    );
  }
  const session = await TuilStorySession.open(catalog, {
    ...request,
    themeRegistry: options.themeRegistry,
    signal: options.signal,
  });
  try {
    await runSequentially(request.inputs ?? [], (input) =>
      session.press(input, options.signal),
    );
    return session.snapshot();
  } finally {
    await session.close();
  }
}

export function createStoryHttpHandler(
  catalog: TuilStoryCatalog,
  options: StoryHttpHandlerOptions = {},
): (request: Request) => Promise<Response> {
  normalizeStoryHttpOptions(options);
  return (request) =>
    handleStoryHttpRequest(
      request,
      (body, signal) =>
        renderStoryRequest(catalog, body, {
          themeRegistry: options.themeRegistry,
          signal,
        }),
      options,
    );
}

export interface StorySnapshot {
  readonly storyId: string;
  readonly variant: string;
  readonly frame: string;
  readonly ansiFrame: string;
  readonly semantics: readonly QueryableSemanticNode[];
  readonly focus: StoryFrame["focus"];
  readonly controls: TerminalStoryControls;
}

export function storyFrameToMarkdown(frame: StorySnapshot): string {
  const semantics = frame.semantics
    .map(
      (node) =>
        `- ${node.role ?? "node"}: ${node.label ?? node.text ?? node.id ?? node.key}`,
    )
    .join("\n");
  return `## ${frame.variant}

\`\`\`text
${frame.frame}
\`\`\`

### Semantics

${semantics || "- No semantic nodes"}
`;
}

export type StoryCatalogSnapshots = Readonly<
  Record<string, Readonly<Record<string, StorySnapshot>>>
>;

async function runSequentially<T>(
  values: readonly T[],
  operation: (value: T) => void | Promise<void>,
): Promise<void> {
  await values.reduce<Promise<void>>(
    (previous, value) =>
      previous.then(async () => {
        await operation(value);
      }),
    Promise.resolve(),
  );
}

function stableStorySnapshot(frame: StoryFrame): StorySnapshot {
  const generatedIds = new Map<string, string>();
  const canonicalId = (value: string | undefined): string | undefined => {
    if (!value || !/^_.*r_[0-9a-z]+_$/i.test(value)) return value;
    const existing = generatedIds.get(value);
    if (existing) return existing;
    const canonical = `generated:${generatedIds.size + 1}`;
    generatedIds.set(value, canonical);
    return canonical;
  };
  const semantics = frame.semantics.map((node) =>
    Object.freeze({
      ...node,
      key: canonicalId(node.key) ?? node.key,
      id: canonicalId(node.id),
    }),
  );
  return Object.freeze({
    storyId: frame.storyId,
    variant: frame.variant,
    frame: frame.frame,
    ansiFrame: frame.ansiFrame,
    semantics: Object.freeze(semantics),
    focus: Object.freeze({
      focusedId: canonicalId(frame.focus.focusedId),
      nodes: Object.freeze(
        frame.focus.nodes.map((node) =>
          Object.freeze({ ...node, id: canonicalId(node.id) ?? node.id }),
        ),
      ),
    }),
    controls: Object.freeze({ ...frame.controls }),
  });
}

export async function generateStoryCatalogSnapshots(
  catalog: TuilStoryCatalog,
  options: {
    readonly themeRegistry?: ThemeRegistry;
    readonly signal?: AbortSignal;
    readonly maxStories?: number;
  } = {},
): Promise<StoryCatalogSnapshots> {
  const maxStories = options.maxStories ?? 200;
  if (!Number.isSafeInteger(maxStories) || maxStories < 1) {
    throw new Error("maxStories must be a positive integer");
  }
  const snapshots: Record<string, Record<string, StorySnapshot>> = {};
  const stories: Array<{
    readonly set: TuilStorySet;
    readonly variant: string;
  }> = [];
  for (const set of catalog.list()) {
    snapshots[set.id] = {};
    for (const variant of Object.keys(set.definition.stories).sort()) {
      stories.push({ set, variant });
    }
  }
  if (stories.length > maxStories) {
    throw new Error(
      `Story catalog exceeds the configured ${maxStories} story limit`,
    );
  }
  await runSequentially(stories, async ({ set, variant }) => {
    options.signal?.throwIfAborted();
    const variants = snapshots[set.id];
    if (!variants) throw new Error(`Missing snapshot set ${set.id}`);
    variants[variant] = stableStorySnapshot(
      await renderStoryRequest(
        catalog,
        { storyId: set.id, variant },
        {
          themeRegistry: options.themeRegistry,
          signal: options.signal,
        },
      ),
    );
    snapshots[set.id] = variants;
  });
  for (const variants of Object.values(snapshots)) Object.freeze(variants);
  return Object.freeze(snapshots);
}

export async function generateStoryCatalogDocumentation(
  catalog: TuilStoryCatalog,
  options: {
    readonly themeRegistry?: ThemeRegistry;
    readonly signal?: AbortSignal;
    readonly maxStories?: number;
  } = {},
): Promise<Readonly<Record<string, string>>> {
  const snapshots = await generateStoryCatalogSnapshots(catalog, options);
  return Object.freeze(
    Object.fromEntries(
      catalog.list().map((set) => {
        const variants = snapshots[set.id];
        const body = Object.keys(variants ?? {})
          .sort()
          .map((variant) => {
            const frame = variants?.[variant];
            if (!frame)
              throw new Error(`Missing snapshot for ${set.id}/${variant}`);
            return storyFrameToMarkdown(frame);
          })
          .join("\n");
        return [set.id, `# ${set.title}\n\n${body}`];
      }),
    ),
  );
}
