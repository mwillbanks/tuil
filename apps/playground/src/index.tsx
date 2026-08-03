import { createApp, type TuilApp, useApp } from "@mwillbanks/tuil";
import { TuilDevtools } from "@mwillbanks/tuil-devtools";
import {
  Box,
  Button,
  createRuntimeElement,
  Heading,
  render,
  SemanticRegistry,
  Text,
  type TuilRenderInstance,
  usePointerEvents,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import type { TuilStorySet } from "@mwillbanks/tuil-story";
import {
  defaultTerminalStoryControls,
  type TerminalStoryControls,
} from "@mwillbanks/tuil-testing";
import { createDefaultThemeRegistry } from "@mwillbanks/tuil-theme";
import {
  type ComponentType,
  createElement,
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

const installTargets: Readonly<Record<string, string>> = Object.freeze({
  foundation: "button badge progress",
  forms: "field text-input checkbox select",
  navigation: "tabs",
  data: "table tree log-viewer",
  "init-wizard": "init-wizard",
});

interface PortableStoryPreviewProps {
  readonly storyId: string;
  readonly variant: string;
  readonly component: ComponentType<Record<string, unknown>>;
  readonly args: Readonly<Record<string, unknown>>;
  readonly controls: TerminalStoryControls;
}

function StoryRuntimeSurface(
  props: Omit<PortableStoryPreviewProps, "storyId" | "variant">,
): ReactNode {
  const runtime = useApp();
  const events = useSyncExternalStore(
    (notify) => runtime.events.observe(notify),
    () =>
      runtime.events
        .history()
        .slice(-8)
        .map((event) => `${event.type} [${event.priority}]`)
        .join(", "),
    () => "",
  );
  const focused = useSyncExternalStore(
    (notify) => runtime.focus.observe(notify),
    () => runtime.focus.focusedId ?? "none",
    () => "none",
  );
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(props.component, props.args),
    createElement(
      Text,
      { label: "Terminal controls" },
      `Terminal: ${props.controls.width}×${props.controls.height} · theme ${props.controls.theme} · ${props.controls.interactive ? "interactive" : "static"} · ${props.controls.unicode ? "unicode" : "ascii"}`,
    ),
    createElement(
      Text,
      { label: "Focus inspector" },
      `Focus inspector: ${focused}`,
    ),
    createElement(
      Text,
      { label: "Event inspector" },
      `Event inspector: ${events || "waiting for runtime events"}`,
    ),
  );
}

function PortableStoryPreview(props: PortableStoryPreviewProps): ReactNode {
  const themes = useMemo(() => createDefaultThemeRegistry(), []);
  const registry = useMemo(
    () => new SemanticRegistry(),
    [props.controls, props.storyId, props.variant],
  );
  const previewApp = useMemo(
    () =>
      createApp({
        id: `tuil-playground-preview:${props.storyId}:${props.variant}`,
        component: () =>
          createElement(StoryRuntimeSurface, {
            component: props.component,
            args: props.args,
            controls: props.controls,
          }),
        theme: themes.resolve(props.controls.theme),
        terminal: {
          mode: props.controls.interactive ? "interactive" : "static",
          capabilities: {
            width: props.controls.width,
            height: props.controls.height,
            colorDepth: props.controls.colorDepth,
            unicode: props.controls.unicode,
            hyperlinks: props.controls.hyperlinks,
            interactive: props.controls.interactive,
            tty: props.controls.interactive,
            alternateScreen: props.controls.interactive,
            mouse: props.controls.mouse,
            images: false,
            reducedMotion: props.controls.reducedMotion,
            platform: props.controls.platform,
          },
        },
      }),
    [
      props.args,
      props.component,
      props.controls,
      props.storyId,
      props.variant,
      themes,
    ],
  );
  useEffect(
    () => () => {
      void previewApp.stop();
    },
    [previewApp],
  );
  return createElement(
    Fragment,
    { key: `${props.storyId}:${props.variant}` },
    createRuntimeElement(previewApp, registry),
  );
}

export interface PlaygroundProps {
  readonly onExit?: () => void;
  readonly onResize?: (width: number, height: number) => void;
  readonly onThemeChange?: (themeId: string) => void;
  readonly initialStoryId?: string;
  readonly initialVariant?: string;
  readonly onStoryChange?: (
    storyId: string,
    variant: string,
    controls: Partial<TerminalStoryControls>,
  ) => void;
}

function LoadedPlayground(
  props: PlaygroundProps & { readonly sets: readonly TuilStorySet[] },
): ReactNode {
  const app = useApp();
  const sets = props.sets;
  const initialSetIndex = Math.max(
    0,
    sets.findIndex((set) => set.id === props.initialStoryId),
  );
  const initialSet = sets[initialSetIndex] as (typeof sets)[number];
  const initialVariants = Object.keys(initialSet.definition.stories);
  const [setIndex, setSetIndex] = useState(initialSetIndex);
  const [variantIndex, setVariantIndex] = useState(() =>
    Math.max(0, initialVariants.indexOf(props.initialVariant ?? "")),
  );
  const [scrollOffset, setScrollOffset] = useState(0);
  const selectedSet = sets[setIndex] ?? sets[0];
  if (!selectedSet) throw new Error("Playground story catalog is empty");
  const variants = Object.entries(selectedSet.definition.stories);
  const [variantName, selectedStory] =
    variants[variantIndex] ?? variants[0] ?? [];
  if (!variantName || !selectedStory) {
    throw new Error(`Story set "${selectedSet.id}" has no variants`);
  }
  const previewControls = useMemo<TerminalStoryControls>(
    () => ({
      ...defaultTerminalStoryControls,
      ...selectedStory.terminal,
      width: app.capabilities.width,
      height: app.capabilities.height,
      theme: app.theme.id,
    }),
    [
      app.capabilities.height,
      app.capabilities.width,
      app.theme.id,
      selectedStory.terminal,
    ],
  );
  const selectStory = (nextSetIndex: number, nextVariantIndex: number) => {
    const nextSet = sets[nextSetIndex] as (typeof sets)[number];
    const nextVariants = Object.entries(nextSet.definition.stories);
    const [nextVariant, nextStory] =
      nextVariants[nextVariantIndex] ?? nextVariants[0] ?? [];
    if (!nextVariant || !nextStory) {
      throw new Error(`Story set "${nextSet.id}" has no variants`);
    }
    setSetIndex(nextSetIndex);
    setVariantIndex(nextVariantIndex);
    setScrollOffset(0);
    props.onStoryChange?.(nextSet.id, nextVariant, nextStory.terminal ?? {});
  };
  useTerminalInput(
    (input, key) => {
      const control = (letter: string, byte: string) =>
        input === byte || (key.ctrl && input.toLowerCase() === letter);
      if (control("q", "\u0011")) {
        props.onExit?.();
        return true;
      }
      if (control("p", "\u0010")) {
        selectStory((setIndex - 1 + sets.length) % sets.length, 0);
        return true;
      }
      if (control("n", "\u000e")) {
        selectStory((setIndex + 1) % sets.length, 0);
        return true;
      }
      if (control("b", "\u0002")) {
        selectStory(
          setIndex,
          (variantIndex - 1 + variants.length) % variants.length,
        );
        return true;
      }
      if (control("f", "\u0006")) {
        selectStory(setIndex, (variantIndex + 1) % variants.length);
        return true;
      }
      if (control("]", "\u001d")) {
        props.onResize?.(
          Math.min(240, app.capabilities.width + 5),
          app.capabilities.height,
        );
        return true;
      }
      if (control("\\", "\u001c")) {
        props.onResize?.(
          Math.max(20, app.capabilities.width - 5),
          app.capabilities.height,
        );
        return true;
      }
      if (control("t", "\u0014")) {
        props.onThemeChange?.(
          app.theme.id === "default-dark" ? "default-light" : "default-dark",
        );
        return true;
      }
      return false;
    },
    { priority: 50_000 },
  );
  const viewportHeight = Math.max(4, app.capabilities.height - 13);
  const scroll = (delta: number) =>
    setScrollOffset((current) => Math.max(0, Math.min(200, current + delta)));
  useTerminalInput(
    (_input, key) => {
      if (key.pageUp) scroll(-viewportHeight);
      else if (key.pageDown) scroll(viewportHeight);
      else return false;
      return true;
    },
    { priority: 49_000 },
  );
  usePointerEvents(
    useMemo(
      () => [
        {
          id: "playground-preview-viewport",
          type: "wheel" as const,
          listener: (event: { readonly wheelY: number }) =>
            scroll(event.wheelY),
        },
      ],
      [viewportHeight],
    ),
  );
  const StoryComponent = selectedSet.definition.component as ComponentType<
    Record<string, unknown>
  >;
  const installTarget = installTargets[selectedSet.id];
  return createElement(
    Box,
    { flexDirection: "column", width: app.capabilities.width },
    createElement(Heading, { level: 1 }, "tuil playground"),
    createElement(
      Text,
      null,
      "ctrl+p/n story · ctrl+b/f variant · page up/down scroll · ctrl+\\/ctrl+] resize · ctrl+t theme · ctrl+q quit",
    ),
    createElement(
      Box,
      { flexDirection: "row", gap: 1, label: "Playground controls" },
      createElement(
        Button,
        {
          id: "playground-previous-story",
          label: "Previous story",
          onPress: () =>
            selectStory((setIndex - 1 + sets.length) % sets.length, 0),
        },
        "Previous story",
      ),
      createElement(
        Button,
        {
          id: "playground-next-story",
          label: "Next story",
          onPress: () => selectStory((setIndex + 1) % sets.length, 0),
        },
        "Next story",
      ),
      createElement(
        Button,
        {
          id: "playground-next-variant",
          label: "Next variant",
          onPress: () =>
            selectStory(setIndex, (variantIndex + 1) % variants.length),
        },
        "Next variant",
      ),
      createElement(
        Button,
        {
          id: "playground-theme",
          label: "Toggle theme",
          onPress: () =>
            props.onThemeChange?.(
              app.theme.id === "default-dark"
                ? "default-light"
                : "default-dark",
            ),
        },
        "Toggle theme",
      ),
      createElement(
        Button,
        {
          id: "playground-scroll-up",
          label: "Scroll preview up",
          onPress: () => scroll(-viewportHeight),
        },
        "Scroll up",
      ),
      createElement(
        Button,
        {
          id: "playground-scroll-down",
          label: "Scroll preview down",
          onPress: () => scroll(viewportHeight),
        },
        "Scroll down",
      ),
    ),
    createElement(
      Box,
      { borderStyle: "single", flexDirection: "column" },
      createElement(
        Text,
        { bold: true },
        `Component browser: ${selectedSet.title} / ${variantName}`,
      ),
      createElement(
        Box,
        {
          id: "playground-preview-viewport",
          label: "Scrollable story preview",
          height: viewportHeight,
          overflow: "hidden",
        },
        createElement(
          Box,
          { flexDirection: "column", marginTop: -scrollOffset },
          createElement(PortableStoryPreview, {
            storyId: selectedSet.id,
            variant: variantName,
            component: StoryComponent,
            args: selectedStory.args as Readonly<Record<string, unknown>>,
            controls: previewControls,
          }),
        ),
      ),
      createElement(
        Text,
        { label: "Preview scroll position" },
        `Preview scroll offset: ${scrollOffset}`,
      ),
    ),
    createElement(
      Text,
      null,
      `Code: ${selectedSet.id}.${variantName}(${JSON.stringify(selectedStory.args)})`,
    ),
    installTarget
      ? createElement(Text, null, `Install: tuil add ${installTarget}`)
      : createElement(
          Text,
          { dimColor: true },
          "Install: this catalog groups executable examples and is not a registry item",
        ),
    createElement(TuilDevtools),
  );
}

export function Playground(props: PlaygroundProps): ReactNode {
  const [sets, setSets] = useState<readonly TuilStorySet[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    const loadStories = async () => {
      try {
        const module = await import("../../../registry/stories/ecosystem.tsx");
        const catalog = module.createEcosystemStoryCatalog();
        const loaded = module.ecosystemStorySetIds.map((id) => {
          const set = catalog.get(id);
          if (!set) throw new Error(`Missing playground story set "${id}"`);
          return set;
        });
        if (active) setSets(loaded);
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void loadStories();
    return () => {
      active = false;
    };
  }, []);
  if (error)
    return createElement(
      Text,
      { role: "alert" },
      `Story catalog failed: ${error}`,
    );
  if (!sets)
    return createElement(Text, { role: "status" }, "Loading story groups…");
  return createElement(LoadedPlayground, { ...props, sets });
}

export interface PlaygroundRuntimeConfig {
  readonly width: number;
  readonly height: number;
  readonly themeId: string;
  readonly storyId?: string;
  readonly variant?: string;
  readonly terminal?: Partial<TerminalStoryControls>;
}

export function createPlaygroundApp(
  config: PlaygroundRuntimeConfig,
  handlers: PlaygroundProps,
): TuilApp {
  const themes = createDefaultThemeRegistry();
  const terminal = {
    ...defaultTerminalStoryControls,
    ...config.terminal,
    width: config.width,
    height: config.height,
    theme: config.themeId,
  };
  return createApp({
    id: "tuil-playground",
    component: () =>
      createElement(Playground, {
        ...handlers,
        initialStoryId: config.storyId,
        initialVariant: config.variant,
      }),
    theme: themes.resolve(terminal.theme),
    terminal: {
      mode: "interactive",
      capabilities: {
        width: terminal.width,
        height: terminal.height,
        colorDepth: terminal.colorDepth,
        unicode: terminal.unicode,
        hyperlinks: terminal.hyperlinks,
        interactive: terminal.interactive,
        tty: terminal.interactive,
        alternateScreen: terminal.interactive,
        mouse: terminal.mouse,
        reducedMotion: terminal.reducedMotion,
        platform: terminal.platform,
      },
    },
  });
}

function widthAwareOutput(
  width: number,
  output: NodeJS.WriteStream,
): NodeJS.WriteStream {
  return new Proxy(output, {
    get(target, property) {
      if (property === "columns") return width;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export interface PlaygroundRunnerOptions {
  readonly output?: NodeJS.WriteStream;
  readonly renderApp?: (
    app: TuilApp,
    options: { readonly stdout: NodeJS.WriteStream },
  ) => Promise<TuilRenderInstance>;
}

export async function runPlayground(
  options: PlaygroundRunnerOptions = {},
): Promise<void> {
  const output = options.output ?? process.stdout;
  const renderApp = options.renderApp ?? render;
  let config: PlaygroundRuntimeConfig = {
    width: output.columns ?? 80,
    height: output.rows ?? 24,
    themeId: "default-dark",
    storyId: "foundation",
    variant: "Running",
    terminal: defaultTerminalStoryControls,
  };
  let active: Awaited<ReturnType<typeof render>> | undefined;
  let stopped = false;
  let resolveCompletion: (() => void) | undefined;
  let rejectCompletion: ((error: unknown) => void) | undefined;
  let handleOutputResize: (() => void) | undefined;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  let restartQueue = Promise.resolve();
  let restartRevision = 0;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    if (handleOutputResize) {
      output.off("resize", handleOutputResize);
    }
    restartQueue = restartQueue.then(async () => {
      await active?.unmount();
      resolveCompletion?.();
    });
  };
  const restart = (next: PlaygroundRuntimeConfig) => {
    if (stopped) return;
    config = next;
    restartRevision += 1;
    const revision = restartRevision;
    restartQueue = restartQueue
      .then(async () => {
        await Bun.sleep(0);
        if (stopped || revision !== restartRevision) return;
        const previous = active;
        active = undefined;
        await previous?.unmount();
        if (stopped || revision !== restartRevision) return;
        const app = createPlaygroundApp(config, {
          onExit: finish,
          onResize: (width, height) =>
            restart({
              ...config,
              width,
              height,
              terminal: { ...config.terminal, width, height },
            }),
          onThemeChange: (themeId) =>
            restart({
              ...config,
              themeId,
              terminal: { ...config.terminal, theme: themeId },
            }),
          onStoryChange: (storyId, variant) => {
            config = { ...config, storyId, variant };
          },
        });
        const instance = await renderApp(app, {
          stdout: widthAwareOutput(config.width, output),
        });
        active = instance;
        void instance.waitUntilExit().then(
          () => {
            if (active === instance && !stopped) finish();
          },
          (error: unknown) => {
            if (active !== instance || stopped) return;
            stopped = true;
            if (handleOutputResize) output.off("resize", handleOutputResize);
            rejectCompletion?.(error);
          },
        );
      })
      .catch((error: unknown) => {
        if (stopped) return;
        stopped = true;
        if (handleOutputResize) {
          output.off("resize", handleOutputResize);
        }
        rejectCompletion?.(error);
      });
  };
  handleOutputResize = () => {
    const width = output.columns ?? config.width;
    const height = output.rows ?? config.height;
    restart({
      ...config,
      width,
      height,
      terminal: { ...config.terminal, width, height },
    });
  };
  output.on("resize", handleOutputResize);
  try {
    restart(config);
    await restartQueue;
    await completion;
    await restartQueue;
  } finally {
    output.off("resize", handleOutputResize);
    if (!stopped) {
      stopped = true;
      await active?.unmount();
    }
  }
}

if (import.meta.main) {
  await runPlayground();
}
