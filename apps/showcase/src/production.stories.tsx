import type { Meta, StoryObj } from "@storybook/react";
import { productionBrowserStorySet } from "../../../registry/stories/production-story-data.ts";
import {
  createShowcaseStorybookAdapter,
  showcaseStory,
} from "./storybook-adapter.ts";

const adapter = createShowcaseStorybookAdapter(productionBrowserStorySet);

const meta = {
  title: "Applications/Production",
  argTypes: adapter.meta.argTypes,
} satisfies Meta<Record<string, unknown>>;

export default meta;
type Story = StoryObj<typeof meta>;

function story(name: keyof typeof adapter.stories): Story {
  return showcaseStory(adapter, String(name), "production");
}

export const GitClient = story("GitClient");
export const LogExplorer = story("LogExplorer");
export const OpenTelemetryConsole = story("OpenTelemetryConsole");
export const AiCodingAssistant = story("AiCodingAssistant");
export const DeploymentDashboard = story("DeploymentDashboard");
export const FileManager = story("FileManager");
export const WorkflowRunner = story("WorkflowRunner");
export const DocumentationBrowser = story("DocumentationBrowser");
