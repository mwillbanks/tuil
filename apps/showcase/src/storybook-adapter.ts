import { createStorybookAdapter } from "@mwillbanks/tuil-story/storybook";
import type { StoryObj } from "@storybook/react";

export function createShowcaseStorybookAdapter(
  set: Parameters<typeof createStorybookAdapter>[0],
) {
  return createStorybookAdapter(set, {
    endpoint:
      process.env["TUIL_STORY_ENDPOINT"] ??
      "http://127.0.0.1:4317/api/tuil-story",
  });
}

export function showcaseStory(
  adapter: ReturnType<typeof createStorybookAdapter>,
  name: string,
  surface: string,
): StoryObj<Record<string, unknown>> {
  const value = adapter.stories[name];
  if (!value) throw new Error(`Missing ${surface} story "${name}"`);
  return { ...value };
}
