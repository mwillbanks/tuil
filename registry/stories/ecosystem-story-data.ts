export const foundationStoryVariants = Object.freeze({
  Running: {
    args: { status: "running" as const, progress: 0.62 },
  },
  Complete: {
    args: { status: "complete" as const, progress: 1 },
    terminal: { colorDepth: 4 as const, width: 60 },
  },
});

export const formStoryVariants = Object.freeze({
  Project: {
    args: {
      initialName: "my-app",
      language: "typescript" as const,
    },
  },
  JavaScript: {
    args: {
      initialName: "terminal-app",
      language: "javascript" as const,
    },
  },
});

export const navigationStoryVariants = Object.freeze({
  Overview: { args: { selected: "overview" as const } },
  Settings: { args: { selected: "settings" as const } },
});

export const dataStoryVariants = Object.freeze({
  All: { args: { logFilter: "" } },
  Release: { args: { logFilter: "release" } },
});

export const ecosystemBrowserStorySets = Object.freeze([
  {
    id: "foundation",
    title: "Components/Foundation",
    stories: foundationStoryVariants,
  },
  {
    id: "forms",
    title: "Components/Forms",
    stories: formStoryVariants,
  },
  {
    id: "navigation",
    title: "Components/Navigation",
    stories: navigationStoryVariants,
  },
  {
    id: "data",
    title: "Components/Complex data",
    stories: dataStoryVariants,
  },
  initWizardBrowserStorySet,
  platformBrowserStorySet,
] as const);

import { initWizardBrowserStorySet } from "../blocks/init-wizard-story-data.ts";
import { platformBrowserStorySet } from "./platform-story-data.ts";
