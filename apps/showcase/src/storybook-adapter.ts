import {
  componentArgsFromAdapterArgs,
  terminalControlArgNames,
  terminalControlsFromArgs,
  terminalControlsToArgs,
} from "@mwillbanks/tuil-story/browser";
import { defaultTerminalStoryControls } from "@mwillbanks/tuil-testing";
import type { Meta, StoryObj } from "@storybook/react";
import { createElement } from "react";
import { GhosttyStoryFrame } from "./ghostty-story-frame.tsx";

export function createShowcaseStorybookAdapter(set: {
  readonly id: string;
  readonly title: string;
  readonly stories: Readonly<
    Record<
      string,
      {
        readonly args: Readonly<Record<string, unknown>>;
        readonly terminal?: Readonly<Record<string, unknown>>;
      }
    >
  >;
}) {
  const argTypes: NonNullable<Meta<Record<string, unknown>>["argTypes"]> = {
    [terminalControlArgNames.width]: {
      control: { type: "number", min: 20, max: 240 },
    },
    [terminalControlArgNames.height]: {
      control: { type: "number", min: 8, max: 100 },
    },
    [terminalControlArgNames.colorDepth]: {
      control: "select",
      options: [1, 4, 8, 24],
    },
    [terminalControlArgNames.unicode]: { control: "boolean" },
    [terminalControlArgNames.theme]: {
      control: "select",
      options: ["default-dark", "default-light"],
    },
    [terminalControlArgNames.platform]: {
      control: "select",
      options: ["darwin", "linux", "win32"],
    },
    [terminalControlArgNames.interactive]: { control: "boolean" },
    [terminalControlArgNames.reducedMotion]: { control: "boolean" },
    [terminalControlArgNames.mouse]: { control: "boolean" },
    [terminalControlArgNames.hyperlinks]: { control: "boolean" },
  };
  return Object.freeze({
    meta: Object.freeze({
      title: set.title,
      argTypes: Object.freeze(argTypes),
    }),
    stories: Object.freeze(
      Object.fromEntries(
        Object.entries(set.stories).map(([variant, story]) => {
          const controls = {
            ...defaultTerminalStoryControls,
            ...story.terminal,
          };
          return [
            variant,
            Object.freeze({
              args: Object.freeze({
                ...story.args,
                ...terminalControlsToArgs(controls),
              }),
              parameters: Object.freeze({
                docs: { source: { type: "dynamic" } },
                tuil: { storyId: set.id, variant },
              }),
              render(args: Readonly<Record<string, unknown>>) {
                return createElement(GhosttyStoryFrame, {
                  storyId: set.id,
                  variant,
                  args: componentArgsFromAdapterArgs(args),
                  controls: terminalControlsFromArgs(
                    args,
                  ) as unknown as Readonly<Record<string, unknown>>,
                });
              },
            }),
          ];
        }),
      ),
    ),
  });
}

export function showcaseStory(
  adapter: ReturnType<typeof createShowcaseStorybookAdapter>,
  name: string,
  surface: string,
): StoryObj<Record<string, unknown>> {
  const value = adapter.stories[name];
  if (!value) throw new Error(`Missing ${surface} story "${name}"`);
  return { ...value };
}
