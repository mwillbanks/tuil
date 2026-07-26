import { defaultTerminalStoryControls } from "@mwillbanks/tuil-testing";
import type { Meta, StoryObj } from "@storybook/react";
import { createElement } from "react";
import {
  type BrowserStorySet,
  browserStories,
  componentArgsFromAdapterArgs,
  TerminalStoryFrame,
  terminalControlArgNames,
  terminalControlsFromArgs,
  terminalControlsToArgs,
} from "./browser.tsx";
import type { TuilStorySet } from "./index.tsx";

export interface StorybookAdapter {
  readonly meta: Meta<Record<string, unknown>>;
  readonly stories: Readonly<Record<string, StoryObj<Record<string, unknown>>>>;
}

export function createStorybookAdapter(
  set: TuilStorySet | BrowserStorySet,
  options: { readonly endpoint?: string } = {},
): StorybookAdapter {
  const controls: NonNullable<Meta<Record<string, unknown>>["argTypes"]> = {
    [terminalControlArgNames.width]: {
      name: "Width",
      control: { type: "number", min: 20, max: 240 },
    },
    [terminalControlArgNames.height]: {
      name: "Height",
      control: { type: "number", min: 5, max: 100 },
    },
    [terminalControlArgNames.colorDepth]: {
      name: "Color depth",
      control: "select",
      options: [1, 4, 8, 24],
    },
    [terminalControlArgNames.unicode]: {
      name: "Unicode",
      control: "boolean",
    },
    [terminalControlArgNames.theme]: {
      name: "Theme",
      control: "select",
      options: ["default-dark", "default-light"],
    },
    [terminalControlArgNames.platform]: {
      name: "Platform",
      control: "select",
      options: ["darwin", "linux", "win32"],
    },
    [terminalControlArgNames.interactive]: {
      name: "Interactive",
      control: "boolean",
    },
    [terminalControlArgNames.reducedMotion]: {
      name: "Reduced motion",
      control: "boolean",
    },
    [terminalControlArgNames.mouse]: {
      name: "Mouse",
      control: "boolean",
    },
    [terminalControlArgNames.hyperlinks]: {
      name: "Hyperlinks",
      control: "boolean",
    },
    terminalInput: {
      control: "text",
      description:
        "Simulated key input, such as enter, escape, tab, or arrowDown",
    },
  };
  return Object.freeze({
    meta: Object.freeze({
      title: set.title,
      argTypes: Object.freeze(controls),
    }),
    stories: Object.freeze(
      Object.fromEntries(
        Object.entries(browserStories(set)).map(([variant, story]) => {
          const initialControls = {
            ...defaultTerminalStoryControls,
            ...story.terminal,
          };
          return [
            variant,
            Object.freeze({
              args: Object.freeze({
                ...story.args,
                ...terminalControlsToArgs(initialControls),
                terminalInput: "",
              }),
              parameters: Object.freeze({
                tuil: Object.freeze({ storyId: set.id, variant }),
              }),
              render(args: Readonly<Record<string, unknown>>) {
                const terminalControls = terminalControlsFromArgs(args);
                const componentArgs = componentArgsFromAdapterArgs(args);
                const terminalInput = args["terminalInput"];
                return createElement(TerminalStoryFrame, {
                  endpoint: options.endpoint,
                  storyId: set.id,
                  variant,
                  args: componentArgs,
                  controls: terminalControls,
                  inputs:
                    typeof terminalInput === "string" &&
                    terminalInput.length > 0
                      ? [terminalInput]
                      : [],
                });
              },
            }),
          ];
        }),
      ),
    ),
  });
}
