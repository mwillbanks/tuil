import { useApp } from "@mwillbanks/tuil";
import { inspectRuntime } from "@mwillbanks/tuil-devtools";
import {
  Badge,
  Box,
  Button,
  Heading,
  Progress,
  Text,
} from "@mwillbanks/tuil-ink";
import {
  parseRegistryItem,
  registryCompatibilityIssues,
  registryIntegrity,
} from "@mwillbanks/tuil-registry";
import { LayoutProjection } from "@mwillbanks/tuil-renderer";
import { defineTuilStories, TuilStoryCatalog } from "@mwillbanks/tuil-story";
import { builtInFormatParsers } from "@mwillbanks/tuil-streaming";
import type { ReactNode } from "react";
import { AiCodingAssistantApplication } from "../../examples/ai-coding-assistant/src/index.tsx";
import { DeploymentDashboardApplication } from "../../examples/deployment-dashboard/src/index.tsx";
import { DocsBrowserApplication } from "../../examples/docs-browser/src/index.tsx";
import { FileManagerApplication } from "../../examples/file-manager/src/index.tsx";
import { GitClientApplication } from "../../examples/git-client/src/index.tsx";
import { LogExplorerApplication } from "../../examples/log-explorer/src/index.tsx";
import { OpenTelemetryConsoleApplication } from "../../examples/otel-console/src/index.tsx";
import { WorkflowRunnerApplication } from "../../examples/workflow-runner/src/index.tsx";
import { initWizardStories } from "../blocks/init-wizard.stories.tsx";
import { Table } from "../data-display/complex-data.tsx";
import { LogViewer } from "../data-display/log-viewer.tsx";
import { Tree } from "../data-display/tree.tsx";
import { Checkbox, Field, Select, TextInput } from "../forms/controls.tsx";
import { Tabs } from "../navigation/navigation.tsx";
import { componentAcceptanceStories } from "./component-fixtures.tsx";
import {
  dataStoryVariants,
  formStoryVariants,
  foundationStoryVariants,
  navigationStoryVariants,
} from "./ecosystem-story-data.ts";
import { platformStoryVariants } from "./platform-story-data.ts";
import { productionStoryVariants } from "./production-story-data.ts";

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

function RendererPlatformSurface(): ReactNode {
  const projection = new LayoutProjection();
  projection.upsert({
    id: "renderer-story-root",
    bounds: { x: 0, y: 0, width: 80, height: 24 },
    clip: { x: 0, y: 0, width: 80, height: 24 },
    zIndex: 0,
    focusable: false,
    pointerEvents: "none",
    semantics: { role: "application", label: "Renderer scene" },
  });
  const root = projection.get("renderer-story-root");
  return (
    <Text>
      LayoutProjection v{projection.version} · {root?.bounds.width}×
      {root?.bounds.height} · {projection.nodes().length} measured node
    </Text>
  );
}

function StreamingPlatformSurface(): ReactNode {
  const parser = builtInFormatParsers.find(
    (candidate) => candidate.id === "json",
  );
  if (!parser) throw new Error("Built-in JSON parser is unavailable");
  const document = parser.parse('{"service":{"ready":true}}', true);
  return (
    <Text>
      {parser.id} parser · {document.root.type} · complete:
      {String(document.complete)} · diagnostics:{document.diagnostics.length}
    </Text>
  );
}

function DevtoolsPlatformSurface(): ReactNode {
  const app = useApp();
  const focus = inspectRuntime(app, "Focus");
  const pointer = inspectRuntime(app, "Pointer");
  return (
    <Text>
      inspectRuntime · {focus.panel}:{focus.rows.length} ·{" "}
      {pointer.rows.join(" · ")}
    </Text>
  );
}

function RegistryPlatformSurface(): ReactNode {
  const item = parseRegistryItem({
    name: "acceptance-plugin",
    type: "plugin",
    title: "Acceptance plugin",
    description: "Registry API story fixture",
    version: "0.2.0",
    packageName: "@mwillbanks/tuil-plugin",
    ownership: "plugin",
    compatibility: { tuil: "^0.2.0", renderers: ["ink"] },
    files: [],
  });
  return (
    <Text>
      {item.name}@{item.version} · {registryIntegrity(item).slice(0, 15)}… ·
      compatibility:
      {
        registryCompatibilityIssues(item, {
          tuilVersion: "0.2.0",
          renderer: "ink",
          capabilities: new Set(),
        }).length
      }
    </Text>
  );
}

const platformSurfaces: Readonly<Record<string, () => ReactNode>> =
  Object.freeze({
    Renderer: RendererPlatformSurface,
    "Pointer and scroll": () => (
      <Button id="pointer-story-target" autoFocus>
        Click, focus, or press Enter
      </Button>
    ),
    Editors: () => (
      <TextInput
        id="editor-story"
        label="Editor buffer"
        defaultValue="const ready = true;"
        autoFocus
      />
    ),
    "Rich documents": () => (
      <Tree
        label="Rich document tree"
        defaultExpandedIds={["document", "callout"]}
        items={[
          {
            id: "document",
            label: "document",
            children: [
              {
                id: "callout",
                label: "callout (plugin)",
                children: [{ id: "callout-text", label: "Caution" }],
              },
            ],
          },
        ]}
      />
    ),
    "Streaming content": StreamingPlatformSurface,
    Logging: () => (
      <LogViewer
        label="Live records"
        height={3}
        follow
        lines={["INFO api ready", "WARN worker retry", "INFO release done"]}
      />
    ),
    Devtools: DevtoolsPlatformSurface,
    "Registry and plugins": RegistryPlatformSurface,
    "Component families": () => (
      <Box gap={1}>
        <Badge label="ready">ready</Badge>
        <Checkbox id="component-story-check" label="Enabled" defaultChecked>
          Enabled
        </Checkbox>
      </Box>
    ),
    "Production applications": () => (
      <Tree
        label="Production examples"
        items={[
          { id: "git", label: "Git client" },
          { id: "logs", label: "Log explorer" },
          { id: "otel", label: "OTEL console" },
          { id: "assistant", label: "AI coding assistant" },
        ]}
      />
    ),
  });

function PlatformStory(props: {
  readonly area: string;
  readonly detail: string;
}): ReactNode {
  const surface = platformSurfaces[props.area]?.() ?? (
    <Text>Unknown platform surface</Text>
  );
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Heading>{props.area}</Heading>
      <Text>{props.detail}</Text>
      {surface}
    </Box>
  );
}

export const platformStories = defineTuilStories({
  component: PlatformStory,
  stories: platformStoryVariants,
});

const productionApplications = {
  "git-client": GitClientApplication,
  "log-explorer": LogExplorerApplication,
  "otel-console": OpenTelemetryConsoleApplication,
  "ai-coding-assistant": AiCodingAssistantApplication,
  "deployment-dashboard": DeploymentDashboardApplication,
  "file-manager": FileManagerApplication,
  "workflow-runner": WorkflowRunnerApplication,
  "docs-browser": DocsBrowserApplication,
} as const;

function ProductionApplicationStory(props: {
  readonly application: keyof typeof productionApplications;
}): ReactNode {
  const Application = productionApplications[props.application];
  return <Application />;
}

export const productionStories = defineTuilStories({
  component: ProductionApplicationStory,
  stories: productionStoryVariants,
});

export function createEcosystemStoryCatalog(): TuilStoryCatalog {
  const catalog = new TuilStoryCatalog();
  catalog.register("foundation", "Components/Foundation", foundationStories);
  catalog.register("forms", "Components/Forms", formStories);
  catalog.register("navigation", "Components/Navigation", navigationStories);
  catalog.register("data", "Components/Complex data", dataStories);
  catalog.register("init-wizard", "Application/Initializer", initWizardStories);
  catalog.register("platform-expansion", "Platform/Expansion", platformStories);
  catalog.register(
    "component-acceptance",
    "Components/Acceptance",
    componentAcceptanceStories,
  );
  catalog.register(
    "production-applications",
    "Applications/Production",
    productionStories,
  );
  return catalog;
}

export const ecosystemStorySetIds = Object.freeze([
  "foundation",
  "forms",
  "navigation",
  "data",
  "init-wizard",
  "platform-expansion",
  "component-acceptance",
  "production-applications",
] as const);

export function StoryCatalogSummary(): ReactNode {
  return (
    <Text>
      {ecosystemStorySetIds.length} portable story sets cover foundation, forms,
      navigation, complex data, workflows, component acceptance, and platform
      expansion.
    </Text>
  );
}
