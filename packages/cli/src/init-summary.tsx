import {
  Alert,
  AppBar,
  AppShell,
  Heading,
  Progress,
  Stack,
  StatusBar,
  Text,
} from "@mwillbanks/tuil-ink";
import type { ReactNode } from "react";
import packageMetadata from "../package.json" with { type: "json" };
import type { Template } from "./generated-ui/blocks/init-wizard.tsx";

export interface InitSummaryProps {
  readonly name: string;
  readonly template: Template;
  readonly features: readonly string[];
  readonly completed: number;
  readonly total: number;
  readonly error?: string;
}

export function InitSummary(props: InitSummaryProps): ReactNode {
  return (
    <AppShell>
      <AppShell.AppBar>
        <AppBar>
          <Heading level={1}>tuil init</Heading>
        </AppBar>
      </AppShell.AppBar>
      <AppShell.Main>
        <Stack gap="sm">
          <Text>Project: {props.name}</Text>
          <Text>Template: {props.template}</Text>
          <Text>
            Features:{" "}
            {props.features.length > 0 ? props.features.join(", ") : "none"}
          </Text>
          <Progress value={props.completed} max={props.total} />
          {props.error ? (
            <Alert tone="danger" title="Initialization failed">
              {props.error}
            </Alert>
          ) : (
            <Alert tone="success" title="Project ready">
              Run bun start to launch the application.
            </Alert>
          )}
        </Stack>
      </AppShell.Main>
      <AppShell.StatusBar>
        <StatusBar>
          <Text>tuil {packageMetadata.version}</Text>
        </StatusBar>
      </AppShell.StatusBar>
    </AppShell>
  );
}
