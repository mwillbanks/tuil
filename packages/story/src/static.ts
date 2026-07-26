import type {
  TerminalStoryControls,
  TuilStory,
  TuilStoryDefinition,
} from "@mwillbanks/tuil-testing";
import type { ThemeRegistry } from "@mwillbanks/tuil-theme";
import {
  renderStoryRequest,
  type StoryFrame,
  TuilStoryCatalog,
} from "./index.tsx";

export class StaticStoryCatalog {
  readonly #catalog = new TuilStoryCatalog();

  register<TProps>(
    id: string,
    definition: TuilStoryDefinition<
      TProps,
      Readonly<Record<string, TuilStory<TProps>>>
    >,
  ): () => void {
    const registration = this.#catalog.register(id, id, definition);
    return () => {
      void registration.dispose();
    };
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
      const body = (await request.json()) as StaticStoryRequest;
      return Response.json(
        await renderStaticStoryRequest(catalog, body, {
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
