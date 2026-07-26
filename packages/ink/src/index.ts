import {
  type TuilRuntime,
  TuilRuntimeProvider,
  useApp as useTuilApp,
} from "@mwillbanks/tuil";
import { FocusProvider } from "@mwillbanks/tuil-focus";
import { HotkeyProvider } from "@mwillbanks/tuil-hotkeys";
import { ThemeProvider } from "@mwillbanks/tuil-theme";
import {
  type Instance,
  type Key,
  type RenderOptions,
  render as renderInk,
  renderToString,
  useInput,
} from "ink";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SemanticProvider, type SemanticRegistry } from "./semantics.ts";

export * from "./components.tsx";
export * from "./semantics.ts";

export type TerminalInputHandler = (
  input: string,
  key: Key,
) => boolean | Promise<boolean>;

interface TerminalInputRegistration {
  readonly id: number;
  readonly priority: number;
  readonly handler: TerminalInputHandler;
}

class TerminalInputRouter {
  readonly #registrations = new Map<number, TerminalInputRegistration>();
  #nextId = 0;

  register(handler: TerminalInputHandler, priority: number): () => void {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#registrations.set(id, { id, priority, handler });
    return () => this.#registrations.delete(id);
  }

  async dispatch(input: string, key: Key): Promise<boolean> {
    const registrations = [...this.#registrations.values()].sort(
      (left, right) => right.priority - left.priority || right.id - left.id,
    );
    for (const registration of registrations) {
      if (await registration.handler(input, key)) return true;
    }
    return false;
  }
}

const TerminalInputContext = createContext<TerminalInputRouter | undefined>(
  undefined,
);

export function useTerminalInput(
  handler: TerminalInputHandler,
  options: {
    readonly enabled?: boolean;
    readonly priority?: number;
  } = {},
): void {
  const router = useContext(TerminalInputContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const enabled = options.enabled ?? true;
  const priority = options.priority ?? 0;
  useEffect(() => {
    if (!router || !enabled) return;
    return router.register(
      (input, key) => handlerRef.current(input, key),
      priority,
    );
  }, [enabled, priority, router]);
}

function InputDispatcher(props: {
  readonly router: TerminalInputRouter;
}): ReactNode {
  const app = useTuilApp();
  const queue = useRef(Promise.resolve());
  const mounted = useRef(true);
  const [dispatchError, setDispatchError] = useState<unknown>();
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
      queue.current = queue.current
        .then(async () => {
          const consumed = await props.router.dispatch(input, key);
          if (consumed) return;
          const binding = await app.hotkeys.dispatch(input, key, {
            activeScopes: () => ({
              application: true,
              "focus-scope": app.focus.activeScopeId,
            }),
            onError(error) {
              queue.current = queue.current.then(() => reportInputError(error));
            },
          });
          if (binding) return;
          if ((key.tab && key.shift) || input === "\u001b[Z") {
            app.focus.previous();
          } else if (key.tab || input === "\t") app.focus.next();
          else if (key.upArrow) app.focus.move("up");
          else if (key.downArrow) app.focus.move("down");
          else if (key.leftArrow) app.focus.move("left");
          else if (key.rightArrow) app.focus.move("right");
          else if (key.pageUp) app.focus.move("pageUp");
          else if (key.pageDown) app.focus.move("pageDown");
        })
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
  return createElement(
    TuilRuntimeProvider,
    { app: props.app },
    createElement(
      ThemeProvider,
      { theme: props.app.theme },
      createElement(
        FocusProvider,
        { manager: props.app.focus },
        createElement(
          HotkeyProvider,
          { manager: props.app.hotkeys },
          createElement(
            SemanticProvider,
            { registry: props.semanticRegistry },
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
  const [error, setError] = useState<unknown>();
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
  return renderable ? createElement(props.app.component) : null;
}

export function createRuntimeElement(
  app: TuilRuntime,
  semanticRegistry?: SemanticRegistry,
  onRendered?: () => void,
): ReactNode {
  return createElement(
    RuntimeTree,
    { app, semanticRegistry },
    createElement(ApplicationRoot, { app, onRendered }),
  );
}

export async function render(
  app: TuilRuntime,
  options: TuilRenderOptions = {},
): Promise<TuilRenderInstance> {
  let ink: Instance | undefined;
  try {
    await app.mount();
    if (app.mode !== "silent") {
      ink = renderInk(createRuntimeElement(app, options.semanticRegistry), {
        exitOnCtrlC: app.mode === "interactive",
        patchConsole: app.mode === "interactive",
        ...options,
      });
    }
    await app.ready();
  } catch (error) {
    ink?.unmount();
    try {
      await app.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Renderer startup and rollback failed",
      );
    }
    throw error;
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    ink?.unmount();
    await app.stop();
  };
  return {
    app,
    ink,
    async waitUntilExit() {
      try {
        await ink?.waitUntilExit();
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
