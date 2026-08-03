import { Box, Text } from "@mwillbanks/tuil-ink";
import type { ReactNode } from "react";

function FixtureApplication(props: { readonly title: string }): ReactNode {
  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>{props.title}</Text>
      <Text color="cyan">Browser fixture adapter</Text>
      <Text>Host filesystem, subprocess, and network access are disabled.</Text>
    </Box>
  );
}

export const AiCodingAssistantApplication = () => (
  <FixtureApplication title="AI coding assistant" />
);
export const DeploymentDashboardApplication = () => (
  <FixtureApplication title="Deployment dashboard" />
);
export const DocsBrowserApplication = () => (
  <FixtureApplication title="Documentation browser" />
);
export const FileManagerApplication = () => (
  <FixtureApplication title="File manager" />
);
export const GitClientApplication = () => (
  <FixtureApplication title="Git client" />
);
export const LogExplorerApplication = () => (
  <FixtureApplication title="Log explorer" />
);
export const OpenTelemetryConsoleApplication = () => (
  <FixtureApplication title="OpenTelemetry console" />
);
export const WorkflowRunnerApplication = () => (
  <FixtureApplication title="Workflow runner" />
);
