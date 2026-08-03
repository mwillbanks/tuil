import type { Meta, StoryObj } from "@storybook/react";
import { platformBrowserStorySet } from "../../../registry/stories/platform-story-data.ts";
import {
  createShowcaseStorybookAdapter,
  showcaseStory,
} from "./storybook-adapter.ts";

const adapter = createShowcaseStorybookAdapter(platformBrowserStorySet);

const meta = {
  title: "Platform/Expansion",
  argTypes: adapter.meta.argTypes,
} satisfies Meta<Record<string, unknown>>;

export default meta;
type Story = StoryObj<typeof meta>;

function story(name: keyof typeof adapter.stories): Story {
  return showcaseStory(adapter, String(name), "platform");
}

export const Renderer = story("Renderer");
export const PointerScroll = story("PointerScroll");
export const Editors = story("Editors");
export const RichDocuments = story("RichDocuments");
export const StreamingContent = story("StreamingContent");
export const Logging = story("Logging");
export const Devtools = story("Devtools");
export const RegistryPlugins = story("RegistryPlugins");
export const Components = story("Components");
export const ProductionApps = story("ProductionApps");
