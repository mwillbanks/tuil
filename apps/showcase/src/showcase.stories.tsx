import type { Meta, StoryObj } from "@storybook/react";
import { ecosystemBrowserStorySets } from "../../../registry/stories/ecosystem-story-data.ts";
import { createShowcaseStorybookAdapter } from "./storybook-adapter.ts";

const adapters = Object.fromEntries(
  ecosystemBrowserStorySets.map((set) => [
    set.id,
    createShowcaseStorybookAdapter(set),
  ]),
);
const foundation = adapters["foundation"];
const forms = adapters["forms"];
const navigation = adapters["navigation"];
const data = adapters["data"];
const initializer = adapters["init-wizard"];
if (!foundation || !forms || !navigation || !data || !initializer) {
  throw new Error("Portable ecosystem stories are unavailable");
}

const meta = {
  title: "Components/Ecosystem",
  argTypes: foundation.meta.argTypes,
} satisfies Meta<Record<string, unknown>>;

export default meta;

type Story = StoryObj<typeof meta>;

const story = (
  adapter: typeof foundation,
  variant: string,
): StoryObj<Record<string, unknown>> => {
  const definition = adapter.stories[variant];
  if (!definition) {
    throw new Error(`Portable story variant "${variant}" is unavailable`);
  }
  return definition;
};

export const FoundationRunning = {
  ...story(foundation, "Running"),
} satisfies Story;
export const FoundationComplete = {
  ...story(foundation, "Complete"),
} satisfies Story;
export const FormsProject = {
  ...story(forms, "Project"),
} satisfies Story;
export const FormsJavaScript = {
  ...story(forms, "JavaScript"),
} satisfies Story;
export const NavigationOverview = {
  ...story(navigation, "Overview"),
} satisfies Story;
export const NavigationSettings = {
  ...story(navigation, "Settings"),
} satisfies Story;
export const DataAll = { ...story(data, "All") } satisfies Story;
export const DataRelease = {
  ...story(data, "Release"),
} satisfies Story;
export const InitializerDefault = {
  ...story(initializer, "Default"),
} satisfies Story;
export const InitializerStatic = {
  ...story(initializer, "StaticFallback"),
} satisfies Story;
