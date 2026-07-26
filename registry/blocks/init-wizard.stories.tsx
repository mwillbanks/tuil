import { defineTuilStories } from "@mwillbanks/tuil-testing";
import { InitWizard } from "./init-wizard.tsx";

export const initWizardStories = defineTuilStories({
  component: InitWizard,
  stories: {
    Default: {
      description:
        "Complete self-hosted project initialization with routing, forms, workflow, operations, and confirmation.",
      args: {
        initialName: "my-tuil-app",
        onComplete: () => undefined,
        onCancel: () => undefined,
      },
      terminal: {
        width: 80,
        height: 24,
        unicode: true,
        interactive: true,
      },
    },
    StaticFallback: {
      description:
        "Non-interactive documentation rendering of the initializer.",
      args: {
        initialName: "static-tuil-app",
        onComplete: () => undefined,
        onCancel: () => undefined,
      },
      terminal: {
        width: 80,
        height: 24,
        unicode: false,
        interactive: false,
      },
    },
  },
});
