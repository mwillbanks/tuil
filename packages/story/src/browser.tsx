import {
  defaultTerminalStoryControls,
  type TerminalStoryControls,
  type TuilStory,
} from "@mwillbanks/tuil-testing";
import Convert from "ansi-to-html";
import {
  createElement,
  type FunctionComponent,
  type ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { StoryBridgeRequest, StoryFrame, TuilStorySet } from "./index.tsx";

export function ansiFrameToHtml(value: string): string {
  return new Convert({ escapeXML: true }).toHtml(value);
}

export const terminalControlArgNames = Object.freeze({
  width: "terminalWidth",
  height: "terminalHeight",
  colorDepth: "terminalColorDepth",
  unicode: "terminalUnicode",
  theme: "terminalTheme",
  platform: "terminalPlatform",
  interactive: "terminalInteractive",
  reducedMotion: "terminalReducedMotion",
  mouse: "terminalMouse",
  hyperlinks: "terminalHyperlinks",
} as const);

export function terminalControlsToArgs(
  controls: TerminalStoryControls,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(
      (
        Object.keys(terminalControlArgNames) as Array<
          keyof typeof terminalControlArgNames
        >
      ).map((control) => [terminalControlArgNames[control], controls[control]]),
    ),
  );
}

export function terminalControlsFromArgs(
  args: Readonly<Record<string, unknown>>,
): TerminalStoryControls {
  return Object.fromEntries(
    Object.entries(terminalControlArgNames).map(([control, argument]) => [
      control,
      args[argument],
    ]),
  ) as unknown as TerminalStoryControls;
}

export function componentArgsFromAdapterArgs(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const terminalArguments = new Set<string>(
    Object.values(terminalControlArgNames),
  );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(args).filter(
        ([key]) => !terminalArguments.has(key) && key !== "terminalInput",
      ),
    ),
  );
}

export interface BrowserStorySet {
  readonly id: string;
  readonly title: string;
  readonly stories: Readonly<
    Record<string, TuilStory<Record<string, unknown>>>
  >;
}

export function browserStories(
  set: TuilStorySet | BrowserStorySet,
): BrowserStorySet["stories"] {
  return "definition" in set ? set.definition.stories : set.stories;
}

export interface TerminalStoryFrameProps extends StoryBridgeRequest {
  readonly endpoint?: string;
  readonly className?: string;
  readonly inspector?: boolean;
}

export interface TerminalStoryFrameEffectOptions {
  readonly endpoint: string;
  readonly body: string;
  readonly setFrame: (frame: StoryFrame | undefined) => void;
  readonly setStatus: (status: string) => void;
}

export function createTerminalStoryFrameEffect({
  endpoint,
  body,
  setFrame,
  setStatus,
}: TerminalStoryFrameEffectOptions): () => () => void {
  return () => {
    const controller = new AbortController();
    setStatus("Rendering terminal story…");
    void fetch(endpoint, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as
          | StoryFrame
          | { readonly error: string };
        if (!response.ok || "error" in result) {
          throw new Error(
            "error" in result ? result.error : `HTTP ${response.status}`,
          );
        }
        setFrame(result);
        setStatus("");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFrame(undefined);
          setStatus(error instanceof Error ? error.message : String(error));
        }
      });
    return () => controller.abort();
  };
}

export interface TerminalStoryFrameViewProps {
  readonly request: StoryBridgeRequest;
  readonly className?: string;
  readonly inspector: boolean;
  readonly frame?: StoryFrame;
  readonly status: string;
  readonly frameHtml?: string;
}

export function TerminalStoryFrameView({
  request,
  className,
  inspector,
  frame,
  status,
  frameHtml,
}: TerminalStoryFrameViewProps): ReactElement {
  return createElement(
    "div",
    {
      className,
      "data-tuil-story": `${request.storyId}/${request.variant}`,
    },
    createElement(
      "pre",
      {
        "data-tuil-frame": true,
        dangerouslySetInnerHTML: frameHtml ? { __html: frameHtml } : undefined,
        style: {
          background:
            frame?.controls.theme === "default-light" ? "#fafafa" : "#09090b",
          color:
            frame?.controls.theme === "default-light" ? "#09090b" : "#fafafa",
          overflow: "auto",
          padding: "1rem",
          whiteSpace: "pre",
        },
      },
      frameHtml ? undefined : status,
    ),
    inspector && frame
      ? createElement(
          "details",
          { "data-tuil-inspector": true },
          createElement("summary", null, "Frame inspection"),
          createElement(
            "pre",
            {
              style: {
                background: "#18181b",
                color: "#e4e4e7",
                overflow: "auto",
                padding: "1rem",
                whiteSpace: "pre-wrap",
              },
            },
            JSON.stringify(
              {
                normalizedFrame: frame.frame,
                semantics: frame.semantics,
                focus: frame.focus,
                events: frame.events,
                actions: frame.actions,
              },
              null,
              2,
            ),
          ),
        )
      : null,
  );
}

export function TerminalStoryFrame({
  endpoint = "/api/tuil-story",
  className,
  inspector = true,
  ...request
}: TerminalStoryFrameProps): ReactElement {
  const body = useMemo(() => JSON.stringify(request), [request]);
  const [frame, setFrame] = useState<StoryFrame>();
  const [status, setStatus] = useState("Rendering terminal story…");
  const frameHtml = useMemo(
    () => (frame ? ansiFrameToHtml(frame.ansiFrame) : undefined),
    [frame],
  );
  const effect = useMemo(
    () =>
      createTerminalStoryFrameEffect({
        endpoint,
        body,
        setFrame,
        setStatus,
      }),
    [body, endpoint],
  );
  useEffect(effect, [effect]);
  return createElement(TerminalStoryFrameView, {
    request,
    className,
    inspector,
    frame,
    status,
    frameHtml,
  });
}

export type FumadocsStoryProps = Readonly<
  Record<string, unknown> & {
    readonly terminalWidth: number;
    readonly terminalHeight: number;
    readonly terminalColorDepth: 1 | 4 | 8 | 24;
    readonly terminalUnicode: boolean;
    readonly terminalTheme: string;
    readonly terminalPlatform: NodeJS.Platform;
    readonly terminalInteractive: boolean;
    readonly terminalReducedMotion: boolean;
    readonly terminalMouse: boolean;
    readonly terminalHyperlinks: boolean;
    readonly terminalInput?: string;
  }
>;

export interface FumadocsStoryConfig {
  readonly Component: FunctionComponent<FumadocsStoryProps>;
  readonly args: {
    readonly initial: FumadocsStoryProps;
  };
}

export function createFumadocsStoryAdapter(
  set: TuilStorySet | BrowserStorySet,
  options: { readonly endpoint?: string } = {},
): Readonly<Record<string, FumadocsStoryConfig>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(browserStories(set)).map(([variant, story]) => {
        const initial = Object.freeze({
          ...story.args,
          ...terminalControlsToArgs({
            ...defaultTerminalStoryControls,
            ...story.terminal,
          }),
          terminalInput: "",
        }) as FumadocsStoryProps;
        const Component = (props: FumadocsStoryProps) => {
          const controls = terminalControlsFromArgs(props);
          const args = componentArgsFromAdapterArgs(props);
          return createElement(TerminalStoryFrame, {
            endpoint: options.endpoint,
            storyId: set.id,
            variant,
            args,
            controls,
            inputs:
              typeof props.terminalInput === "string" &&
              props.terminalInput.length > 0
                ? [props.terminalInput]
                : [],
          });
        };
        return [
          variant,
          Object.freeze({
            Component,
            args: Object.freeze({ initial }),
          }),
        ];
      }),
    ),
  );
}
