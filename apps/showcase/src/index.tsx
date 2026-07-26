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

export async function renderShowcase(): Promise<string> {
  const catalog = createShowcaseCatalog();
  const frames = await Promise.all(
    Object.keys(showcaseStories.stories).map(async (variant) => {
      const story = await renderStoryRequest(catalog, {
        storyId: "foundation",
        variant,
      });
      return `${variant}\n${story.frame}`;
    }),
  );
  return frames.join("\n\n");
}

if (import.meta.main) {
  process.stdout.write(`${await renderShowcase()}\n`);
}
