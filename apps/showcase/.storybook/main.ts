import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const configurationDirectory = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  docs: {
    defaultName: "Documentation",
  },
  viteFinal(config) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias as Readonly<Record<string, string>> | undefined),
      "@mwillbanks/tuil-ghostty-web": resolve(
        configurationDirectory,
        "../../../packages/ghostty-web/dist/browser.js",
      ),
    };
    return config;
  },
};

export default config;
