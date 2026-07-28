import {
  access,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import {
  createApp,
  defineConfig,
  type RenderMode,
  type TuilConfig,
} from "@mwillbanks/tuil";
import { renderStatic } from "@mwillbanks/tuil-ink";
import {
  FileRegistrySource,
  HttpRegistrySource,
  type InstallResult,
  RegistryClient,
  RegistryInstaller,
  type RegistryItem,
  type RegistryItemType,
  type RegistrySource,
} from "@mwillbanks/tuil-registry";
import packageMetadata from "../package.json" with { type: "json" };
import { BundledRegistrySource } from "./bundled-source.ts";
import {
  type Feature,
  features,
  type InitAnswers,
  InitWizard,
  type Template,
  templates,
} from "./generated-ui/blocks/init-wizard.tsx";
import { InitSummary } from "./init-summary.tsx";
import { runInitializerSetup } from "./initializer-process.ts";
import { promptInit } from "./prompt-init.tsx";
import { installRegistryDependencies } from "./registry-dependencies.ts";

export type { InitAnswers };
export { InitWizard };

const defaultConfig = defineConfig({
  renderer: "ink",
  paths: {
    components: "./src/components/tuil",
    utilities: "./src/lib",
    hooks: "./src/hooks",
  },
  registry: {
    sources: ["https://registry.tuil.dev"],
  },
  theme: {
    preset: "default",
  },
  packageManager: "bun",
});

function registryInstallEnvironment(renderer: TuilConfig["renderer"]) {
  return {
    renderer,
    capabilities: new Set([
      "pointer",
      "scroll",
      "clipboard",
      "alternate-screen",
      "inline",
      "static",
      "json",
      "silent",
      "embedded",
    ]),
    tuilVersion: packageMetadata.version,
  } as const;
}

const componentExports = {
  box: "Box",
  stack: "Stack",
  container: "Container",
  text: "Text",
  heading: "Heading",
  divider: "Divider",
  button: "Button",
  badge: "Badge",
  spinner: "Spinner",
  progress: "Progress",
  alert: "Alert",
  "app-shell": "AppShell",
  "app-bar": "AppBar",
  "status-bar": "StatusBar",
  field: "Field, Form, ValidationSummary",
  "text-input": "TextInput",
  "text-area": "TextArea",
  "number-input": "NumberInput",
  checkbox: "Checkbox",
  "radio-group": "RadioGroup",
  switch: "Switch",
  select: "Select",
  "multi-select": "MultiSelect",
  autocomplete: "Autocomplete",
  dialog: "Dialog",
  "confirm-dialog": "ConfirmDialog",
  tooltip: "Tooltip",
  toast: "Toast",
  "command-palette": "CommandPalette",
  tabs: "Tabs",
  menu: "Menu",
  menubar: "Menubar",
  breadcrumbs: "Breadcrumbs",
  stepper: "Stepper",
  workflow: "Workflow",
  "operation-list": "OperationList",
  "operation-tree": "OperationTree",
  "splash-screen": "SplashScreen",
  "help-overlay": "HelpOverlay",
  "init-wizard": "InitWizard",
  table: "Table",
  "data-table": "DataTable",
  tree: "Tree",
  "transfer-list": "TransferList",
  "log-viewer": "LogViewer",
  "diff-viewer": "DiffViewer",
  "json-viewer": "JsonViewer",
  "virtual-list": "VirtualList",
  "split-pane": "SplitPane",
  "resizable-pane": "ResizablePane",
} as const;

const componentBarrelOwners: Readonly<Record<string, string>> = {
  "text-input": "field",
  "text-area": "field",
  "number-input": "field",
  checkbox: "field",
  "radio-group": "field",
  switch: "field",
  select: "field",
  "multi-select": "field",
  autocomplete: "field",
  "confirm-dialog": "dialog",
  tooltip: "dialog",
  toast: "dialog",
  "command-palette": "dialog",
  menu: "tabs",
  menubar: "tabs",
  breadcrumbs: "tabs",
  stepper: "tabs",
  "data-table": "table",
  "operation-list": "workflow",
  "operation-tree": "workflow",
  "splash-screen": "workflow",
  "help-overlay": "workflow",
};

const templateComponents: Readonly<Record<Template, readonly string[]>> = {
  minimal: ["text"],
  application: ["app-shell", "heading", "status-bar", "stack", "text"],
  dashboard: [
    "app-shell",
    "badge",
    "heading",
    "progress",
    "stack",
    "status-bar",
    "text",
  ],
  wizard: [
    "app-shell",
    "button",
    "heading",
    "progress",
    "stack",
    "status-bar",
    "text",
  ],
  "command-center": [
    "app-shell",
    "button",
    "heading",
    "stack",
    "status-bar",
    "text",
  ],
  plugin: ["app-shell", "heading", "stack", "status-bar", "text"],
  "component-library": Object.keys(componentExports),
};

interface ParsedArguments {
  readonly command: string;
  readonly operands: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const command = argv[0] ?? "help";
  const operands: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (!argument.startsWith("--")) {
      operands.push(argument);
      continue;
    }
    const [rawName, inlineValue] = argument.slice(2).split("=", 2);
    if (!rawName) continue;
    if (inlineValue !== undefined) {
      flags.set(rawName, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(rawName, next);
      index += 1;
    } else {
      flags.set(rawName, true);
    }
  }
  return { command, operands, flags };
}

function flag(
  args: ParsedArguments,
  name: string,
): string | boolean | undefined {
  return args.flags.get(name);
}

function outputMode(args: ParsedArguments): RenderMode {
  const value = flag(args, "output");
  if (
    value === "interactive" ||
    value === "static" ||
    value === "json" ||
    value === "silent"
  ) {
    return value;
  }
  return process.stdout.isTTY ? "interactive" : "static";
}

function output(value: unknown, mode: RenderMode): void {
  if (mode === "silent") return;
  if (mode === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`,
  );
}

async function renderSummary(
  props: Parameters<typeof InitSummary>[0],
  mode: RenderMode,
): Promise<void> {
  if (mode === "json" || mode === "silent") {
    output(
      {
        project: props.name,
        template: props.template,
        features: props.features,
        completed: props.completed,
        total: props.total,
        error: props.error,
      },
      mode,
    );
    return;
  }
  const app = createApp({
    component: () => <InitSummary {...props} />,
    terminal: { mode: "static" },
  });
  output(await renderStatic(app), mode);
  await app.stop();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function validateTarget(target: string, force: boolean): Promise<void> {
  const root = resolve(target);
  const parsed = resolve("/");
  if (root === parsed || root === resolve(process.cwd())) {
    throw new Error(
      "Refusing to initialize into a filesystem or workspace root",
    );
  }
  if (!(await pathExists(root))) {
    return;
  }
  const entries = await readdir(root);
  if (entries.length > 0 && !force) {
    throw new Error(
      `Target directory "${root}" is not empty. Use --force only when its contents may be preserved.`,
    );
  }
}

function templateAppSource(
  name: string,
  template: Template,
  enabledFeatures: readonly Feature[],
): string {
  const featureText =
    enabledFeatures.length > 0 ? enabledFeatures.join(", ") : "foundation";
  if (template === "minimal") {
    return `import {Text} from "../components/tuil/index.ts";

export function App() {
  return <Text>${name}</Text>;
}
`;
  }
  if (template === "dashboard") {
    return `import {AppShell, Badge, Heading, Progress, Stack, StatusBar, Text} from "../components/tuil/index.ts";

export function App() {
  return (
    <AppShell>
      <AppShell.Main>
        <Stack>
          <Heading>Dashboard</Heading>
          <Badge tone="success">Healthy</Badge>
          <Progress value={72} label="Deployment progress" />
          <Text>Features: ${featureText}</Text>
        </Stack>
      </AppShell.Main>
      <AppShell.StatusBar><StatusBar><Text>All systems operational</Text></StatusBar></AppShell.StatusBar>
    </AppShell>
  );
}
`;
  }
  if (template === "wizard") {
    return `import {useState} from "react";
import {AppShell, Button, Heading, Progress, Stack, StatusBar, Text} from "../components/tuil/index.ts";

const steps = ["Configure", "Review", "Complete"] as const;

export function App() {
  const [step, setStep] = useState(0);
  return (
    <AppShell>
      <AppShell.Main>
        <Stack>
          <Heading>Project Wizard</Heading>
          <Text>{steps[step]}</Text>
          <Progress value={step + 1} max={steps.length} />
          <Button
            id="wizard-next"
            autoFocus
            disabled={step === steps.length - 1}
            onPress={() => setStep((current) => Math.min(current + 1, steps.length - 1))}
          >
            Next
          </Button>
        </Stack>
      </AppShell.Main>
      <AppShell.StatusBar><StatusBar><Text>Step {step + 1} of {steps.length}</Text></StatusBar></AppShell.StatusBar>
    </AppShell>
  );
}
`;
  }
  if (template === "command-center") {
    return `import {useState} from "react";
import {AppShell, Button, Heading, Stack, StatusBar, Text} from "../components/tuil/index.ts";

export function App() {
  const [activity, setActivity] = useState("Awaiting command");
  return (
    <AppShell>
      <AppShell.Main>
        <Stack>
          <Heading>Command Center</Heading>
          <Button id="deploy" autoFocus hotkeys={["d"]} onPress={() => setActivity("Deployment requested")}>Deploy</Button>
          <Button id="inspect" hotkeys={["i"]} onPress={() => setActivity("Inspection requested")}>Inspect</Button>
          <Text>{activity}</Text>
        </Stack>
      </AppShell.Main>
      <AppShell.StatusBar><StatusBar><Text>d deploy · i inspect</Text></StatusBar></AppShell.StatusBar>
    </AppShell>
  );
}
`;
  }
  if (template === "component-library") {
    return `import {Alert, AppBar, AppShell, Badge, Box, Breadcrumbs, Button, Checkbox, Container, Dialog, Divider, Field, Heading, JsonViewer, Progress, Select, Spinner, SplitPane, Stack, StatusBar, Stepper, Table, Tabs, Text, TextInput, Tooltip, Tree, VirtualList} from "../components/tuil/index.ts";

const catalogSections = [
  {id: "foundation", label: "Foundation", content: "Layout and typography"},
  {id: "forms", label: "Forms", content: "Validated terminal input"},
] as const;
const componentRows = [
  {id: "table", category: "data"},
  {id: "tree", category: "data"},
] as const;

export function App() {
  return (
    <AppShell>
      <AppShell.AppBar><AppBar><Heading>Component Library</Heading></AppBar></AppShell.AppBar>
      <AppShell.Main>
        <Container>
          <Stack>
            <Box><Text>Foundational catalog</Text></Box>
            <Divider />
            <Badge tone="success">ready</Badge>
            <Progress value={75} />
            <Spinner label="Rendering" />
            <Alert tone="info" title="Portable stories">Components are project-owned source.</Alert>
            <Field label="Search components"><TextInput id="component-search" label="Search components" /></Field>
            <Checkbox id="interactive-components">Interactive components</Checkbox>
            <Select id="component-category" label="Component category" options={[{value: "forms", label: "Forms"}, {value: "feedback", label: "Feedback"}]} />
            <Breadcrumbs items={[{id: "catalog", label: "Catalog"}, {id: "components", label: "Components"}]} />
            <Tabs id="catalog-sections" items={catalogSections} />
            <Stepper steps={[{id: "install", label: "Install", status: "completed"}, {id: "customize", label: "Customize", status: "current"}, {id: "ship", label: "Ship"}]} current="customize" />
            <Table id="component-table" label="Components" rows={componentRows} getRowKey={(row) => row.id} columns={[{id: "id", header: "Component", accessor: (row) => row.id}, {id: "category", header: "Category", accessor: (row) => row.category}]} />
            <Tree id="component-tree" label="Component groups" items={[{id: "display", label: "Data display", children: [{id: "table", label: "Table"}, {id: "tree", label: "Tree"}]}]} defaultExpandedIds={["display"]} />
            <VirtualList id="component-list" label="Virtualized component list" items={componentRows} getItemKey={(item) => item.id} getItemLabel={(item) => item.id} renderItem={(item) => item.id} height={2} />
            <JsonViewer id="component-metadata" label="Component metadata" value={{count: ${Object.keys(componentExports).length}, ownership: "project"}} height={4} />
            <SplitPane id="catalog-panes" label="Catalog panes" defaultSizes={[50, 50]} panes={[{id: "preview", content: <Text>Preview</Text>}, {id: "source", content: <Text>Source</Text>}]} />
            <Tooltip targetId="inspect-component" content="Open the selected component">
            <Button id="inspect-component" autoFocus>Inspect</Button>
            </Tooltip>
            <Dialog><Dialog.Trigger>Preview dialog</Dialog.Trigger><Dialog.Content><Dialog.Title>Component preview</Dialog.Title></Dialog.Content></Dialog>
          </Stack>
        </Container>
      </AppShell.Main>
      <AppShell.StatusBar><StatusBar><Text>${Object.keys(componentExports).length} components</Text></StatusBar></AppShell.StatusBar>
    </AppShell>
  );
}
`;
  }
  const heading = template === "plugin" ? "Plugin Workspace" : name;
  return `import {AppShell, Heading, Stack, StatusBar, Text} from "../components/tuil/index.ts";

export function App() {
  return (
    <AppShell>
      <AppShell.Main>
        <Stack>
          <Heading>${heading}</Heading>
          <Text>Features: ${featureText}</Text>
        </Stack>
      </AppShell.Main>
      <AppShell.StatusBar><StatusBar><Text>Ready</Text></StatusBar></AppShell.StatusBar>
    </AppShell>
  );
}
`;
}

function projectFiles(
  name: string,
  template: Template,
  enabledFeatures: readonly Feature[],
  themePreset: string,
): Readonly<Record<string, string>> {
  const formsEnabled =
    enabledFeatures.includes("forms") || template === "component-library";
  const routerEnabled =
    enabledFeatures.includes("router") || template === "component-library";
  const workflowEnabled =
    enabledFeatures.includes("workflow") || template === "component-library";
  const dependencies: Record<string, string> = {
    "@mwillbanks/tuil": "^0.2.0",
    "@mwillbanks/tuil-core": "^0.2.0",
    "@mwillbanks/tuil-focus": "^0.2.0",
    "@mwillbanks/tuil-hotkeys": "^0.2.0",
    "@mwillbanks/tuil-ink": "^0.2.0",
    "@mwillbanks/tuil-theme": "^0.2.0",
    ink: "^7.1.0",
    react: "^19.0.0",
  };
  if (formsEnabled) {
    dependencies["@mwillbanks/tuil-form"] = "^0.2.0";
    dependencies["@tanstack/react-form"] = "^1.33.2";
  }
  if (routerEnabled) {
    dependencies["@mwillbanks/tuil-router"] = "^0.2.0";
  }
  if (workflowEnabled) {
    dependencies["@mwillbanks/tuil-operations"] = "^0.2.0";
    dependencies["@mwillbanks/tuil-workflow"] = "^0.2.0";
  }
  if (template === "component-library") {
    dependencies["@tanstack/react-table"] = "^8.21.3";
    dependencies["@mwillbanks/tuil-virtual"] = "^0.2.0";
    dependencies["diff"] = "^9.0.0";
    dependencies["react-dom"] = "^19.2.8";
  }
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(
      {
        name,
        private: true,
        type: "module",
        scripts: {
          start: "bun src/index.tsx",
          typecheck: "tsc --noEmit",
          test: "bun test",
        },
        dependencies,
        devDependencies: {
          "@types/bun": "latest",
          "@types/react": "^19.0.0",
          typescript: "^7.0.0",
        },
      },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ESNext"],
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          types: ["bun", "react"],
        },
        include: [
          "src/**/*.ts",
          "src/**/*.tsx",
          "tests/**/*.ts",
          "tests/**/*.tsx",
        ],
      },
      null,
      2,
    )}\n`,
    "tuil.config.ts": `import {defineConfig} from "@mwillbanks/tuil";\n\nexport default defineConfig(${JSON.stringify(
      {
        ...defaultConfig,
        theme: { preset: themePreset },
      },
      null,
      2,
    )});\n`,
    "src/index.tsx": `import {createApp${template === "plugin" ? ", type TuilExtensionPoints" : ""}} from "@mwillbanks/tuil";\nimport {render} from "@mwillbanks/tuil-ink";\nimport {App} from "./app/app.tsx";\nimport {FeaturePanels} from "./features/index.tsx";\nimport {theme} from "./lib/theme.ts";\n${template === "plugin" ? 'import {examplePlugin} from "./plugins/example.ts";\n' : ""}\nfunction Root() {\n  return <><App /><FeaturePanels /></>;\n}\n\nconst instance = await render(createApp${template === "plugin" ? "<Record<string, never>, Record<string, never>, TuilExtensionPoints>" : ""}({\n  component: Root,\n  theme,\n  ${template === "plugin" ? "plugins: [examplePlugin]," : ""}\n}));\nawait instance.waitUntilExit();\n`,
    "src/app/app.tsx": templateAppSource(name, template, enabledFeatures),
    "src/app/commands.ts": `import {defineCommand} from "@mwillbanks/tuil";\n\nexport const quitCommand = defineCommand({\n  id: "app.quit",\n  title: "Quit",\n  hotkeys: ["ctrl+c"],\n  execute() {\n    process.exitCode = 0;\n  },\n});\n`,
    "src/app/events.ts": `import {defineEvents, event} from "@mwillbanks/tuil";\n\nexport const events = defineEvents({\n  "app:message": event<{message: string}>(),\n});\n`,
    "src/app/routes.ts": routerEnabled
      ? `import {createRouter, defineRoutes, route} from "@mwillbanks/tuil-router";\n\nexport const routeDefinitions = defineRoutes({\n  home: route({component: "Home"}),\n  settings: route({\n    component: "Settings",\n    loader: async ({signal}) => {\n      signal.throwIfAborted();\n      return {ready: true};\n    },\n  }),\n});\n\nexport const router = createRouter(routeDefinitions);\nexport const routes = [\n  {id: "home", title: "Home"},\n  {id: "settings", title: "Settings"},\n] as const;\n`
      : `export interface ApplicationRoute {\n  readonly id: string;\n  readonly title: string;\n}\n\nexport const routes = [\n  {id: "home", title: "Home"},\n] as const satisfies readonly ApplicationRoute[];\n`,
    "src/app/theme.ts": `export {theme} from "../lib/theme.ts";\n`,
    "tests/app.test.ts": `import {expect, test} from "bun:test";\nimport {routes} from "../src/app/routes.ts";\n\ntest("project is configured", () => {\n  expect(${JSON.stringify(name)}).not.toBeEmpty();\n  expect(routes[0]?.id).toBe("home");\n});\n`,
  };
  const featureImports = [
    formsEnabled ? 'import {ProjectForm} from "./project-form.tsx";' : "",
    routerEnabled ? 'import {RouterPanel} from "./router-panel.tsx";' : "",
    workflowEnabled
      ? 'import {Text, Workflow} from "../components/tuil/index.ts";\nimport {projectWorkflow} from "../workflows/main.ts";'
      : formsEnabled
        ? 'import {Text} from "../components/tuil/index.ts";'
        : "",
  ]
    .filter(Boolean)
    .join("\n");
  const featurePanels = [
    formsEnabled
      ? "<Text>Project setup</Text><ProjectForm onSubmit={() => undefined} />"
      : "",
    routerEnabled ? "<RouterPanel />" : "",
    workflowEnabled
      ? "<Workflow workflow={projectWorkflow}><Workflow.Stepper /><Workflow.Content /><Workflow.Errors /><Workflow.Operations expandable showDuration showAttempts /><Workflow.Actions showSkip /></Workflow>"
      : "",
  ]
    .filter(Boolean)
    .join("");
  files["src/features/index.tsx"] =
    featurePanels.length > 0
      ? `${featureImports}\n\nexport function FeaturePanels() {\n  return <>${featurePanels}</>;\n}\n`
      : `export function FeaturePanels() {\n  return null;\n}\n`;
  if (formsEnabled) {
    files["src/features/project-form.tsx"] =
      `import {adaptTanStackField, useForm} from "@mwillbanks/tuil-form";\nimport {Button, Field, Form, TextInput, ValidationSummary} from "../components/tuil/index.ts";\n\nexport interface ProjectFormValues {\n  readonly name: string;\n  readonly description: string;\n}\n\nexport function ProjectForm(props: {readonly onSubmit: (values: ProjectFormValues) => void | Promise<void>}) {\n  const form = useForm({\n    defaultValues: {name: "", description: ""},\n    onSubmit: ({value}) => props.onSubmit(value),\n  });\n  return (\n    <Form id="project-form" onSubmit={() => form.handleSubmit()}>\n      <form.Field\n        name="name"\n        validators={{onSubmit: ({value}) => value.trim() ? undefined : "Project name is required"}}\n      >\n        {(field) => {\n          const terminalField = adaptTanStackField(field);\n          return (\n            <Field label="Project name" field={terminalField} required>\n              <TextInput\n                id={field.name}\n                label="Project name"\n                field={terminalField}\n                autoFocus\n              />\n            </Field>\n          );\n        }}\n      </form.Field>\n      <ValidationSummary />\n      <Button command="project-form.submit">Create</Button>\n    </Form>\n  );\n}\n`;
  }
  if (routerEnabled) {
    files["src/features/router-panel.tsx"] =
      `import {useEffect, useSyncExternalStore} from "react";\nimport {Breadcrumbs, Tabs, Text} from "../components/tuil/index.ts";\nimport {router, routes} from "../app/routes.ts";\n\nexport function RouterPanel() {\n  const state = useSyncExternalStore(\n    (notify) => router.subscribe(notify),\n    () => router.state,\n    () => router.state,\n  );\n  useEffect(() => {\n    if (!router.state.location) {\n      void router.navigate({to: "home"}).catch(() => undefined);\n    }\n  }, []);\n  const current = state.location?.route ?? "home";\n  return (\n    <>\n      <Breadcrumbs items={routes.map((item) => ({id: item.id, label: item.title, current: item.id === current}))} />\n      <Tabs\n        id="application-routes"\n        items={routes.map((item) => ({id: item.id, label: item.title, content: item.title}))}\n        value={current}\n        onValueChange={async (to) => {\n          if (to === "home" || to === "settings") await router.navigate({to});\n        }}\n      />\n      {state.error ? <Text>Navigation error: {String(state.error)}</Text> : null}\n    </>\n  );\n}\n`;
  }
  if (workflowEnabled) {
    files["src/workflows/main.ts"] =
      `import {defineOperation} from "@mwillbanks/tuil-operations";\nimport {createWorkflow, defineOperationStep, defineStep, defineWorkflow, transition} from "@mwillbanks/tuil-workflow";\n\nconst provision = defineOperation({\n  id: "project.provision",\n  title: "Provision project",\n  async run({signal, updateProgress}) {\n    signal.throwIfAborted();\n    updateProgress({current: 1, total: 1, message: "Ready"});\n    return {created: true};\n  },\n});\n\nexport const projectWorkflow = createWorkflow(defineWorkflow({\n  id: "project.create",\n  version: 1,\n  initialState: {approved: false},\n  steps: {\n    configure: defineStep({title: "Configure", component: "Configure the project", help: "Choose project settings."}),\n    review: defineStep({title: "Review", component: "Review the selected settings"}),\n    complete: defineOperationStep({title: "Create", operations: [provision]}),\n  },\n  transitions: [transition("configure", "review"), transition("review", "complete")],\n}));\n`;
  }
  if (template === "plugin") {
    files["src/plugins/example.ts"] =
      `import {createPlugin, type TuilExtensionPoints} from "@mwillbanks/tuil";\n\nexport const examplePlugin = createPlugin<Record<string, never>, TuilExtensionPoints>({\n  id: "example",\n  version: "0.1.0",\n  setup(context) {\n    return context.registry.register({\n      id: "example.status",\n      title: "Example plugin status",\n    });\n  },\n});\n`;
  }
  return files;
}

function parseTemplate(value: unknown): Template {
  if (typeof value !== "string" || !templates.includes(value as Template)) {
    throw new Error(
      `Unknown template "${String(value)}". Expected one of: ${templates.join(", ")}`,
    );
  }
  return value as Template;
}

function validateProjectName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(
      `Invalid project name "${name}". Use lowercase letters, numbers, dots, underscores, or hyphens.`,
    );
  }
}

async function writeComponentBarrel(
  target: string,
  plan: readonly RegistryItem[],
): Promise<void> {
  const base = "src/components/tuil";
  const exports = plan.flatMap((item) => {
    const exportName =
      componentExports[item.name as keyof typeof componentExports];
    if (!exportName) return [];
    const owner = componentBarrelOwners[item.name];
    const file =
      item.files[0] ??
      (owner
        ? plan.find((candidate) => candidate.name === owner)?.files[0]
        : undefined);
    if (!file) return [];
    const modulePath = relative(base, file.target).replaceAll("\\", "/");
    return [
      `export {${exportName}} from "${modulePath.startsWith(".") ? modulePath : `./${modulePath}`}";`,
    ];
  });
  await writeFile(
    join(target, base, "index.ts"),
    `${[...new Set(exports)].sort().join("\n")}\n`,
    "utf8",
  );
}

async function validateGeneratedSources(target: string): Promise<void> {
  const entries = await readdir(target, {
    recursive: true,
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const transpiler = new Bun.Transpiler({
      loader: entry.name.endsWith(".tsx") ? "tsx" : "ts",
      target: "bun",
    });
    try {
      transpiler.transformSync(await readFile(path, "utf8"));
    } catch (error) {
      throw new Error(`Generated source validation failed for "${path}"`, {
        cause: error,
      });
    }
  }
}

interface InitContext {
  readonly prompted: Awaited<ReturnType<typeof promptInit>>;
  readonly target: string;
  readonly projectName: string;
  readonly themePreset: string;
  readonly plan: Awaited<ReturnType<RegistryClient["resolvePlan"]>>;
  readonly targetExisted: boolean;
  readonly workingTarget: string;
  readonly transaction: string;
}

async function initContext(args: ParsedArguments): Promise<InitContext> {
  const interactive = process.stdin.isTTY && !flag(args, "template");
  const prompted = interactive
    ? await promptInit(args.operands[0])
    : {
        name: args.operands[0] ?? "my-tuil-app",
        template: parseTemplate(flag(args, "template") ?? "application"),
        features: features.filter((feature) => Boolean(flag(args, feature))),
      };
  const target = isAbsolute(prompted.name)
    ? prompted.name
    : resolve(process.cwd(), prompted.name);
  const projectName = basename(target);
  validateProjectName(projectName);
  const themePreset = String(flag(args, "theme") ?? "default");
  const requestedItems = initRegistryItems(
    prompted.template,
    prompted.features,
    themePreset,
  );
  const plan = await new RegistryClient([
    new BundledRegistrySource(),
  ]).resolvePlan(requestedItems);
  await validateTarget(target, Boolean(flag(args, "force")));
  const transaction = crypto.randomUUID();
  return {
    prompted,
    target,
    projectName,
    themePreset,
    plan,
    targetExisted: await pathExists(target),
    workingTarget: join(
      dirname(target),
      `.${basename(target)}.tuil-init-${transaction}`,
    ),
    transaction,
  };
}

function initRegistryItems(
  template: keyof typeof templateComponents,
  selectedFeatures: readonly string[],
  themePreset: string,
): readonly string[] {
  return [
    ...templateComponents[template],
    ...(selectedFeatures.includes("forms")
      ? ["button", "field", "text-input"]
      : []),
    ...(selectedFeatures.includes("router") ? ["tabs", "breadcrumbs"] : []),
    ...(selectedFeatures.includes("workflow")
      ? ["workflow", "operation-list", "stepper"]
      : []),
    themePreset,
  ];
}

async function prepareInitWorkspace(context: InitContext): Promise<void> {
  if (context.targetExisted) {
    await cp(context.target, context.workingTarget, {
      recursive: true,
      errorOnExist: true,
    });
  } else {
    await mkdir(context.workingTarget, { recursive: true });
  }
}

async function writeInitWorkspace(
  context: InitContext,
  force: boolean,
): Promise<void> {
  const files = projectFiles(
    context.projectName,
    context.prompted.template,
    context.prompted.features,
    context.themePreset,
  );
  for (const [path, content] of Object.entries(files)) {
    const destination = join(context.workingTarget, path);
    if ((await pathExists(destination)) && !force) {
      throw new Error(`Refusing to overwrite existing file "${destination}"`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  await Promise.all(
    ["components/tuil", "features", "workflows", "plugins", "stores"].map(
      (path) =>
        mkdir(join(context.workingTarget, "src", path), { recursive: true }),
    ),
  );
  await new RegistryInstaller(context.workingTarget).installMany(context.plan, {
    componentDirectory: "./src/components/tuil",
    force,
    environment: registryInstallEnvironment(defaultConfig.renderer),
  });
  await writeComponentBarrel(context.workingTarget, context.plan);
  await validateGeneratedSources(context.workingTarget);
}

async function promoteInitWorkspace(context: InitContext): Promise<void> {
  if (!context.targetExisted) {
    await rename(context.workingTarget, context.target);
    return;
  }
  const backup = join(
    dirname(context.target),
    `.${basename(context.target)}.tuil-backup-${context.transaction}`,
  );
  await rename(context.target, backup);
  try {
    await rename(context.workingTarget, context.target);
  } catch (error) {
    await rename(backup, context.target);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

async function runInit(args: ParsedArguments): Promise<void> {
  const mode = outputMode(args);
  const context = await initContext(args);
  try {
    await prepareInitWorkspace(context);
    await writeInitWorkspace(context, Boolean(flag(args, "force")));
    await runInitializerSetup({
      cwd: context.workingTarget,
      quiet: mode === "silent" || mode === "json",
      install: Boolean(flag(args, "install")),
      git: Boolean(flag(args, "git")),
    });
    await promoteInitWorkspace(context);
  } catch (error) {
    await rm(context.workingTarget, { recursive: true, force: true });
    throw error;
  }
  await renderSummary(
    {
      name: basename(context.target),
      template: context.prompted.template,
      features: context.prompted.features,
      completed: 10,
      total: 10,
    },
    mode,
  );
}

async function loadConfig(root: string): Promise<TuilConfig> {
  const path = join(root, "tuil.config.ts");
  if (!(await pathExists(path))) return defaultConfig;
  const module = (await import(`${path}?t=${Date.now()}`)) as {
    default?: TuilConfig;
  };
  return module.default ?? defaultConfig;
}

async function resolveRegistryClient(
  root: string,
  config: TuilConfig,
): Promise<RegistryClient> {
  const sources: RegistrySource[] = [new BundledRegistrySource()];
  for (const [index, source] of config.registry.sources.entries()) {
    const location = typeof source === "string" ? source : source.url;
    const id =
      typeof source === "string"
        ? index === 0
          ? "tuil"
          : `source-${index}`
        : source.id;
    if (id === "tuil") continue;
    if (location.startsWith("http://") || location.startsWith("https://")) {
      sources.push(new HttpRegistrySource(id, location));
    } else {
      sources.push(new FileRegistrySource(id, resolve(root, location)));
    }
  }
  return new RegistryClient(sources);
}

async function registryCommand(args: ParsedArguments): Promise<void> {
  const root = process.cwd();
  const mode = outputMode(args);
  const config = await loadConfig(root);
  const client = await resolveRegistryClient(root, config);
  const installer = new RegistryInstaller(root);
  if (args.command === "list") {
    output(await client.list(), mode);
    return;
  }
  if (args.command === "search") {
    output(await client.search(args.operands.join(" ")), mode);
    return;
  }
  if (args.command === "registry") {
    output(
      {
        sources: config.registry.sources,
        installed: await installer.installed(),
      },
      mode,
    );
    return;
  }
  const names = args.operands;
  if (names.length === 0) {
    throw new Error(`${args.command} requires at least one component name`);
  }
  if (args.command === "remove") {
    const removals = await installer.removeMany(
      names,
      Boolean(flag(args, "force")),
    );
    for (const removal of removals) {
      output(removal, mode);
    }
    return;
  }
  const plan = await client.resolvePlan(names);
  if (args.command === "diff") {
    for (const item of plan) {
      output(
        {
          name: item.registryName ?? item.name,
          files: await installer.diff(item),
        },
        mode,
      );
    }
    return;
  }
  const biome = join(root, "node_modules/.bin/biome");
  const formatter = (await pathExists(biome))
    ? async (content: string, target: string) => {
        const process = Bun.spawn(
          [biome, "format", "--stdin-file-path", target],
          {
            cwd: root,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        process.stdin.write(content);
        process.stdin.end();
        const [formatted, error, exitCode] = await Promise.all([
          new Response(process.stdout).text(),
          new Response(process.stderr).text(),
          process.exited,
        ]);
        if (exitCode !== 0) {
          throw new Error(`Formatter failed for "${target}": ${error.trim()}`);
        }
        return formatted;
      }
    : undefined;
  const installOptions = {
    componentDirectory: config.paths.components,
    force: Boolean(flag(args, "force")),
    format: formatter,
    frozenLockfile: Boolean(flag(args, "frozen-lockfile")),
    environment: registryInstallEnvironment(config.renderer),
  } as const;
  await installer.verify(plan, installOptions);
  let rollbackDependencies: (() => Promise<void>) | undefined;
  if (
    (args.command === "add" || args.command === "update") &&
    !flag(args, "no-install")
  ) {
    const dependencies = [
      ...new Set(
        plan.flatMap((item) => [
          ...(item.dependencies ?? []),
          ...(item.packageName ? [item.packageName] : []),
        ]),
      ),
    ];
    if (dependencies.length > 0) {
      if (!(await pathExists(join(root, "package.json")))) {
        throw new Error(
          "Registry package dependencies require a package.json; use --no-install only when dependencies are managed separately",
        );
      }
      rollbackDependencies = await installRegistryDependencies(
        root,
        dependencies,
        mode,
      );
    }
  }
  let results: readonly InstallResult[];
  try {
    results = await installer.installMany(plan, installOptions);
  } catch (error) {
    if (!rollbackDependencies) throw error;
    try {
      await rollbackDependencies();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Registry source and dependency transaction rollback failed",
      );
    }
    throw error;
  }
  for (const result of results) {
    output(result, mode);
  }
}

async function doctor(args: ParsedArguments): Promise<void> {
  const mode = outputMode(args);
  const root = process.cwd();
  const checks = {
    bun: Bun.version,
    packageJson: await pathExists(join(root, "package.json")),
    config: await pathExists(join(root, "tuil.config.ts")),
    writable: true,
  };
  try {
    await stat(root);
  } catch {
    checks.writable = false;
  }
  output({ ok: Object.values(checks).every(Boolean), checks }, mode);
}

async function showInfo(args: ParsedArguments): Promise<void> {
  const config = await loadConfig(process.cwd());
  output(
    {
      name: "@mwillbanks/tuil",
      version: "0.2.0",
      runtime: `Bun ${Bun.version}`,
      platform: process.platform,
      renderer: config.renderer,
      config,
    },
    outputMode(args),
  );
}

async function copyTheme(args: ParsedArguments): Promise<void> {
  const preset = args.operands[0] ?? "default";
  const [config, item] = await Promise.all([
    loadConfig(process.cwd()),
    new RegistryClient([new BundledRegistrySource()]).get(preset),
  ]);
  if (item.type !== "theme") {
    throw new Error(`Theme preset "${preset}" was not found`);
  }
  const [result] = await new RegistryInstaller(process.cwd()).installMany(
    [
      {
        ...item,
        files: item.files.map((file) => ({
          ...file,
          target: join(config.paths.utilities, "theme.ts"),
        })),
      },
    ],
    {
      force: Boolean(flag(args, "force")),
      environment: registryInstallEnvironment(config.renderer),
    },
  );
  output({ preset, result }, outputMode(args));
}

async function bundledSkillsDirectory(): Promise<string> {
  const candidates = [
    join(import.meta.dir, "skills"),
    resolve(import.meta.dir, "../../../skills"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error(
    "This tuil installation does not contain bundled Agent Skills",
  );
}

async function canonicalFuturePath(path: string): Promise<string> {
  let existing = path;
  const missing: string[] = [];
  while (!(await pathExists(existing))) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missing.unshift(basename(existing));
    existing = parent;
  }
  return resolve(await realpath(existing), ...missing);
}

function overlaps(left: string, right: string): boolean {
  const leftToRight = relative(left, right);
  const rightToLeft = relative(right, left);
  return (
    leftToRight === "" ||
    (!leftToRight.startsWith("..") && !isAbsolute(leftToRight)) ||
    (!rightToLeft.startsWith("..") && !isAbsolute(rightToLeft))
  );
}

export async function installBundledSkills(
  source: string,
  destination: string,
  options: {
    readonly force?: boolean;
    readonly signal?: AbortSignal;
  } = {},
): Promise<readonly string[]> {
  const checkAborted = () => options.signal?.throwIfAborted();
  checkAborted();
  const sourcePath = await realpath(source);
  checkAborted();
  const requestedDestination = resolve(destination);
  if (
    (await pathExists(requestedDestination)) &&
    (await lstat(requestedDestination)).isSymbolicLink()
  ) {
    throw new Error("Skills destination must not be a symbolic link");
  }
  const destinationPath = await canonicalFuturePath(destination);
  checkAborted();
  if (
    destinationPath === parse(destinationPath).root ||
    destinationPath === resolve(process.cwd())
  ) {
    throw new Error(`Refusing unsafe skills destination "${destination}"`);
  }
  if (overlaps(sourcePath, destinationPath)) {
    throw new Error("Bundled skills source and destination must not overlap");
  }
  if (await pathExists(destinationPath)) {
    checkAborted();
    const destinationStats = await lstat(destinationPath);
    if (destinationStats.isSymbolicLink()) {
      throw new Error("Skills destination must not be a symbolic link");
    }
    if (!destinationStats.isDirectory()) {
      throw new Error("Skills destination must be a directory");
    }
  }
  checkAborted();
  const skillNames = (await readdir(sourcePath, { withFileTypes: true }))
    .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
    .toSorted();
  const collisions = (
    await Promise.all(
      skillNames.map(async (name) => ({
        name,
        exists: await pathExists(join(destinationPath, name)),
      })),
    )
  ).filter((entry) => entry.exists);
  checkAborted();
  if (!options.force && collisions.length > 0) {
    throw new Error(
      `Refusing to overwrite installed skills: ${collisions
        .map((entry) => entry.name)
        .join(", ")}; use --force`,
    );
  }
  const parent = dirname(destinationPath);
  await mkdir(parent, { recursive: true });
  checkAborted();
  const transaction = crypto.randomUUID();
  const staging = join(
    parent,
    `.${basename(destinationPath)}.tuil-skills-stage-${transaction}`,
  );
  const backup = join(
    parent,
    `.${basename(destinationPath)}.tuil-skills-backup-${transaction}`,
  );
  let movedOriginal = false;
  try {
    if (await pathExists(destinationPath)) {
      checkAborted();
      await cp(destinationPath, staging, { recursive: true });
    } else {
      await mkdir(staging, { recursive: true });
    }
    checkAborted();
    for (const name of skillNames) {
      checkAborted();
      const target = join(staging, name);
      await rm(target, { recursive: true, force: true });
      checkAborted();
      await cp(join(sourcePath, name), target, { recursive: true });
      checkAborted();
    }
    if (await pathExists(destinationPath)) {
      checkAborted();
      await rename(destinationPath, backup);
      movedOriginal = true;
    }
    try {
      checkAborted();
      await rename(staging, destinationPath);
    } catch (error) {
      if (movedOriginal) {
        await rename(backup, destinationPath);
        movedOriginal = false;
      }
      throw error;
    }
    if (movedOriginal) {
      await rm(backup, { recursive: true, force: true });
      movedOriginal = false;
    }
    return Object.freeze(skillNames);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (movedOriginal && !(await pathExists(destinationPath))) {
      await rename(backup, destinationPath);
    }
    throw error;
  }
}

async function skillCommand(args: ParsedArguments): Promise<void> {
  const source = await bundledSkillsDirectory();
  const skillNames = (await readdir(source, { withFileTypes: true }))
    .flatMap((entry) => (entry.isDirectory() ? [entry.name] : []))
    .toSorted();
  const action = args.operands[0] ?? "list";
  if (action === "list") {
    output(
      skillNames.map((name) => ({
        name,
        path: join(source, name),
      })),
      outputMode(args),
    );
    return;
  }
  if (action !== "install") {
    throw new Error(
      `Unknown skills action "${action}". Expected list or install`,
    );
  }
  const destination = resolve(
    process.cwd(),
    String(flag(args, "target") ?? ".agents/skills"),
  );
  const installed = await installBundledSkills(source, destination, {
    force: Boolean(flag(args, "force")),
  });
  output({ installed, destination }, outputMode(args));
}

const commandHelp = Object.freeze([
  ["init [project]", "Create a tuil application"],
  ["add [components...]", "Install registry source"],
  ["remove [...]", "Safely remove installed source"],
  ["update [...]", "Update unchanged registry source"],
  ["diff [...]", "Compare installed and registry source"],
  ["list", "List registry items"],
  ["search [query]", "Search registry items"],
  ["doctor", "Validate the current project"],
  ["info", "Show runtime and project information"],
  ["theme [preset]", "Install a theme preset"],
  ["plugin", "List registry plugins"],
  ["registry", "Show registry configuration"],
  ["skills list", "List bundled Agent Skills"],
  ["skills install", "Install Agent Skills into .agents/skills"],
] as const);

function help(): string {
  const commands = commandHelp
    .map(([usage, description]) => `  ${usage.padEnd(21)}${description}`)
    .join("\n");
  return `tuil

Commands:
${commands}

Global options:
  --output interactive|static|json|silent
`;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  if (args.command === "init") {
    await runInit(args);
  } else if (
    ["add", "remove", "update", "diff", "list", "search", "registry"].includes(
      args.command,
    )
  ) {
    await registryCommand(args);
  } else if (args.command === "doctor") {
    await doctor(args);
  } else if (args.command === "info") {
    await showInfo(args);
  } else if (args.command === "theme") {
    await copyTheme(args);
  } else if (args.command === "plugin") {
    const config = await loadConfig(process.cwd());
    const client = await resolveRegistryClient(process.cwd(), config);
    output(
      (await client.list()).filter((entry) => entry.type === "plugin"),
      outputMode(args),
    );
  } else if (args.command === "skills") {
    await skillCommand(args);
  } else {
    output(help(), outputMode(args));
  }
}

export type { RegistryItem, RegistryItemType };
