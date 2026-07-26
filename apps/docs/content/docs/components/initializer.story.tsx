"use client";

import { defineStoryFactory } from "@fumadocs/story/next/client";
import { createFumadocsStoryAdapter } from "@mwillbanks/tuil-story/browser";
import { initWizardBrowserStorySet } from "../../../../../registry/blocks/init-wizard-story-data";

const { defineStory } = defineStoryFactory();
const adapter = createFumadocsStoryAdapter(initWizardBrowserStorySet, {
  endpoint: "/api/tuil-story",
});
const initializer = adapter["Default"];
if (!initializer) {
  throw new Error("Initializer portable story is unavailable");
}

export const Initializer = defineStory({
  Component: initializer.Component,
  args: initializer.args,
});
