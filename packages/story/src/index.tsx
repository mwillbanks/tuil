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

export async function renderStoryRequest(
  catalog: TuilStoryCatalog,
  request: StoryBridgeRequest,
  options: {
    readonly themeRegistry?: ThemeRegistry;
    readonly signal?: AbortSignal;
  } = {},
): Promise<StoryFrame> {
  options.signal?.throwIfAborted();
  if ((request.inputs?.length ?? 0) > 100) {
    throw new Error("Story requests support at most 100 simulated inputs");
  }
  if (request.inputs?.some((input) => input.length > 1_024)) {
    throw new Error("A simulated story input cannot exceed 1024 characters");
  }
  const session = await TuilStorySession.open(catalog, {
    ...request,
    themeRegistry: options.themeRegistry,
    signal: options.signal,
  });
  try {
    for (const input of request.inputs ?? []) {
      await session.press(input, options.signal);
    }
    return session.snapshot();
  } finally {
    await session.close();
  }
}

export function createStoryHttpHandler(
  catalog: TuilStoryCatalog,
  options: { readonly themeRegistry?: ThemeRegistry } = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Only POST is supported" },
        { status: 405, headers: { Allow: "POST" } },
      );
    }
    try {
      request.signal.throwIfAborted();
      const body = (await request.json()) as StoryBridgeRequest;
      return Response.json(
        await renderStoryRequest(catalog, body, {
          ...options,
          signal: request.signal,
        }),
      );
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        {
          status:
            error instanceof DOMException && error.name === "AbortError"
              ? 499
              : 400,
        },
      );
    }
  };
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
  let rendered = 0;
  for (const set of catalog.list()) {
    options.signal?.throwIfAborted();
    const variants: Record<string, StorySnapshot> = {};
    for (const variant of Object.keys(set.definition.stories).sort()) {
      if (rendered >= maxStories) {
        throw new Error(
          `Story catalog exceeds the configured ${maxStories} story limit`,
        );
      }
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
      rendered += 1;
    }
    snapshots[set.id] = Object.freeze(variants);
  }
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
