import type { Disposer } from "@mwillbanks/tuil-core";
import type {
  TerminalStoryControls,
  TuilStory,
  TuilStoryDefinition,
} from "@mwillbanks/tuil-testing";
import type { ThemeRegistry } from "@mwillbanks/tuil-theme";
import {
  handleStoryHttpRequest,
  renderStoryRequest,
  type StoryFrame,
  type StoryHttpHandlerOptions,
  TuilStoryCatalog,
} from "./index.tsx";

export class StaticStoryCatalog {
  readonly #catalog: TuilStoryCatalog;

  constructor() {
    this.#catalog = new TuilStoryCatalog();
  }

  register<TProps>(
    id: string,
    definition: TuilStoryDefinition<
      TProps,
      Readonly<Record<string, TuilStory<TProps>>>
    >,
  ): Disposer {
    const registration = this.#catalog.register(id, id, definition);
    return () => registration.dispose();
  }

  get runtimeCatalog(): TuilStoryCatalog {
    return this.#catalog;
  }
}

export interface StaticStoryRequest {
  readonly storyId: string;
  readonly variant: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly controls?: Partial<TerminalStoryControls>;
}

export type StaticStoryFrame = StoryFrame;

export async function renderStaticStoryRequest(
  catalog: StaticStoryCatalog,
  request: StaticStoryRequest,
  options: {
    readonly themeRegistry?: ThemeRegistry;
    readonly signal?: AbortSignal;
  } = {},
): Promise<StaticStoryFrame> {
  return renderStoryRequest(
    catalog.runtimeCatalog,
    {
      ...request,
      controls: {
        ...request.controls,
        interactive: false,
      },
    },
    options,
  );
}

export function createStaticStoryHttpHandler(
  catalog: StaticStoryCatalog,
  options: StoryHttpHandlerOptions = {},
): (request: Request) => Promise<Response> {
  return (request) =>
    handleStoryHttpRequest(
      request,
      (body, signal) =>
        renderStaticStoryRequest(catalog, body, {
          themeRegistry: options.themeRegistry,
          signal,
        }),
      options,
    );
}
