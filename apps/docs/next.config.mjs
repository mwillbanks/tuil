import { createNextStory } from "@fumadocs/story/next";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const withStory = createNextStory();

export default withStory(
  withMDX({
    reactStrictMode: true,
    experimental: {
      useTypeScriptCli: true,
    },
    serverExternalPackages: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-core",
      "@mwillbanks/tuil-events",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-hotkeys",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-plugin",
      "@mwillbanks/tuil-story",
      "@mwillbanks/tuil-testing",
      "@mwillbanks/tuil-testing-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "ink-testing-library",
    ],
  }),
);
