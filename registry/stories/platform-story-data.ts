export const platformStoryVariants = Object.freeze({
  Renderer: {
    args: {
      area: "Renderer",
      detail: "Ink and Bun cell backends · 80×24 · dirty cells 12",
    },
  },
  PointerScroll: {
    args: {
      area: "Pointer and scroll",
      detail: "SGR mouse · captured drag · viewport 120/100000",
    },
  },
  Editors: {
    args: {
      area: "Editors",
      detail: "NORMAL · 3 selections · undo 8 · diagnostics 1",
    },
  },
  RichDocuments: {
    args: {
      area: "Rich documents",
      detail: "tree-native search · unknown callout node · lossless JSON",
    },
  },
  StreamingContent: {
    args: {
      area: "Streaming content",
      detail: "Markdown → transformer → table + raw projection",
    },
  },
  Logging: {
    args: {
      area: "Logging",
      detail: "LIVE · 100000 records · severity >= warn",
    },
  },
  Devtools: {
    args: {
      area: "Devtools",
      detail: "Focus tree · frames · editor · logs · action history",
    },
  },
  RegistryPlugins: {
    args: {
      area: "Registry and plugins",
      detail: "version 2.0.0 · integrity verified · upgrade available",
    },
  },
  Components: {
    args: {
      area: "Component families",
      detail: "input · navigation · data · feedback · layout",
    },
  },
  TerminalImage: {
    args: {
      area: "Terminal image",
      detail: "RGBA fixture · full color · deterministic text fallback",
    },
  },
  ProductionApps: {
    args: {
      area: "Production applications",
      detail: "Git · logs · OTEL · AI · deploy · files · workflow · docs",
    },
  },
});

export const platformBrowserStorySet = Object.freeze({
  id: "platform-expansion",
  title: "Platform/Expansion",
  stories: platformStoryVariants,
});
