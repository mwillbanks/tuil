export const initWizardStoryVariants = Object.freeze({
  Default: {
    description:
      "Complete self-hosted project initialization with routing, forms, workflow, operations, and confirmation.",
    args: {
      initialName: "my-tuil-app",
    },
    terminal: {
      width: 80,
      height: 24,
      unicode: true,
      interactive: true,
    },
  },
  StaticFallback: {
    description: "Non-interactive documentation rendering of the initializer.",
    args: {
      initialName: "static-tuil-app",
    },
    terminal: {
      width: 80,
      height: 24,
      unicode: false,
      interactive: false,
    },
  },
});

export const initWizardBrowserStorySet = Object.freeze({
  id: "init-wizard",
  title: "Application/Initializer",
  stories: initWizardStoryVariants,
});
