import type { TuilRuntime } from "@mwillbanks/tuil";
import {
  render,
  SemanticRegistry,
  type TuilRenderInstance,
} from "@mwillbanks/tuil-ink";
import { Buffer } from "buffer";
import type {
  Terminal as GhosttyTerminal,
  ITerminalOptions,
} from "ghostty-web";
import { BrowserConsole } from "./shims/console";
import processShim from "./shims/process";
import { BrowserReadableStream, BrowserWritableStream } from "./streams";

const browserGlobal = globalThis as unknown as {
  Buffer?: typeof Buffer;
  clearImmediate?: (handle: ReturnType<typeof setTimeout>) => void;
  console: { Console?: typeof BrowserConsole };
  process?: Partial<typeof processShim>;
  setImmediate?: (
    callback: (...arguments_: unknown[]) => void,
    ...arguments_: unknown[]
  ) => ReturnType<typeof setTimeout>;
};
browserGlobal.Buffer ??= Buffer;
browserGlobal.setImmediate ??= (callback, ...arguments_) =>
  setTimeout(callback, 0, ...arguments_);
browserGlobal.clearImmediate ??= (handle) => clearTimeout(handle);
browserGlobal.console.Console ??= BrowserConsole;
browserGlobal.process = {
  ...processShim,
  ...browserGlobal.process,
  stderr: browserGlobal.process?.stderr ?? processShim.stderr,
  stdin: browserGlobal.process?.stdin ?? processShim.stdin,
  stdout: browserGlobal.process?.stdout ?? processShim.stdout,
};

export type { PlaygroundDocumentV1, PlaygroundNodeV1 } from "./document";
export {
  createTuilGhosttyDocumentApp,
  createTuilGhosttyDocumentSession,
  generatePlaygroundTsx,
  playgroundComponentCatalog,
  validatePlaygroundDocument,
} from "./document";
export { createTuilGhosttyFeasibilityApp } from "./feasibility";

import { createTuilGhosttyStoryApp as createStoryApp } from "./story-runtime.jsx";

export interface TuilGhosttyStoryOptions {
  readonly storyId: string;
  readonly variant: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly controls?: Readonly<Record<string, unknown>>;
}

export function createTuilGhosttyStoryApp(
  options: TuilGhosttyStoryOptions,
): TuilRuntime {
  return createStoryApp(options);
}

export interface TuilGhosttyTerminalOptions
  extends Omit<ITerminalOptions, "ghostty"> {
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
}

export interface TuilGhosttyAccessibilityOptions {
  readonly label?: string;
  readonly instructions?: string;
  readonly semanticTreeLabel?: string;
}

export interface TuilGhosttyMountOptions {
  readonly app: TuilRuntime;
  readonly element: HTMLElement;
  readonly terminal?: TuilGhosttyTerminalOptions;
  readonly accessibility?: TuilGhosttyAccessibilityOptions;
}

export interface TuilGhosttyInstance {
  readonly app: TuilRuntime;
  readonly terminal: GhosttyTerminal;
  readonly semantics: SemanticRegistry;
  focus(): void;
  resize(): void;
  unmount(): Promise<void>;
}

type GhosttyModule = typeof import("ghostty-web");
let ghosttyModule: Promise<GhosttyModule> | undefined;

export function initializeTuilGhostty(): Promise<GhosttyModule> {
  ghosttyModule ??= import("ghostty-web").then(async (module) => {
    await module.init();
    return module;
  });
  return ghosttyModule;
}

function semanticElement(
  node: ReturnType<SemanticRegistry["nodes"]>[number],
): HTMLElement {
  if (node.role === "button") return document.createElement("button");
  if (node.role === "checkbox") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = node.checked ?? false;
    return checkbox;
  }
  if (node.role === "textbox") {
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = node.valueText ?? node.text ?? "";
    return input;
  }
  const element = document.createElement("div");
  if (node.role) element.setAttribute("role", node.role);
  return element;
}

function createSemanticCompanion(options: {
  readonly app: TuilRuntime;
  readonly terminal: GhosttyTerminal;
  readonly semantics: SemanticRegistry;
  readonly stdin: BrowserReadableStream;
  readonly host: HTMLElement;
  readonly accessibility?: TuilGhosttyAccessibilityOptions;
}): () => void {
  const label = options.accessibility?.label ?? "Interactive TUIL terminal";
  const instructions =
    options.accessibility?.instructions ??
    "Use Tab to move through terminal controls. Use Enter or Space to activate the focused control.";
  const instructionsId = `tuil-ghostty-instructions-${options.app.id}`;
  options.host.setAttribute("aria-label", label);
  options.host.setAttribute("aria-describedby", instructionsId);

  const instruction = document.createElement("p");
  instruction.id = instructionsId;
  instruction.className = "sr-only";
  instruction.textContent = instructions;

  const details = document.createElement("details");
  details.dataset["tuilSemanticCompanion"] = "true";
  const summary = document.createElement("summary");
  summary.textContent =
    options.accessibility?.semanticTreeLabel ?? "Accessible terminal controls";
  const tree = document.createElement("div");
  tree.setAttribute("aria-label", summary.textContent);
  tree.setAttribute("role", "group");
  const status = document.createElement("div");
  status.className = "sr-only";
  status.setAttribute("aria-live", "polite");
  status.setAttribute("role", "status");
  details.append(summary, tree, status);
  options.host.before(instruction);
  options.host.after(details);

  const renderTree = () => {
    tree.replaceChildren();
    for (const node of options.semantics.nodes()) {
      const element = semanticElement(node);
      const id = node.id ?? node.key;
      const labelText = node.label ?? node.text ?? id;
      element.dataset["tuilSemanticId"] = id;
      element.setAttribute("aria-label", labelText);
      if (node.description) {
        element.setAttribute("aria-description", node.description);
      }
      if (node.disabled) element.setAttribute("aria-disabled", "true");
      if (node.selected !== undefined) {
        element.setAttribute("aria-selected", String(node.selected));
      }
      if (node.expanded !== undefined) {
        element.setAttribute("aria-expanded", String(node.expanded));
      }
      if (node.valueText)
        element.setAttribute("aria-valuetext", node.valueText);
      if (!(element instanceof HTMLInputElement))
        element.textContent = labelText;
      element.addEventListener("focus", () => {
        options.app.focus.focus(id);
        status.textContent = `Focused ${labelText}.`;
      });
      element.addEventListener("click", (event) => {
        event.preventDefault();
        if (node.disabled) return;
        options.app.focus.focus(id);
        options.stdin.push(node.role === "checkbox" ? " " : "\r");
        options.terminal.focus();
        status.textContent = `Activated ${labelText}.`;
      });
      tree.append(element);
    }
  };
  renderTree();
  const stopSemantics = options.semantics.observe(renderTree);
  const stopFocus = options.app.focus.observe(() => {
    const focused = options.app.focus.focusedId;
    if (focused) status.textContent = `Terminal focus moved to ${focused}.`;
  });
  return () => {
    stopFocus();
    stopSemantics();
    details.remove();
    instruction.remove();
  };
}

export async function mountTuilGhostty(
  options: TuilGhosttyMountOptions,
): Promise<TuilGhosttyInstance> {
  const ghostty = await initializeTuilGhostty();
  const {
    maxInputBytes = 65_536,
    maxOutputBytes = 1_048_576,
    ...terminalOptions
  } = options.terminal ?? {};
  const terminal = new ghostty.Terminal(terminalOptions);
  terminal.open(options.element);
  const fitAddon = new ghostty.FitAddon();
  terminal.loadAddon(fitAddon);
  fitAddon.observeResize();
  fitAddon.fit();

  const stdin = new BrowserReadableStream(
    terminal.cols,
    terminal.rows,
    maxInputBytes,
  );
  const stdout = new BrowserWritableStream(
    terminal,
    terminal.cols,
    terminal.rows,
    maxOutputBytes,
  );
  const semantics = new SemanticRegistry(options.app.layout);
  const inputSubscription = terminal.onData((data) => stdin.push(data));
  const resizeSubscription = terminal.onResize(({ cols, rows }) => {
    stdin.columns = cols;
    stdin.rows = rows;
    stdout.resize(cols, rows);
  });
  const reportOutputError = (error: unknown) => {
    void options.app.reportError(error, "renderer:browser-output");
  };
  stdout.on("error", reportOutputError);

  let renderInstance: TuilRenderInstance | undefined;
  let removeSemanticCompanion: (() => void) | undefined;
  let disposed = false;
  try {
    renderInstance = await render(options.app, {
      semanticRegistry: semantics,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });
    removeSemanticCompanion = createSemanticCompanion({
      app: options.app,
      terminal,
      semantics,
      stdin,
      host: options.element,
      accessibility: options.accessibility,
    });
  } catch (error) {
    inputSubscription.dispose();
    resizeSubscription.dispose();
    fitAddon.dispose();
    stdout.destroy();
    stdin.destroy();
    terminal.dispose();
    throw error;
  }

  const unmount = async () => {
    if (disposed) return;
    disposed = true;
    const failures: unknown[] = [];
    try {
      removeSemanticCompanion?.();
      inputSubscription.dispose();
      resizeSubscription.dispose();
      fitAddon.dispose();
      stdout.off("error", reportOutputError);
    } catch (error) {
      failures.push(error);
    }
    try {
      await renderInstance?.unmount();
      await stdout.whenIdle();
    } catch (error) {
      failures.push(error);
    }
    try {
      stdout.destroy();
      stdin.destroy();
      terminal.dispose();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "TUIL Ghostty browser cleanup failed");
    }
  };

  return Object.freeze({
    app: options.app,
    terminal,
    semantics,
    focus: () => terminal.focus(),
    resize: () => {
      fitAddon.fit();
      stdin.columns = terminal.cols;
      stdin.rows = terminal.rows;
      stdout.resize(terminal.cols, terminal.rows);
    },
    unmount,
  });
}
