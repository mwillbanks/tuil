import {
  Badge,
  Box,
  Button,
  Heading,
  Progress,
  Text,
} from "@mwillbanks/tuil-ink";
import { defineTuilStories, TuilStoryCatalog } from "@mwillbanks/tuil-story";
import type { ReactNode } from "react";
import { initWizardStories } from "../blocks/init-wizard.stories.tsx";
import { Table } from "../data-display/complex-data.tsx";
import { LogViewer } from "../data-display/log-viewer.tsx";
import { Tree } from "../data-display/tree.tsx";
import { Checkbox, Field, Select, TextInput } from "../forms/controls.tsx";
import { Tabs } from "../navigation/navigation.tsx";
import {
  dataStoryVariants,
  formStoryVariants,
  foundationStoryVariants,
  navigationStoryVariants,
} from "./ecosystem-story-data.ts";

const languageOptions = Object.freeze([
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
] as const);

export interface FoundationStoryProps {
  readonly progress: number;
  readonly status: "running" | "complete";
}

export function FoundationStory(props: FoundationStoryProps): ReactNode {
  return (
    <Box flexDirection="column" borderStyle="round">
      <Heading>Build pipeline</Heading>
      <Badge label={props.status}>{props.status}</Badge>
      <Progress label="Build progress" value={props.progress} max={1} />
      <Button id="run-build" autoFocus>
        Run build
      </Button>
    </Box>
  );
}

export const foundationStories = defineTuilStories({
  component: FoundationStory,
  stories: foundationStoryVariants,
});

function FormStory(props: {
  readonly initialName: string;
  readonly language: "typescript" | "javascript";
}): ReactNode {
  return (
    <Box flexDirection="column">
      <Field label="Project name" required>
        <TextInput
          id="story-project"
          label="Project name"
          defaultValue={props.initialName}
          autoFocus
        />
      </Field>
      <Checkbox id="story-git" label="Initialize Git" defaultChecked>
        Initialize Git
      </Checkbox>
      <Select
        id="story-language"
        label="Language"
        options={languageOptions}
        defaultValue={props.language}
      />
    </Box>
  );
}

export const formStories = defineTuilStories({
  component: FormStory,
  stories: formStoryVariants,
});

function NavigationStory(props: {
  readonly selected: "overview" | "settings";
}): ReactNode {
  return (
    <Tabs
      id="story-navigation"
      label="Application sections"
      defaultValue={props.selected}
      items={[
        { id: "overview", label: "Overview", content: "Overview panel" },
        { id: "settings", label: "Settings", content: "Settings panel" },
      ]}
    />
  );
}

export const navigationStories = defineTuilStories({
  component: NavigationStory,
  stories: navigationStoryVariants,
});

const dataRows = Object.freeze([
  { id: "api", task: "API", status: "ready" },
  { id: "docs", task: "Docs", status: "running" },
  { id: "release", task: "Release", status: "queued" },
]);

function DataStory(props: { readonly logFilter: string }): ReactNode {
  return (
    <Box flexDirection="column">
      <Table
        id="story-table"
        label="Release tasks"
        height={3}
        width={36}
        rows={dataRows}
        getRowKey={(row) => row.id}
        columns={[
          { id: "task", header: "Task", accessor: (row) => row.task },
          { id: "status", header: "Status", accessor: (row) => row.status },
        ]}
      />
      <Tree
        id="story-tree"
        label="Files"
        height={4}
        defaultExpandedIds={["src"]}
        items={[
          {
            id: "src",
            label: "src",
            children: [
              { id: "app", label: "app.tsx" },
              { id: "theme", label: "theme.ts" },
            ],
          },
        ]}
      />
      <LogViewer
        id="story-logs"
        label="Build logs"
        height={3}
        filter={props.logFilter}
        lines={["compile complete", "tests passed", "release ready"]}
      />
    </Box>
  );
}

export const dataStories = defineTuilStories({
  component: DataStory,
  stories: dataStoryVariants,
});

export function createEcosystemStoryCatalog(): TuilStoryCatalog {
  const catalog = new TuilStoryCatalog();
  catalog.register("foundation", "Components/Foundation", foundationStories);
  catalog.register("forms", "Components/Forms", formStories);
  catalog.register("navigation", "Components/Navigation", navigationStories);
  catalog.register("data", "Components/Complex data", dataStories);
  catalog.register("init-wizard", "Application/Initializer", initWizardStories);
  return catalog;
}

export const ecosystemStorySetIds = Object.freeze([
  "foundation",
  "forms",
  "navigation",
  "data",
  "init-wizard",
] as const);

export function StoryCatalogSummary(): ReactNode {
  return (
    <Text>
      {ecosystemStorySetIds.length} portable story sets cover foundation, forms,
      navigation, complex data, and workflows.
    </Text>
  );
}
