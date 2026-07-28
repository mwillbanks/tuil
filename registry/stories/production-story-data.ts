export const productionStoryVariants = Object.freeze({
  GitClient: { args: { application: "git-client" } },
  LogExplorer: { args: { application: "log-explorer" } },
  OpenTelemetryConsole: { args: { application: "otel-console" } },
  AiCodingAssistant: { args: { application: "ai-coding-assistant" } },
  DeploymentDashboard: { args: { application: "deployment-dashboard" } },
  FileManager: { args: { application: "file-manager" } },
  WorkflowRunner: { args: { application: "workflow-runner" } },
  DocumentationBrowser: { args: { application: "docs-browser" } },
} as const);

export const productionBrowserStorySet = Object.freeze({
  id: "production-applications",
  title: "Applications/Production",
  stories: productionStoryVariants,
});
