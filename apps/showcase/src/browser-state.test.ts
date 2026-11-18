import { expect, test } from "bun:test";
import {
  parseShowcaseArgument,
  selectShowcaseStory,
  showcaseQuery,
} from "./browser-state.ts";
import type { ShowcaseStory } from "./catalog.ts";

const stories: readonly ShowcaseStory[] = [
  {
    id: "foundation:Running",
    storyId: "foundation",
    title: "Foundation",
    variant: "Running",
    args: { progress: 0.5 },
    controls: { width: 80, interactive: true },
    frame: "Running",
  },
  {
    id: "forms:Project",
    storyId: "forms",
    title: "Forms",
    variant: "Project",
    args: { language: "typescript" },
    controls: { width: 80, interactive: true },
    frame: "Project",
  },
];

const firstStory = stories[0];
const formStory = stories[1];
if (!firstStory || !formStory) throw new Error("Story fixtures are missing");

test("restores portable story links and resolves invalid selections", () => {
  expect(selectShowcaseStory(stories, "?story=forms&variant=Project")).toEqual(
    formStory,
  );
  expect(selectShowcaseStory(stories, "?story=missing")).toEqual(firstStory);
  expect(selectShowcaseStory(stories, "?story=forms")).toEqual(formStory);
  expect(() => selectShowcaseStory([], "")).toThrow("catalog is empty");
  expect(showcaseQuery(formStory)).toBe("?story=forms&variant=Project");
});

test("converts component controls without accepting non-finite numbers", () => {
  expect(parseShowcaseArgument("25", 0)).toBe(25);
  expect(parseShowcaseArgument("true", false)).toBeTrue();
  expect(parseShowcaseArgument("false", true)).toBeFalse();
  expect(parseShowcaseArgument("text", "")).toBe("text");
  expect(parseShowcaseArgument('{"id":2}', {})).toEqual({ id: 2 });
  expect(() => parseShowcaseArgument("NaN", 0)).toThrow("finite number");
  expect(() => parseShowcaseArgument("Infinity", 0)).toThrow("finite number");
  expect(() => parseShowcaseArgument("{", {})).toThrow();
});
