import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

interface RegistryManifest {
  name: string;
  type: string;
  title: string;
  description: string;
  dependencies?: string[];
  registryDependencies?: string[];
  files: {
    path: string;
    target: string;
    content?: string;
  }[];
}

const metadata: Record<
  string,
  {
    readonly target: string;
    readonly dependencies: readonly string[];
    readonly registryDependencies?: readonly string[];
  }
> = {
  box: {
    target: "src/components/tuil/primitives/box.tsx",
    dependencies: [
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  stack: {
    target: "src/components/tuil/primitives/stack.tsx",
    dependencies: ["@mwillbanks/tuil-theme", "react"],
    registryDependencies: ["box"],
  },
  container: {
    target: "src/components/tuil/primitives/container.tsx",
    dependencies: ["react"],
    registryDependencies: ["box"],
  },
  text: {
    target: "src/components/tuil/data-display/text.tsx",
    dependencies: [
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  heading: {
    target: "src/components/tuil/data-display/heading.tsx",
    dependencies: ["@mwillbanks/tuil-theme", "react"],
    registryDependencies: ["text"],
  },
  divider: {
    target: "src/components/tuil/data-display/divider.tsx",
    dependencies: ["@mwillbanks/tuil-theme", "react"],
    registryDependencies: ["text"],
  },
  badge: {
    target: "src/components/tuil/data-display/badge.tsx",
    dependencies: ["@mwillbanks/tuil-theme", "react"],
    registryDependencies: ["text"],
  },
  button: {
    target: "src/components/tuil/components/button.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-hotkeys",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  spinner: {
    target: "src/components/tuil/feedback/spinner.tsx",
    dependencies: ["@mwillbanks/tuil", "@mwillbanks/tuil-theme", "react"],
    registryDependencies: ["text"],
  },
  progress: {
    target: "src/components/tuil/feedback/progress.tsx",
    dependencies: ["@mwillbanks/tuil", "@mwillbanks/tuil-theme", "react"],
    registryDependencies: ["text"],
  },
  alert: {
    target: "src/components/tuil/feedback/alert.tsx",
    dependencies: ["@mwillbanks/tuil-theme", "react"],
    registryDependencies: ["box", "text"],
  },
  "app-bar": {
    target: "src/components/tuil/components/app-bar.tsx",
    dependencies: ["react"],
    registryDependencies: ["box"],
  },
  "status-bar": {
    target: "src/components/tuil/components/status-bar.tsx",
    dependencies: ["react"],
    registryDependencies: ["box"],
  },
  "app-shell": {
    target: "src/components/tuil/components/app-shell.tsx",
    dependencies: ["react"],
    registryDependencies: ["box", "app-bar", "status-bar"],
  },
  default: {
    target: "src/lib/theme.ts",
    dependencies: ["@mwillbanks/tuil"],
  },
  field: {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  "text-input": {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  "text-area": {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  "number-input": {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  checkbox: {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  "radio-group": {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  switch: {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  select: {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  "multi-select": {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  autocomplete: {
    target: "src/components/tuil/forms/controls.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-form",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  dialog: {
    target: "src/components/tuil/feedback/overlays.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-core",
      "@mwillbanks/tuil-hotkeys",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
    registryDependencies: ["button", "text-input"],
  },
  "confirm-dialog": {
    target: "src/components/tuil/feedback/overlays.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-core",
      "@mwillbanks/tuil-hotkeys",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
    registryDependencies: ["button", "text-input"],
  },
  tooltip: {
    target: "src/components/tuil/feedback/overlays.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-core",
      "@mwillbanks/tuil-hotkeys",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
    registryDependencies: ["button", "text-input"],
  },
  toast: {
    target: "src/components/tuil/feedback/overlays.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-core",
      "@mwillbanks/tuil-hotkeys",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
    registryDependencies: ["button", "text-input"],
  },
  "command-palette": {
    target: "src/components/tuil/feedback/overlays.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-core",
      "@mwillbanks/tuil-hotkeys",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
    registryDependencies: ["button", "text-input"],
  },
  tabs: {
    target: "src/components/tuil/navigation/navigation.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  menu: {
    target: "src/components/tuil/navigation/navigation.tsx",
    dependencies: [],
  },
  menubar: {
    target: "src/components/tuil/navigation/navigation.tsx",
    dependencies: [],
  },
  breadcrumbs: {
    target: "src/components/tuil/navigation/navigation.tsx",
    dependencies: [],
  },
  stepper: {
    target: "src/components/tuil/navigation/navigation.tsx",
    dependencies: [],
  },
  workflow: {
    target: "src/components/tuil/workflows/workflow.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-hotkeys",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-operations",
      "@mwillbanks/tuil-theme",
      "@mwillbanks/tuil-workflow",
      "ink",
      "react",
    ],
    registryDependencies: ["button", "dialog", "text-input", "tabs"],
  },
  "operation-list": {
    target: "src/components/tuil/workflows/workflow.tsx",
    dependencies: [],
  },
  "operation-tree": {
    target: "src/components/tuil/workflows/workflow.tsx",
    dependencies: [],
  },
  "splash-screen": {
    target: "src/components/tuil/workflows/workflow.tsx",
    dependencies: [],
  },
  "help-overlay": {
    target: "src/components/tuil/workflows/workflow.tsx",
    dependencies: [],
  },
  "init-wizard": {
    target: "src/components/tuil/blocks/init-wizard.tsx",
    dependencies: [
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-operations",
      "@mwillbanks/tuil-router",
      "@mwillbanks/tuil-workflow",
      "react",
    ],
    registryDependencies: ["field", "workflow"],
  },
  table: {
    target: "src/components/tuil/data-display/complex-data.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "@mwillbanks/tuil-virtual",
      "@tanstack/react-table",
      "ink",
      "react",
    ],
  },
  "data-table": {
    target: "src/components/tuil/data-display/complex-data.tsx",
    dependencies: [],
  },
  tree: {
    target: "src/components/tuil/data-display/tree.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "@mwillbanks/tuil-virtual",
      "ink",
      "react",
    ],
  },
  "log-viewer": {
    target: "src/components/tuil/data-display/log-viewer.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "@mwillbanks/tuil-virtual",
      "ink",
      "react",
    ],
  },
  "diff-viewer": {
    target: "src/components/tuil/data-display/diff-viewer.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "@mwillbanks/tuil-virtual",
      "diff",
      "ink",
      "react",
    ],
  },
  "json-viewer": {
    target: "src/components/tuil/data-display/json-viewer.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "@mwillbanks/tuil-virtual",
      "ink",
      "react",
    ],
  },
  "virtual-list": {
    target: "src/components/tuil/data-display/virtual-list.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "@mwillbanks/tuil-virtual",
      "ink",
      "react",
    ],
  },
  "transfer-list": {
    target: "src/components/tuil/forms/transfer-list.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  "split-pane": {
    target: "src/components/tuil/layout/panes.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
  "resizable-pane": {
    target: "src/components/tuil/layout/resizable-pane.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-theme",
      "ink",
      "react",
    ],
  },
};

const publicDirectory = resolve(import.meta.dir, "../../apps/registry/public");
const manifests = (await readdir(publicDirectory))
  .filter((name) => name.endsWith(".json") && name !== "registry.json")
  .sort();
const generatedItems: RegistryManifest[] = [];
const generatedPaths: string[] = [];
const formSourceOwner = "field";
const formAliases = new Set([
  "text-input",
  "text-area",
  "number-input",
  "checkbox",
  "radio-group",
  "switch",
  "select",
  "multi-select",
  "autocomplete",
]);
const overlaySourceOwner = "dialog";
const overlayAliases = new Set([
  "confirm-dialog",
  "tooltip",
  "toast",
  "command-palette",
]);
const navigationSourceOwner = "tabs";
const navigationAliases = new Set([
  "menu",
  "menubar",
  "breadcrumbs",
  "stepper",
]);
const workflowSourceOwner = "workflow";
const workflowAliases = new Set([
  "operation-list",
  "operation-tree",
  "splash-screen",
  "help-overlay",
]);
const tableSourceOwner = "table";
const tableAliases = new Set(["data-table"]);

for (const manifestName of manifests) {
  const manifestPath = join(publicDirectory, manifestName);
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as RegistryManifest;
  const itemMetadata = metadata[manifest.name];
  if (!itemMetadata) {
    throw new Error(`Missing registry build metadata for "${manifest.name}"`);
  }
  const sourceOwner = formAliases.has(manifest.name)
    ? formSourceOwner
    : overlayAliases.has(manifest.name)
      ? overlaySourceOwner
      : navigationAliases.has(manifest.name)
        ? navigationSourceOwner
        : workflowAliases.has(manifest.name)
          ? workflowSourceOwner
          : tableAliases.has(manifest.name)
            ? tableSourceOwner
            : undefined;
  manifest.dependencies = sourceOwner ? [] : [...itemMetadata.dependencies];
  manifest.registryDependencies = sourceOwner
    ? [sourceOwner]
    : [...(itemMetadata.registryDependencies ?? [])];
  manifest.files = sourceOwner
    ? []
    : await Promise.all(
        manifest.files.map(async (file) => ({
          ...file,
          target: itemMetadata.target,
          content: await readFile(resolve(publicDirectory, file.path), "utf8"),
        })),
      );
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  generatedPaths.push(manifestPath);
  generatedItems.push(manifest);
}

const registryIndexPath = join(publicDirectory, "registry.json");
await Bun.write(
  registryIndexPath,
  `${JSON.stringify(
    {
      name: "tuil",
      items: generatedItems.map(({ name, type, title, description }) => ({
        name,
        type,
        title,
        description,
      })),
    },
    null,
    2,
  )}\n`,
);
generatedPaths.push(registryIndexPath);

const generatedModule = `import type { RegistryItem } from "@mwillbanks/tuil-registry";

// Generated by tooling/registry/build.ts from the source-owned registry.
export const generatedRegistryItems = ${JSON.stringify(
  generatedItems,
  null,
  2,
)} as const satisfies readonly RegistryItem[];
`;

const generatedModulePath = resolve(
  import.meta.dir,
  "../../packages/cli/src/generated-registry.ts",
);
await Bun.write(generatedModulePath, generatedModule);
generatedPaths.push(generatedModulePath);

const repositoryRoot = resolve(import.meta.dir, "../..");
const selfHostedSources = [
  "registry/blocks/init-wizard.tsx",
  "registry/components/button.tsx",
  "registry/feedback/overlays.tsx",
  "registry/forms/controls.tsx",
  "registry/navigation/navigation.tsx",
  "registry/workflows/workflow.tsx",
] as const;
for (const sourcePath of selfHostedSources) {
  generatedPaths.push(resolve(repositoryRoot, sourcePath));
  const generatedPath = resolve(
    repositoryRoot,
    "packages/cli/src/generated-ui",
    sourcePath.replace("registry/", ""),
  );
  await mkdir(dirname(generatedPath), { recursive: true });
  await Bun.write(
    generatedPath,
    await readFile(resolve(repositoryRoot, sourcePath), "utf8"),
  );
  generatedPaths.push(generatedPath);
}

const formatter = Bun.spawn(
  [process.execPath, "biome", "format", "--write", ...generatedPaths],
  {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  },
);
const formatterOutput = await new Response(formatter.stderr).text();
if ((await formatter.exited) !== 0) {
  throw new Error(`Registry artifact formatting failed: ${formatterOutput}`);
}
