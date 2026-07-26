import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
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
  relative,
  resolve,
} from "node:path";
import {
  createApp,
  createPlugin,
  defineConfig,
  type RenderMode,
  type TuilConfig,
} from "@mwillbanks/tuil";
import {
  Alert,
  AppBar,
  AppShell,
  Heading,
  Progress,
  renderStatic,
  render as renderTuil,
  Stack,
  StatusBar,
  Text,
} from "@mwillbanks/tuil-ink";
import {
  FileRegistrySource,
  HttpRegistrySource,
  type InstallResult,
  RegistryClient,
  type RegistryIndexEntry,
  RegistryInstaller,
  type RegistryItem,
  type RegistryItemType,
  type RegistrySource,
} from "@mwillbanks/tuil-registry";
import type { ReactNode } from "react";
import { generatedRegistryItems } from "./generated-registry.ts";
import {
  type Feature,
  features,
  type InitAnswers,
  InitWizard,
  type Template,
  templates,
} from "./generated-ui/blocks/init-wizard.tsx";

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

class BundledRegistrySource implements RegistrySource {
  readonly id = "tuil";
  readonly #items = new Map<string, RegistryItem>(
    generatedRegistryItems.map((item) => [item.name, item as RegistryItem]),
  );

  async get(name: string): Promise<RegistryItem | undefined> {
    return this.#items.get(name);
  }

  async list(): Promise<readonly RegistryIndexEntry[]> {
    return [...this.#items.values()].map((item) => ({
      name: item.name,
      type: item.type,
      title: item.title,
      description: item.description,
    }));
  }
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
} as const;

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

function InitSummary(props: {
  readonly name: string;
  readonly template: Template;
  readonly features: readonly string[];
  readonly completed: number;
  readonly total: number;
  readonly error?: string;
}): ReactNode {
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
          <Text>tuil 0.1.0</Text>
        </StatusBar>
      </AppShell.StatusBar>
    </AppShell>
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
    return `import {Alert, AppBar, AppShell, Badge, Box, Breadcrumbs, Button, Checkbox, Container, Dialog, Divider, Field, Heading, Progress, Select, Spinner, Stack, StatusBar, Stepper, Tabs, Text, TextInput, Tooltip} from "../components/tuil/index.ts";

const catalogSections = [
  {id: "foundation", label: "Foundation", content: "Layout and typography"},
  {id: "forms", label: "Forms", content: "Validated terminal input"},
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
    "@mwillbanks/tuil": "^0.1.0",
    "@mwillbanks/tuil-core": "^0.1.0",
    "@mwillbanks/tuil-focus": "^0.1.0",
    "@mwillbanks/tuil-hotkeys": "^0.1.0",
    "@mwillbanks/tuil-ink": "^0.1.0",
    "@mwillbanks/tuil-theme": "^0.1.0",
    ink: "^7.1.0",
    react: "^19.0.0",
  };
  if (formsEnabled) {
    dependencies["@mwillbanks/tuil-form"] = "^0.1.0";
    dependencies["@tanstack/react-form"] = "^1.33.2";
  }
  if (routerEnabled) {
    dependencies["@mwillbanks/tuil-router"] = "^0.1.0";
  }
  if (workflowEnabled) {
    dependencies["@mwillbanks/tuil-operations"] = "^0.1.0";
    dependencies["@mwillbanks/tuil-workflow"] = "^0.1.0";
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
    "src/index.tsx": `import {createApp} from "@mwillbanks/tuil";\nimport {render} from "@mwillbanks/tuil-ink";\nimport {App} from "./app/app.tsx";\nimport {FeaturePanels} from "./features/index.tsx";\nimport {theme} from "./lib/theme.ts";\n${template === "plugin" ? 'import {examplePlugin} from "./plugins/example.ts";\n' : ""}\nfunction Root() {\n  return <><App /><FeaturePanels /></>;\n}\n\nconst instance = await render(createApp({\n  component: Root,\n  theme,\n  ${template === "plugin" ? "plugins: [examplePlugin]," : ""}\n}));\nawait instance.waitUntilExit();\n`,
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
      `import {createPlugin} from "@mwillbanks/tuil";\n\nexport const examplePlugin = createPlugin({\n  id: "example",\n  version: "0.1.0",\n  setup(context) {\n    return context.registry.register({\n      id: "example.status",\n      title: "Example plugin status",\n    });\n  },\n});\n`;
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

const initializerPlugin = createPlugin({
  id: "tuil.initializer",
  version: "0.1.0",
  setup(context) {
    return context.registry.register({
      id: "tuil.initializer",
      title: "tuil project initializer",
    });
  },
});

async function promptInit(name: string | undefined): Promise<InitAnswers> {
  let complete: ((answers: InitAnswers) => void) | undefined;
  let cancel: ((reason: Error) => void) | undefined;
  const answer = new Promise<InitAnswers>((resolveAnswer, rejectAnswer) => {
    complete = resolveAnswer;
    cancel = rejectAnswer;
  });
  const app = createApp({
    component: () => (
      <InitWizard
        initialName={name ?? "my-tuil-app"}
        onComplete={(answers) => complete?.(answers)}
        onCancel={() => cancel?.(new Error("Initialization cancelled"))}
      />
    ),
    plugins: [initializerPlugin],
    errorHandler(error) {
      cancel?.(
        error instanceof Error
          ? error
          : new Error("Initialization failed", { cause: error }),
      );
    },
    terminal: { mode: "interactive" },
  });
  const instance = await renderTuil(app, { exitOnCtrlC: false });
  try {
    return await answer;
  } finally {
    await instance.unmount();
  }
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
    const file =
      item.files[0] ??
      ([
        "text-input",
        "text-area",
        "number-input",
        "checkbox",
        "radio-group",
        "switch",
        "select",
        "multi-select",
        "autocomplete",
      ].includes(item.name)
        ? plan.find((candidate) => candidate.name === "field")?.files[0]
        : ["confirm-dialog", "tooltip", "toast", "command-palette"].includes(
              item.name,
            )
          ? plan.find((candidate) => candidate.name === "dialog")?.files[0]
          : ["menu", "menubar", "breadcrumbs", "stepper"].includes(item.name)
            ? plan.find((candidate) => candidate.name === "tabs")?.files[0]
            : [
                  "operation-list",
                  "operation-tree",
                  "splash-screen",
                  "help-overlay",
                ].includes(item.name)
              ? plan.find((candidate) => candidate.name === "workflow")
                  ?.files[0]
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

async function runInit(args: ParsedArguments): Promise<void> {
  const mode = outputMode(args);
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
  const registryClient = new RegistryClient([new BundledRegistrySource()]);
  const requestedItems = [
    ...templateComponents[prompted.template],
    ...(prompted.features.includes("forms")
      ? ["button", "field", "text-input"]
      : []),
    ...(prompted.features.includes("router") ? ["tabs", "breadcrumbs"] : []),
    ...(prompted.features.includes("workflow")
      ? ["workflow", "operation-list", "stepper"]
      : []),
    themePreset,
  ];
  const plan = await registryClient.resolvePlan(requestedItems);
  await validateTarget(target, Boolean(flag(args, "force")));
  const targetExisted = await pathExists(target);
  const transaction = crypto.randomUUID();
  const workingTarget = join(
    dirname(target),
    `.${basename(target)}.tuil-init-${transaction}`,
  );
  try {
    if (targetExisted) {
      await cp(target, workingTarget, {
        recursive: true,
        errorOnExist: true,
      });
    } else {
      await mkdir(workingTarget, { recursive: true });
    }
    const files = projectFiles(
      projectName,
      prompted.template,
      prompted.features,
      themePreset,
    );
    for (const [path, content] of Object.entries(files)) {
      const destination = join(workingTarget, path);
      if ((await pathExists(destination)) && !flag(args, "force")) {
        throw new Error(`Refusing to overwrite existing file "${destination}"`);
      }
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
    await mkdir(join(workingTarget, "src/components/tuil"), {
      recursive: true,
    });
    await mkdir(join(workingTarget, "src/features"), { recursive: true });
    await mkdir(join(workingTarget, "src/workflows"), { recursive: true });
    await mkdir(join(workingTarget, "src/plugins"), { recursive: true });
    await mkdir(join(workingTarget, "src/stores"), { recursive: true });
    await new RegistryInstaller(workingTarget).installMany(plan, {
      componentDirectory: "./src/components/tuil",
      force: Boolean(flag(args, "force")),
    });
    await writeComponentBarrel(workingTarget, plan);
    await validateGeneratedSources(workingTarget);

    if (flag(args, "install")) {
      const quiet = mode === "silent" || mode === "json";
      const install = Bun.spawn(["bun", "install"], {
        cwd: workingTarget,
        stdout: quiet ? "ignore" : "inherit",
        stderr: quiet ? "ignore" : "inherit",
      });
      if ((await install.exited) !== 0) {
        throw new Error("Dependency installation failed");
      }
      const validation = Bun.spawn(["bun", "run", "typecheck"], {
        cwd: workingTarget,
        stdout: quiet ? "ignore" : "inherit",
        stderr: quiet ? "ignore" : "inherit",
      });
      if ((await validation.exited) !== 0) {
        throw new Error("Generated project validation failed");
      }
    }
    if (flag(args, "git")) {
      const quiet = mode === "silent" || mode === "json";
      const git = Bun.spawn(["git", "init"], {
        cwd: workingTarget,
        stdout: quiet ? "ignore" : "inherit",
        stderr: quiet ? "ignore" : "inherit",
      });
      if ((await git.exited) !== 0) {
        throw new Error("Git initialization failed");
      }
    }
    if (targetExisted) {
      const backup = join(
        dirname(target),
        `.${basename(target)}.tuil-backup-${transaction}`,
      );
      await rename(target, backup);
      try {
        await rename(workingTarget, target);
      } catch (error) {
        await rename(backup, target);
        throw error;
      }
      await rm(backup, { recursive: true, force: true });
    } else {
      await rename(workingTarget, target);
    }
  } catch (error) {
    await rm(workingTarget, { recursive: true, force: true });
    throw error;
  }
  await renderSummary(
    {
      name: basename(target),
      template: prompted.template,
      features: prompted.features,
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

interface FileSnapshot {
  readonly path: string;
  readonly content?: Uint8Array;
}

async function captureFile(path: string): Promise<FileSnapshot> {
  try {
    return { path, content: await readFile(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path };
    throw error;
  }
}

async function restoreFiles(snapshots: readonly FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.content === undefined) {
      await rm(snapshot.path, { force: true });
    } else {
      await writeFile(snapshot.path, snapshot.content);
    }
  }
}

async function installRegistryDependencies(
  root: string,
  dependencies: readonly string[],
  mode: RenderMode,
): Promise<() => Promise<void>> {
  const snapshots = await Promise.all(
    ["package.json", "bun.lock", "bun.lockb"].map((name) =>
      captureFile(join(root, name)),
    ),
  );
  const quiet = mode === "silent" || mode === "json";
  const rollback = async () => {
    await restoreFiles(snapshots);
    const reconcile = Bun.spawn(
      [
        "bun",
        "install",
        ...(snapshots.some(
          (snapshot) =>
            basename(snapshot.path) === "bun.lock" &&
            snapshot.content !== undefined,
        )
          ? ["--frozen-lockfile"]
          : []),
      ],
      {
        cwd: root,
        stdout: quiet ? "ignore" : "inherit",
        stderr: quiet ? "ignore" : "inherit",
      },
    );
    if ((await reconcile.exited) !== 0) {
      throw new Error("Dependency rollback reconciliation failed");
    }
    await restoreFiles(snapshots);
  };
  const install = Bun.spawn(["bun", "add", ...dependencies], {
    cwd: root,
    stdout: quiet ? "ignore" : "inherit",
    stderr: quiet ? "ignore" : "inherit",
  });
  if ((await install.exited) !== 0) {
    await rollback();
    throw new Error("Registry dependency installation failed");
  }
  return rollback;
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
        const formatted = await new Response(process.stdout).text();
        const error = await new Response(process.stderr).text();
        if ((await process.exited) !== 0) {
          throw new Error(`Formatter failed for "${target}": ${error.trim()}`);
        }
        return formatted;
      }
    : undefined;
  let rollbackDependencies: (() => Promise<void>) | undefined;
  if (
    (args.command === "add" || args.command === "update") &&
    !flag(args, "no-install")
  ) {
    const dependencies = [
      ...new Set(plan.flatMap((item) => item.dependencies ?? [])),
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
    results = await installer.installMany(plan, {
      componentDirectory: config.paths.components,
      force: Boolean(flag(args, "force")),
      format: formatter,
    });
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
      version: "0.1.0",
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
  const config = await loadConfig(process.cwd());
  const item = await new RegistryClient([new BundledRegistrySource()]).get(
    preset,
  );
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
    { force: Boolean(flag(args, "force")) },
  );
  output({ preset, result }, outputMode(args));
}

function help(): string {
  return `tuil

Commands:
  init [project]       Create a tuil application
  add [components...]  Install registry source
  remove [...]         Safely remove installed source
  update [...]         Update unchanged registry source
  diff [...]           Compare installed and registry source
  list                 List registry items
  search [query]       Search registry items
  doctor               Validate the current project
  info                 Show runtime and project information
  theme [preset]       Install a theme preset
  plugin               List registry plugins
  registry             Show registry configuration

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
  } else {
    output(help(), outputMode(args));
  }
}

export type { RegistryItem, RegistryItemType };
