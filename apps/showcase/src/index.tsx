import { renderStoryRequest } from "@mwillbanks/tuil-story";
import {
  createEcosystemStoryCatalog,
  FoundationStory as Showcase,
  foundationStories as showcaseStories,
} from "../../../registry/stories/ecosystem.tsx";

export type { FoundationStoryProps as ShowcaseProps } from "../../../registry/stories/ecosystem.tsx";
export { Showcase, showcaseStories };

export function createShowcaseCatalog() {
  return createEcosystemStoryCatalog();
}

export interface ShowcaseSelection {
  readonly list?: boolean;
  readonly storyId?: string;
  readonly variant?: string;
}

export async function renderShowcase(
  selection: ShowcaseSelection = {},
): Promise<string> {
  const catalog = createShowcaseCatalog();
  if (selection.list)
    return catalog
      .list()
      .flatMap((story) =>
        Object.keys(story.definition.stories).map(
          (variant) => `${story.id}\t${variant}`,
        ),
      )
      .join("\n");
  const selectedStories = selection.storyId
    ? [catalog.get(selection.storyId)].filter(Boolean)
    : catalog.list();
  if (selectedStories.length === 0)
    throw new Error(`Unknown story set: ${selection.storyId}`);
  const frames = await Promise.all(
    selectedStories.flatMap((set) =>
      Object.keys(set?.definition.stories ?? {})
        .filter(
          (variant) => !selection.variant || variant === selection.variant,
        )
        .map(async (variant) => {
          const story = await renderStoryRequest(catalog, {
            storyId: set?.id ?? "",
            variant,
          });
          return `${set?.id}/${variant}\n${story.frame}`;
        }),
    ),
  );
  if (frames.length === 0)
    throw new Error(`Unknown variant: ${selection.variant}`);
  return frames.join("\n\n");
}

export function parseShowcaseArguments(
  args: readonly string[],
): ShowcaseSelection {
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  return {
    list: args.includes("--list"),
    storyId: value("--story") ?? value("--story-set"),
    variant: value("--variant"),
  };
}

if (import.meta.main) {
  process.stdout.write(
    `${await renderShowcase(parseShowcaseArguments(process.argv.slice(2)))}\n`,
  );
}
