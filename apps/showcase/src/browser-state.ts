import type { ShowcaseStory } from "./catalog.ts";

export function selectShowcaseStory(
  stories: readonly ShowcaseStory[],
  query: string,
): ShowcaseStory {
  const parameters = new URLSearchParams(query);
  const storyId = parameters.get("story");
  const variant = parameters.get("variant");
  const selected =
    stories.find(
      (story) =>
        story.storyId === storyId && (!variant || story.variant === variant),
    ) ?? stories[0];
  if (!selected) throw new Error("The showcase catalog is empty");
  return selected;
}

export function showcaseQuery(story: ShowcaseStory): string {
  return (
    "?" + new URLSearchParams({ story: story.storyId, variant: story.variant })
  );
}

export function parseShowcaseArgument(
  value: string,
  previous: unknown,
): unknown {
  if (typeof previous === "number") {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new TypeError("Enter a finite number");
    return numeric;
  }
  if (typeof previous === "boolean") return value === "true";
  if (previous !== null && typeof previous === "object")
    return JSON.parse(value) as unknown;
  return value;
}
