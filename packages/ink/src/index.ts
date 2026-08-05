import { EventEmitter } from "node:events";
import {
  type TuilRuntime,
  TuilRuntimeProvider,
  useApp as useTuilApp,
} from "@mwillbanks/tuil";
import { terminalTextWidth } from "@mwillbanks/tuil-core";
import { FocusProvider } from "@mwillbanks/tuil-focus";
import { HotkeyProvider } from "@mwillbanks/tuil-hotkeys";
import { pointerTracking, SgrPointerDecoder } from "@mwillbanks/tuil-pointer";
import {
  defineRendererApplication,
  FrameScheduler,
  type RendererApplication,
  RendererApplicationDriver,
  type RendererBackend,
  type RendererFrame,
  type RendererOutput,
  type RendererScene,
  TerminalOutputSession,
  terminalInputModes,
} from "@mwillbanks/tuil-renderer";
import { ThemeProvider } from "@mwillbanks/tuil-theme";
import chalk from "chalk";
import {
  type Instance,
  type Key,
  type RenderOptions,
  render as renderInk,
  renderToString,
  useInput,
} from "ink";
import {
  type ComponentType,
  createElement,
  Profiler,
  type ReactNode,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  isTerminalControlSequence,
  TerminalInputContext,
  TerminalInputRouter,
} from "./input.ts";
import { OverlayProvider, useOverlayStatus } from "./overlay.tsx";
import { parseInkRendererScene } from "./renderer-scene.ts";
import { SemanticProvider, SemanticRegistry } from "./semantics.ts";
import { VirtualTerminalScreen } from "./vt-screen.ts";

export * from "./components.tsx";
export * from "./image.tsx";
export type { TerminalInputHandler } from "./input.ts";
export {
  isTerminalControlSequence,
  TerminalInputLayer,
  useTerminalInput,
} from "./input.ts";
export * from "./overlay.tsx";
export * from "./pointer.ts";
export * from "./renderer-backend.ts";
export * from "./scroll.ts";
export * from "./semantics.ts";
export * from "./terminal-text.ts";

interface InputOverlayState {
  readonly active: boolean;
  getTopId(): string | undefined;
}

function moveFocus(app: TuilRuntime, input: string, key: Key): void {
  if ((key.tab && key.shift) || input === "\u001b[Z") {
    app.focus.previous();
    return;
  }
  if (key.tab || input === "\t") {
    app.focus.next();
    return;
  }
  const movement = (
    [
      [key.upArrow, "up"],
      [key.downArrow, "down"],
      [key.leftArrow, "left"],
      [key.rightArrow, "right"],
      [key.pageUp, "pageUp"],
      [key.pageDown, "pageDown"],
    ] as const
  ).find(([pressed]) => pressed)?.[1];
  if (movement) app.focus.move(movement);
}

function normalizeInkPointerInput(input: string): string {
  const complete = /^\[<\d+;\d+;\d+[Mm]/u.test(input);
  const partial = /^\[<[0-9;]*$/u.test(input);
  return complete || partial ? `\u001b${input}` : input;
}

function dispatchPointers(
  app: TuilRuntime,
  decoder: SgrPointerDecoder,
  input: string,
) {
  const decoded = decoder.push(normalizeInkPointerInput(input));
  for (const pointer of decoded.events) app.pointer.dispatch(pointer);
  return decoded;
}

async function dispatchTerminalInput(options: {
  readonly app: TuilRuntime;
  readonly input: string;
  readonly key: Key;
  readonly overlay: InputOverlayState;
  readonly pointerDecoder: SgrPointerDecoder;
  readonly router: TerminalInputRouter;
  readonly onHotkeyError: (error: unknown) => void;
}): Promise<void> {
  const decoded = dispatchPointers(
    options.app,
    options.pointerDecoder,
    options.input,
  );
  if (decoded.events.length > 0 && !decoded.passthrough) return;
  if (isTerminalControlSequence(decoded.passthrough)) return;
  const consumed = await options.router.dispatch(
    decoded.passthrough,
    options.key,
    options.overlay.getTopId(),
  );
  if (consumed) return;
  const binding = await options.app.hotkeys.dispatch(
    decoded.passthrough,
    options.key,
    {
      activeScopes: () => ({
        ...(!options.overlay.active ? { application: true as const } : {}),
        "focus-scope": options.app.focus.activeScopeId,
        overlay: options.overlay.getTopId(),
      }),
      allowApplication: !options.overlay.active,
      onError: options.onHotkeyError,
    },
  );
  if (!binding) moveFocus(options.app, decoded.passthrough, options.key);
}

function InputDispatcher(props: {
  readonly router: TerminalInputRouter;
}): ReactNode {
  const app = useTuilApp();
  const overlay = useOverlayStatus();
  const queue = useRef<Promise<void> | null>(null);
  queue.current ??= Promise.resolve();
  const pointerDecoder = useRef<SgrPointerDecoder | null>(null);
  if (pointerDecoder.current === null) {
    pointerDecoder.current = new SgrPointerDecoder();
  }
  const decoder = pointerDecoder.current;
  const mounted = useRef(true);
  const [dispatchError, setDispatchError] = useReducer(
    (_current: unknown, error: unknown) => error,
    undefined,
  );
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const reportInputError = async (error: unknown) => {
    try {
      await app.reportError(error, "terminal-input");
    } catch (reportError) {
      if (mounted.current) {
        setDispatchError(
          new AggregateError(
            [error, reportError],
            "Terminal input and error reporting failed",
          ),
        );
      }
    }
  };
  useInput(
    (input, key) => {
      queue.current = (queue.current ?? Promise.resolve())
        .then(() =>
          dispatchTerminalInput({
            app,
            input,
            key,
            overlay,
            pointerDecoder: decoder,
            router: props.router,
            onHotkeyError(error) {
              queue.current = (queue.current ?? Promise.resolve()).then(() =>
                reportInputError(error),
              );
            },
          }),
        )
        .catch(reportInputError);
    },
    { isActive: app.mode === "interactive" },
  );
  if (dispatchError) throw dispatchError;
  return null;
}

export interface TuilRenderOptions extends RenderOptions {
  readonly semanticRegistry?: SemanticRegistry;
}

export interface TuilRenderInstance {
  readonly ink?: Instance;
  readonly app: TuilRuntime;
  waitUntilExit(): Promise<void>;
  unmount(): Promise<void>;
}

function RuntimeTree(props: {
  readonly app: TuilRuntime;
  readonly semanticRegistry?: SemanticRegistry;
  readonly children?: ReactNode;
}): ReactNode {
  const inputRouter = useMemo(() => new TerminalInputRouter(), []);
  const semanticRegistry = useMemo(
    () => props.semanticRegistry ?? new SemanticRegistry(props.app.layout),
    [props.app.layout, props.semanticRegistry],
  );
  return createElement(
    TuilRuntimeProvider,
    { app: props.app },
    createElement(
      ThemeProvider,
      { theme: props.app.themeController },
      createElement(
        FocusProvider,
        { manager: props.app.focus },
        createElement(
          HotkeyProvider,
          { manager: props.app.hotkeys },
          createElement(
            SemanticProvider,
            { registry: semanticRegistry },
            createElement(
              OverlayProvider,
              null,
              createElement(
                TerminalInputContext.Provider,
                { value: inputRouter },
                props.app.mode === "interactive"
                  ? createElement(InputDispatcher, { router: inputRouter })
                  : null,
                props.children,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function ApplicationRoot(props: {
  readonly app: TuilRuntime;
  readonly onRendered?: () => void;
}): ReactNode {
  const initiallyRenderable =
    props.app.lifecycle.state === "mounting" ||
    props.app.lifecycle.state === "ready";
  const [renderable, setRenderable] = useState(initiallyRenderable);
  const [error, setError] = useReducer(
    (_current: unknown, reason: unknown) => reason,
    undefined,
  );
  useEffect(() => {
    if (renderable) return;
    let active = true;
    void props.app.ready().then(
      () => {
        if (active) setRenderable(true);
      },
      (reason) => {
        if (active) setError(reason);
      },
    );
    return () => {
      active = false;
    };
  }, [props.app, renderable]);
  useEffect(() => {
    if (renderable) props.onRendered?.();
  }, [props.onRendered, renderable]);
  if (error) throw error;
  return renderable && !props.app.rendererApplication
    ? createElement(props.app.component as ComponentType)
    : null;
}

export function createRuntimeElement(
  app: TuilRuntime,
  semanticRegistry?: SemanticRegistry,
  onRendered?: () => void,
  onProfiled?: (durationMs: number) => void,
): ReactNode {
  const tree = createElement(
    RuntimeTree,
    { app, semanticRegistry },
    createElement(ApplicationRoot, { app, onRendered }),
  );
  return onProfiled
    ? createElement(
        Profiler,
        {
          id: "tuil-runtime",
          onRender: (_id, _phase, duration) => {
            onProfiled(duration);
          },
        },
        tree,
      )
    : tree;
}

interface ActiveRenderer {
  readonly ink?: Instance;
  waitUntilExit(): Promise<void>;
  stop(): Promise<void>;
}

class InkFrameCapture extends EventEmitter {
  readonly #terminal: NodeJS.WriteStream;
  #frame = "";
  #onFrame?: () => void;

  constructor(terminal: NodeJS.WriteStream) {
    super();
    this.#terminal = terminal;
  }

  get columns(): number {
    return this.#terminal.columns ?? 80;
  }

  get rows(): number {
    return this.#terminal.rows ?? 24;
  }

  get isTTY(): boolean {
    return true;
  }

  getColorDepth(): number {
    return 24;
  }

  hasColors(count = 16): boolean {
    return count <= 16_777_216;
  }

  write = (frame: string | Uint8Array): boolean => {
    this.#frame =
      typeof frame === "string" ? frame : new TextDecoder().decode(frame);
    this.#onFrame?.();
    return true;
  };

  frame(): string {
    return this.#frame;
  }

  onFrame(observer: () => void): void {
    this.#onFrame = observer;
  }
}

function outputSessionMode(app: TuilRuntime) {
  return app.outputOwnership;
}

interface CapturedBackendApplication {
  readonly capture?: InkFrameCapture;
  readonly ink?: Instance;
  readonly application: RendererApplication;
  readonly restoreColor?: () => void;
}

let activeColorLeases = 0;
let colorLevelBeforeCapture = chalk.level;

function acquireColorLease(): () => void {
  if (activeColorLeases === 0) {
    colorLevelBeforeCapture = chalk.level;
    chalk.level = 3;
  }
  activeColorLeases += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeColorLeases -= 1;
    if (activeColorLeases === 0) chalk.level = colorLevelBeforeCapture;
  };
}

function createCapturedBackendApplication(
  app: TuilRuntime,
  output: NodeJS.WriteStream,
  input: NodeJS.ReadStream,
): CapturedBackendApplication {
  if (app.rendererApplication) return { application: app.rendererApplication };
  if (!app.renderer?.capabilities.has("react-ink-components")) {
    throw new TypeError(
      `Renderer "${app.renderer?.id ?? "unknown"}" requires a RendererApplication; React/Ink component trees are supported only by Ink renderers`,
    );
  }
  const semanticRegistry = new SemanticRegistry(app.layout);
  const capture = new InkFrameCapture(output);
  const restoreColor = acquireColorLease();
  try {
    const ink = renderInk(createRuntimeElement(app, semanticRegistry), {
      stdout: capture as unknown as NodeJS.WriteStream,
      stderr: capture as unknown as NodeJS.WriteStream,
      stdin: input,
      debug: true,
      exitOnCtrlC: false,
      interactive: app.mode === "interactive",
      patchConsole: false,
    });
    return {
      capture,
      ink,
      restoreColor,
      application: defineRendererApplication({
        async project() {
          await ink.waitUntilRenderFlush();
          return parseInkRendererScene(
            capture.frame(),
            semanticRegistry.nodes(),
          );
        },
      }),
    };
  } catch (error) {
    restoreColor();
    throw error;
  }
}

function createBackendOutputSession(
  app: TuilRuntime,
  output: NodeJS.WriteStream,
): TerminalOutputSession {
  return new TerminalOutputSession(
    {
      write: (data) => output.write(data),
      drain: () =>
        new Promise<void>((resolve) => output.once("drain", resolve)),
    },
    outputSessionMode(app),
    { rows: output.rows ?? app.capabilities.height },
  );
}

class RendererFailureChannel {
  readonly #app: TuilRuntime;
  readonly #waiters = new Set<(error: unknown) => void>();
  #failed = false;
  failure?: unknown;

  constructor(app: TuilRuntime) {
    this.#app = app;
  }

  report = async (error: unknown): Promise<void> => {
    this.#failed = true;
    this.failure = error;
    for (const resolve of this.#waiters) resolve(error);
    this.#waiters.clear();
    try {
      await this.#app.reportError(error, "renderer:frame");
    } catch {
      // The original renderer failure remains the lifecycle failure.
    }
  };

  async waitUntilExit(): Promise<void> {
    if (this.#failed) throw this.failure;
    if (this.#app.mode !== "interactive") return;
    const result = await new Promise<unknown>((resolve) => {
      const onInterrupt = () => resolve(undefined);
      process.once("SIGINT", onInterrupt);
      this.#waiters.add((error) => {
        process.off("SIGINT", onInterrupt);
        resolve(error);
      });
    });
    if (this.#failed) throw result;
  }

  throwIfFailed(): void {
    if (this.#failed) throw this.failure;
  }
}

function createBackendDriver(options: {
  readonly app: TuilRuntime;
  readonly backend: RendererBackend;
  readonly output: NodeJS.WriteStream;
  readonly application: RendererApplication;
  readonly session: TerminalOutputSession;
}): RendererApplicationDriver {
  return new RendererApplicationDriver({
    application: options.application,
    backend: options.backend as RendererBackend<RendererScene>,
    session: options.session,
    paused: () => options.app.renderTelemetry.snapshot().paused,
    context: (signal) => ({
      capabilities: Object.freeze({
        ...options.app.capabilities,
        width: options.output.columns ?? options.app.capabilities.width,
        height: options.session.viewportHeight,
      }),
      mode: options.app.mode,
      layout: options.app.layout,
      signal,
    }),
    onFrame: (frame) => {
      options.app.renderTelemetry.record(frame);
    },
  });
}

async function cleanupFailedBackendStart(
  error: unknown,
  driver: RendererApplicationDriver,
  captured: CapturedBackendApplication,
): Promise<never> {
  const failures: unknown[] = [error];
  await captureCleanupFailure(failures, () => driver.dispose());
  await captureCleanupFailure(failures, () => captured.ink?.unmount());
  await captureCleanupFailure(failures, () => captured.restoreColor?.());
  throw failures.length === 1
    ? error
    : new AggregateError(failures, "Renderer startup cleanup failed");
}

function createBackendLifecycle(options: {
  readonly app: TuilRuntime;
  readonly backend: RendererBackend;
  readonly output: NodeJS.WriteStream;
  readonly input: NodeJS.ReadStream;
  readonly captured: CapturedBackendApplication;
  readonly driver: RendererApplicationDriver;
  readonly scheduler: FrameScheduler;
  readonly failures: RendererFailureChannel;
}): ActiveRenderer {
  const { app, captured, input, output, scheduler } = options;
  const unsubscribe = app.subscribeRender(() => scheduler.request());
  const invokeApplication = (
    operation: (() => void | Promise<void>) | undefined,
  ) => {
    if (!operation) return;
    void Promise.resolve()
      .then(operation)
      .then(() => app.invalidate(), options.failures.report);
  };
  const onInput = (data: Buffer | string) => {
    invokeApplication(() => options.driver.input(data.toString()));
  };
  const onResize = () => {
    captured.capture?.emit("resize");
    invokeApplication(() =>
      options.driver.resize(
        output.columns ?? app.capabilities.width,
        output.rows ?? app.capabilities.height,
      ),
    );
  };
  if (app.mode === "interactive" && !captured.ink) input.on("data", onInput);
  output.on("resize", onResize);
  return {
    waitUntilExit: () => options.failures.waitUntilExit(),
    async stop() {
      unsubscribe();
      scheduler.cancel(new Error("Renderer stopped"));
      if (!captured.ink) input.off("data", onInput);
      output.off("resize", onResize);
      const failures: unknown[] = [];
      const waitForIdle = async () => {
        while (!scheduler.statistics().idle) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      };
      await captureCleanupFailure(failures, waitForIdle);
      await captureCleanupFailure(failures, () => options.driver.dispose());
      await captureCleanupFailure(failures, () => captured.ink?.unmount());
      await captureCleanupFailure(failures, () => captured.restoreColor?.());
      if (failures.length > 0)
        throw new AggregateError(failures, "Renderer cleanup failed");
      options.failures.throwIfFailed();
    },
  };
}

async function createBackendRenderer(
  app: TuilRuntime,
  backend: RendererBackend,
  output: NodeJS.WriteStream,
  input: NodeJS.ReadStream,
): Promise<ActiveRenderer> {
  const captured = createCapturedBackendApplication(app, output, input);
  const session = createBackendOutputSession(app, output);
  const failures = new RendererFailureChannel(app);
  const driver = createBackendDriver({
    app,
    backend,
    output,
    application: captured.application,
    session,
  });
  const scheduler = new FrameScheduler(driver.draw, {
    onError: failures.report,
  });
  captured.capture?.onFrame(() => scheduler.request());
  try {
    await driver.draw(new AbortController().signal);
  } catch (error) {
    return cleanupFailedBackendStart(error, driver, captured);
  }
  return createBackendLifecycle({
    app,
    backend,
    output,
    input,
    captured,
    driver,
    scheduler,
    failures,
  });
}

function observeInkOutput(
  output: NodeJS.WriteStream,
  observer: (bytes: Uint8Array) => void,
): NodeJS.WriteStream {
  return new Proxy(output, {
    get(target, property) {
      if (property === "write") {
        return (chunk: string | Uint8Array, ...args: unknown[]) => {
          const bytes =
            typeof chunk === "string"
              ? new TextEncoder().encode(chunk)
              : chunk.slice();
          observer(bytes);
          return Reflect.apply(target.write, target, [
            chunk,
            ...args,
          ] as Parameters<NodeJS.WriteStream["write"]>);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

function inkOutputMetrics(
  bytes: Uint8Array,
  previous: string,
  current: string,
  viewport: { readonly width: number; readonly height: number },
): RendererOutput {
  const before = previous.split("\n");
  const after = current.split("\n");
  const lineCount = Math.max(before.length, after.length);
  const changedRows = Object.freeze(
    Array.from({ length: lineCount }, (_, index) => index).filter(
      (index) =>
        before[index] !== after[index] &&
        ((before[index]?.length ?? 0) > 0 || (after[index]?.length ?? 0) > 0),
    ),
  );
  const changedCells = changedRows.reduce(
    (total, row) =>
      total +
      Math.max(
        terminalTextWidth(before[row] ?? ""),
        terminalTextWidth(after[row] ?? ""),
      ),
    0,
  );
  const dirtyRects = Object.freeze(
    changedRows.map((row) =>
      Object.freeze({
        x: 0,
        y: Math.min(row, Math.max(0, viewport.height - 1)),
        width: Math.min(
          viewport.width,
          Math.max(
            terminalTextWidth(before[row] ?? ""),
            terminalTextWidth(after[row] ?? ""),
          ),
        ),
        height: 1,
      }),
    ),
  );
  return Object.freeze({
    bytes: bytes.slice(),
    changedCells,
    changedRows,
    dirtyRects,
  });
}

async function createInkRenderer(
  app: TuilRuntime,
  options: TuilRenderOptions,
): Promise<ActiveRenderer> {
  const semanticRegistry =
    options.semanticRegistry ?? new SemanticRegistry(app.layout);
  let sequence = 0;
  let durationMs = 0;
  let presentedFrame = "";
  let pendingOutput: Uint8Array[] = [];
  let telemetryTimer: ReturnType<typeof setTimeout> | undefined;
  const outputDecoder = new TextDecoder();
  const onRendered = (renderDurationMs: number) => {
    durationMs = renderDurationMs;
  };
  const output = options.stdout ?? process.stdout;
  const terminalScreen = new VirtualTerminalScreen(
    output.columns ?? app.capabilities.width,
    output.rows ?? app.capabilities.height,
  );
  const flushTelemetry = () => {
    telemetryTimer = undefined;
    const bytes = concatenateBytes(pendingOutput);
    pendingOutput = [];
    const timestamp = performance.now();
    const raw = outputDecoder.decode(bytes, { stream: true });
    const previousFrame = presentedFrame;
    terminalScreen.resize(
      output.columns ?? app.capabilities.width,
      output.rows ?? app.capabilities.height,
    );
    terminalScreen.write(raw);
    presentedFrame = terminalScreen.snapshot();
    const metrics = inkOutputMetrics(bytes, previousFrame, presentedFrame, {
      width: output.columns ?? app.capabilities.width,
      height: output.rows ?? app.capabilities.height,
    });
    const frame: RendererFrame = Object.freeze({
      width: output.columns ?? app.capabilities.width,
      height: output.rows ?? app.capabilities.height,
      sequence: ++sequence,
      timestamp,
      payload: Object.freeze({
        frame: presentedFrame,
        semantics: semanticRegistry.nodes(),
      }),
    });
    app.renderTelemetry.record({
      renderer: "ink",
      durationMs,
      frame,
      output: metrics,
      timestamp,
    });
  };
  const telemetryOutput = observeInkOutput(output, (bytes) => {
    pendingOutput.push(bytes);
    if (!telemetryTimer) telemetryTimer = setTimeout(flushTelemetry, 0);
  });
  const ink = renderInk(
    createRuntimeElement(app, semanticRegistry, undefined, onRendered),
    {
      ...options,
      exitOnCtrlC: app.mode === "interactive",
      interactive: app.mode === "interactive",
      patchConsole: app.mode === "interactive",
      stdout: telemetryOutput,
    },
  );
  await ink.waitUntilRenderFlush();
  return {
    ink,
    async waitUntilExit() {
      await ink.waitUntilExit();
    },
    async stop() {
      ink.unmount();
      if (telemetryTimer) {
        clearTimeout(telemetryTimer);
        flushTelemetry();
      }
    },
  };
}

function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function createActiveRenderer(
  app: TuilRuntime,
  options: TuilRenderOptions,
  output: NodeJS.WriteStream,
): Promise<ActiveRenderer> {
  if (app.renderer) {
    return createBackendRenderer(
      app,
      app.renderer,
      output,
      options.stdin ?? process.stdin,
    );
  }
  if (app.mode !== "silent") return createInkRenderer(app, options);
  return { async waitUntilExit() {}, async stop() {} };
}

function restoreTerminalInput(
  output: NodeJS.WriteStream,
  pointerEnabled: boolean,
  inputModes: string,
): void {
  if (pointerEnabled) output.write(pointerTracking(false));
  if (inputModes) output.write(inputModes);
}

async function captureCleanupFailure(
  failures: unknown[],
  cleanup: () => void | Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    failures.push(error);
  }
}

async function rollbackRenderer(
  app: TuilRuntime,
  active: ActiveRenderer | undefined,
  output: NodeJS.WriteStream,
  pointerEnabled: boolean,
  inputModes: string,
  error: unknown,
): Promise<never> {
  restoreTerminalInput(output, pointerEnabled, inputModes);
  const failures: unknown[] = [error];
  await captureCleanupFailure(failures, () => active?.stop());
  await captureCleanupFailure(failures, () => app.stop());
  throw failures.length === 1
    ? error
    : new AggregateError(failures, "Renderer startup and rollback failed");
}

export async function render(
  app: TuilRuntime,
  options: TuilRenderOptions = {},
): Promise<TuilRenderInstance> {
  const pointerEnabled = app.mode === "interactive" && app.capabilities.mouse;
  const inputModes =
    app.mode === "interactive"
      ? terminalInputModes(app.capabilities, true)
      : "";
  const output = options.stdout ?? process.stdout;
  let active: ActiveRenderer | undefined;
  try {
    await app.mount();
    if (inputModes) output.write(inputModes);
    if (pointerEnabled) output.write(pointerTracking(true));
    active = await createActiveRenderer(app, options, output);
    await app.ready();
  } catch (error) {
    return rollbackRenderer(
      app,
      active,
      output,
      pointerEnabled,
      inputModes ? terminalInputModes(app.capabilities, false) : "",
      error,
    );
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const failures: unknown[] = [];
    await captureCleanupFailure(failures, () => active?.stop());
    restoreTerminalInput(
      output,
      pointerEnabled,
      inputModes ? terminalInputModes(app.capabilities, false) : "",
    );
    await captureCleanupFailure(failures, () => app.stop());
    if (failures.length > 0) {
      throw new AggregateError(failures, "Renderer cleanup failed");
    }
  };
  return {
    app,
    ink: active?.ink,
    async waitUntilExit() {
      try {
        await active?.waitUntilExit();
      } finally {
        await stop();
      }
    },
    async unmount() {
      await stop();
    },
  };
}

export async function renderStatic(
  app: TuilRuntime,
  options: { readonly columns?: number } = {},
): Promise<string> {
  let frame: string | undefined;
  let renderError: unknown;
  try {
    await app.mount();
    frame = renderToString(createRuntimeElement(app) as React.ReactElement, {
      columns: options.columns ?? app.capabilities.width,
    });
    await app.ready();
  } catch (error) {
    renderError = error;
  }
  try {
    await app.stop();
  } catch (cleanupError) {
    if (renderError) {
      throw new AggregateError(
        [renderError, cleanupError],
        "Static rendering and cleanup failed",
      );
    }
    throw cleanupError;
  }
  if (renderError) throw renderError;
  return frame ?? "";
}
