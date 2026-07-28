import { createApp, type TuilApp, type TuilAppOptions } from "@mwillbanks/tuil";
import { createRuntimeElement, SemanticRegistry } from "@mwillbanks/tuil-ink";
import {
  normalizeTerminalFrame,
  SemanticScreen,
} from "@mwillbanks/tuil-testing";
import {
  cleanup as cleanupInk,
  render as renderInk,
} from "ink-testing-library";
import type { ReactElement } from "react";

export { normalizeTerminalFrame, SemanticScreen };

export interface TuilTestInstance {
  readonly app: TuilApp;
  readonly ready: Promise<void>;
  readonly screen: SemanticScreen;
  readonly user: TuilUser;
  readonly frames: readonly string[];
  rerender(component: ReactElement): void;
  resize(width: number, height?: number): void;
  cleanup(): Promise<void>;
}

function measuredPointerCoordinates(
  instance: TuilTestInstance,
  id: string,
): { readonly column: number; readonly row: number } {
  const bounds = instance.app.layout.get(id)?.bounds;
  if (!bounds || bounds.width < 1 || bounds.height < 1) {
    throw new Error(`Pointer target "${id}" has no measured bounds`);
  }
  return { column: bounds.x + 1, row: bounds.y + 1 };
}

export async function clickPointerTarget(
  instance: TuilTestInstance,
  id: string,
): Promise<void> {
  const { column, row } = measuredPointerCoordinates(instance, id);
  await instance.user.press(`\u001b[<0;${column};${row}M`);
  await instance.user.press(`\u001b[<0;${column};${row}m`);
}

export async function dragPointerTarget(
  instance: TuilTestInstance,
  id: string,
  delta: { readonly x?: number; readonly y?: number },
): Promise<void> {
  const { column, row } = measuredPointerCoordinates(instance, id);
  const targetColumn = column + (delta.x ?? 0);
  const targetRow = row + (delta.y ?? 0);
  await instance.user.press(`\u001b[<0;${column};${row}M`);
  await instance.user.press(`\u001b[<32;${targetColumn};${targetRow}M`);
  await instance.user.press(`\u001b[<0;${targetColumn};${targetRow}m`);
}

const keySequences: Record<string, string> = {
  arrowUp: "\u001b[A",
  arrowDown: "\u001b[B",
  arrowRight: "\u001b[C",
  arrowLeft: "\u001b[D",
  pageUp: "\u001b[5~",
  pageDown: "\u001b[6~",
  home: "\u001b[H",
  end: "\u001b[F",
  enter: "\r",
  escape: "\u001b",
  tab: "\t",
  "shift+tab": "\u001b[Z",
  space: " ",
  backspace: "\u007f",
};

export class TuilUser {
  constructor(
    readonly write: (input: string) => void,
    readonly ready: Promise<void>,
  ) {}

  async press(keys: string): Promise<void> {
    await this.ready;
    this.write(keySequences[keys] ?? keys);
    await Bun.sleep(50);
  }

  async type(value: string): Promise<void> {
    await this.ready;
    for (const character of value) {
      this.write(character);
      await Bun.sleep(0);
    }
    await Bun.sleep(50);
  }
}

let activeScreen: SemanticScreen | undefined;
let activeUser: TuilUser | undefined;
const activeInstances = new Set<TuilTestInstance>();

export const screen = {
  frame: () => {
    if (!activeScreen) throw new Error("No active tuil render");
    return activeScreen.frame();
  },
  getByRole: (...args: Parameters<SemanticScreen["getByRole"]>) => {
    if (!activeScreen) throw new Error("No active tuil render");
    return activeScreen.getByRole(...args);
  },
  getAllByRole: (...args: Parameters<SemanticScreen["getAllByRole"]>) => {
    if (!activeScreen) throw new Error("No active tuil render");
    return activeScreen.getAllByRole(...args);
  },
  getByLabelText: (...args: Parameters<SemanticScreen["getByLabelText"]>) => {
    if (!activeScreen) throw new Error("No active tuil render");
    return activeScreen.getByLabelText(...args);
  },
  getByText: (...args: Parameters<SemanticScreen["getByText"]>) => {
    if (!activeScreen) throw new Error("No active tuil render");
    return activeScreen.getByText(...args);
  },
  getByTestId: (...args: Parameters<SemanticScreen["getByTestId"]>) => {
    if (!activeScreen) throw new Error("No active tuil render");
    return activeScreen.getByTestId(...args);
  },
};

export const user = {
  press: async (keys: string) => {
    if (!activeUser) throw new Error("No active tuil render");
    await activeUser.press(keys);
  },
  type: async (value: string) => {
    if (!activeUser) throw new Error("No active tuil render");
    await activeUser.type(value);
  },
};

async function waitForInitialFrame(instance: {
  readonly frames: readonly string[];
}): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (instance.frames.length > 0) return;
    await Bun.sleep(0);
  }
  throw new Error("Initial Ink frame did not flush");
}

export function renderTuil(
  component: ReactElement,
  options: Omit<TuilAppOptions, "component"> = {},
): TuilTestInstance {
  let current = component;
  const componentType = () => current;
  const app = createApp({
    ...options,
    component: componentType,
    terminal: {
      ...options.terminal,
      mode: options.terminal?.mode ?? "interactive",
      capabilities: {
        width: 80,
        height: 24,
        interactive: true,
        tty: true,
        ...options.terminal?.capabilities,
      },
    },
  });
  const registry = new SemanticRegistry(app.layout);
  const runtimeReady = app.ready();
  let markRendered: (() => void) | undefined;
  const rendered = new Promise<void>((resolve) => {
    markRendered = resolve;
  });
  const instance = renderInk(
    createRuntimeElement(app, registry, markRendered) as ReactElement,
  );
  Object.defineProperty(instance.stdout, "columns", {
    configurable: true,
    value: app.capabilities.width,
  });
  instance.stdout.emit("resize", {
    width: app.capabilities.width,
    height: app.capabilities.height,
  });
  const ready = Promise.all([runtimeReady, rendered]).then(() =>
    waitForInitialFrame(instance),
  );
  let readyFailure: unknown;
  void ready.catch((error: unknown) => {
    readyFailure = error;
  });
  const semanticScreen = new SemanticScreen(() => ({
    nodes: registry.nodes(),
    frame: normalizeTerminalFrame(instance.lastFrame() ?? ""),
  }));
  const tuilUser = new TuilUser((input) => instance.stdin.write(input), ready);
  activeScreen = semanticScreen;
  activeUser = tuilUser;
  const result: TuilTestInstance = {
    app,
    ready,
    screen: semanticScreen,
    user: tuilUser,
    frames: instance.frames,
    rerender(component: ReactElement) {
      current = component;
      instance.rerender(createRuntimeElement(app, registry) as ReactElement);
    },
    resize(width: number, height = 24) {
      Object.defineProperty(instance.stdout, "columns", {
        configurable: true,
        value: width,
      });
      Object.defineProperty(instance.stdout, "rows", {
        configurable: true,
        value: height,
      });
      instance.stdout.emit("resize", { width, height });
    },
    async cleanup() {
      try {
        instance.cleanup();
      } finally {
        await app.stop();
      }
      activeInstances.delete(result);
      if (activeScreen === semanticScreen) {
        activeScreen = undefined;
        activeUser = undefined;
      }
      if (readyFailure) throw readyFailure;
    },
  };
  activeInstances.add(result);
  return result;
}

export async function cleanup(): Promise<void> {
  const instances = [...activeInstances];
  const results = await Promise.allSettled(
    instances.map((instance) => instance.cleanup()),
  );
  activeScreen = undefined;
  activeUser = undefined;
  cleanupInk();
  const failures = results
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to clean up tuil test renders");
  }
}
