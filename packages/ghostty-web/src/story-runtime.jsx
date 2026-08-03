import { createApp } from "@mwillbanks/tuil";
import { createDefaultThemeRegistry } from "@mwillbanks/tuil-theme";
import { createElement } from "react";
import { createEcosystemStoryCatalog } from "../../../registry/stories/ecosystem.tsx";
import { browserTerminalProbe } from "./browser-terminal";

const defaults = Object.freeze({
  width: 80,
  height: 24,
  colorDepth: 24,
  unicode: true,
  hyperlinks: true,
  interactive: true,
  mouse: true,
  reducedMotion: false,
  platform: "linux",
  theme: "default-dark",
});

export function createTuilGhosttyStoryApp(options) {
  const catalog = createEcosystemStoryCatalog();
  const set = catalog.get(options.storyId);
  if (!set) throw new Error(`Unknown browser story set "${options.storyId}".`);
  const story = set.definition.stories[options.variant];
  if (!story) {
    throw new Error(
      `Unknown browser story "${options.storyId}/${options.variant}".`,
    );
  }
  const controls = { ...defaults, ...story.terminal, ...options.controls };
  const args = { ...story.args, ...options.args };
  const themes = createDefaultThemeRegistry();
  return createApp({
    id: `tuil-ghostty-story-${options.storyId}-${options.variant}`,
    component: () => createElement(set.definition.component, args),
    theme: themes.resolve(controls.theme),
    terminal: {
      ...browserTerminalProbe(controls.width, controls.height),
      mode: controls.interactive ? "interactive" : "static",
      capabilities: {
        width: controls.width,
        height: controls.height,
        colorDepth: controls.colorDepth,
        unicode: controls.unicode,
        hyperlinks: controls.hyperlinks,
        interactive: controls.interactive,
        tty: controls.interactive,
        alternateScreen: controls.interactive,
        mouse: controls.mouse,
        images: false,
        reducedMotion: controls.reducedMotion,
        platform: controls.platform,
      },
    },
  });
}
