import { renderStoryRequest } from "@mwillbanks/tuil-story";
import { createShowcaseCatalog } from "./index.tsx";

export interface ShowcaseStory {
  readonly id: string;
  readonly storyId: string;
  readonly title: string;
  readonly variant: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly controls: Readonly<Record<string, string | number | boolean>>;
  readonly frame: string;
}

export async function createBrowserShowcaseCatalog(): Promise<
  readonly ShowcaseStory[]
> {
  const catalog = createShowcaseCatalog();
  const stories: ShowcaseStory[] = [];
  for (const set of catalog.list()) {
    for (const [variant, definition] of Object.entries(
      set.definition.stories,
    )) {
      const rendered = await renderStoryRequest(catalog, {
        storyId: set.id,
        variant,
      });
      stories.push({
        id: set.id + ":" + variant,
        storyId: set.id,
        title: set.title,
        variant,
        args: definition.args as Readonly<Record<string, unknown>>,
        controls: { ...rendered.controls },
        frame: rendered.frame,
      });
    }
  }
  return stories;
}
