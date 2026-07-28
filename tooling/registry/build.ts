import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  parseRegistryItem,
  registryIntegrity,
} from "../../packages/registry/src/index.ts";
import { registryExportName } from "./names.ts";

interface RegistryManifest {
  name: string;
  type: string;
  title: string;
  description: string;
  tier?: 1 | 2 | 3 | 4;
  version?: string;
  packageName?: string;
  ownership?: "source" | "package" | "plugin";
  integrity?: string;
  renderer?: string;
  capabilities?: string[];
  semantics?: string[];
  slots?: string[];
  compatibility?: {
    tuil: string;
    renderers: string[];
    capabilities?: string[];
  };
  deprecated?: {
    message: string;
    replacement?: string;
    since?: string;
  };
  codemods?: {
    id: string;
    description: string;
    replacements: { from: string; to: string }[];
  }[];
  provenance?: {
    source: string;
    license?: string;
    mode?: "use" | "wrap" | "adapt" | "replace" | "reference";
  };
  dependencies?: string[];
  registryDependencies?: string[];
  files: {
    path: string;
    target: string;
    source?: string;
    content?: string;
  }[];
}

export function deriveRegistryReleaseMetadata(
  registryVersion: string,
  tuilVersion: string,
): { readonly version: string; readonly tuilCompatibility: string } {
  const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
  if (!versionPattern.test(registryVersion)) {
    throw new Error(`Invalid registry package version "${registryVersion}"`);
  }
  const tuil = versionPattern.exec(tuilVersion);
  if (!tuil) throw new Error(`Invalid TUIL package version "${tuilVersion}"`);
  return Object.freeze({
    version: registryVersion,
    tuilCompatibility: `^${tuil[1]}.${tuil[2]}.0`,
  });
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
  slider: {
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
    dependencies: ["@mwillbanks/tuil", "@mwillbanks/tuil-ink", "react"],
  },
  "log-viewer": {
    target: "src/components/tuil/data-display/log-viewer.tsx",
    dependencies: [
      "@mwillbanks/tuil",
      "@mwillbanks/tuil-focus",
      "@mwillbanks/tuil-ink",
      "@mwillbanks/tuil-log-viewer",
      "@mwillbanks/tuil-logging",
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
  "markdown-viewer": {
    target: "src/components/tuil/data-display/rich-content.tsx",
    dependencies: [
      "@mwillbanks/tuil-code",
      "@mwillbanks/tuil-content",
      "@mwillbanks/tuil-streaming",
      "ink",
      "react",
    ],
  },
  "terminal-platform-plugin": {
    target: "src/plugins/terminal-platform.ts",
    dependencies: ["@mwillbanks/tuil", "@mwillbanks/tuil-plugin"],
  },
};

const publicDirectory = resolve(import.meta.dir, "../../apps/registry/public");
const projectDirectory = resolve(import.meta.dir, "../..");
const registryPackage = JSON.parse(
  await readFile(
    join(projectDirectory, "packages/registry/package.json"),
    "utf8",
  ),
) as { readonly version: string };
const tuilPackage = JSON.parse(
  await readFile(join(projectDirectory, "packages/tuil/package.json"), "utf8"),
) as { readonly version: string };
const releaseMetadata = deriveRegistryReleaseMetadata(
  registryPackage.version,
  tuilPackage.version,
);
const registryDirectory = join(projectDirectory, "registry");
const registrySourcePaths = (
  await readdir(registryDirectory, {
    recursive: true,
  })
)
  .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
  .map((path) => `registry/${path}`);
const registrySourceByContent = new Map<string, string>();
const registrySourceByBasename = new Map<string, string>();
for (const source of registrySourcePaths) {
  const content = await readFile(join(projectDirectory, source), "utf8");
  if (!registrySourceByContent.has(content)) {
    registrySourceByContent.set(content, source);
  }
  const fileName = basename(source);
  if (!registrySourceByBasename.has(fileName)) {
    registrySourceByBasename.set(fileName, source);
  }
}
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
  "slider",
  "autocomplete",
  "password-input",
  "search-input",
  "command-line",
  "code-editor",
  "inline-editor",
  "editable-table-cell",
  "editable-tree-node",
  "form-field-editor",
  "date-time-input",
]);
const overlaySourceOwner = "dialog";
const overlayAliases = new Set([
  "confirm-dialog",
  "tooltip",
  "toast",
  "command-palette",
  "drawer",
  "popover",
  "skeleton",
  "error-boundary",
]);
const navigationSourceOwner = "tabs";
const navigationAliases = new Set([
  "menu",
  "menubar",
  "breadcrumbs",
  "stepper",
  "tab-select",
  "pagination",
  "outline",
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
const paneSourceOwner = "split-pane";
const paneAliases = new Set([
  "header",
  "footer",
  "sidebar",
  "pane-tabs",
  "scroll-area",
]);
const richContentSourceOwner = "markdown-viewer";
const richContentAliases = new Set([
  "code-viewer",
  "timeline",
  "bar-chart",
  "structured-content",
  "rich-diff-viewer",
]);

for (const manifestName of manifests) {
  const manifestPath = join(publicDirectory, manifestName);
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as RegistryManifest;
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
            : paneAliases.has(manifest.name)
              ? paneSourceOwner
              : richContentAliases.has(manifest.name)
                ? richContentSourceOwner
                : undefined;
  const itemMetadata =
    metadata[manifest.name] ??
    (sourceOwner === undefined ? undefined : metadata[sourceOwner]);
  if (!itemMetadata) {
    throw new Error(`Missing registry build metadata for "${manifest.name}"`);
  }
  manifest.dependencies = sourceOwner ? [] : [...itemMetadata.dependencies];
  manifest.registryDependencies = sourceOwner
    ? [sourceOwner]
    : [...(itemMetadata.registryDependencies ?? [])];
  manifest.files = sourceOwner
    ? []
    : await Promise.all(
        manifest.files.map(async (file) => {
          const source =
            file.source ??
            (file.content
              ? registrySourceByContent.get(file.content)
              : undefined) ??
            registrySourceByBasename.get(basename(itemMetadata.target)) ??
            file.path;
          const sourcePath = resolve(projectDirectory, source);
          if (!sourcePath.startsWith(`${projectDirectory}/`)) {
            throw new Error(
              `Registry source for "${manifest.name}" escapes the project`,
            );
          }
          return {
            ...file,
            path: itemMetadata.target,
            target: itemMetadata.target,
            source,
            content: await readFile(sourcePath, "utf8"),
          };
        }),
      );
  manifest.version = releaseMetadata.version;
  manifest.ownership =
    manifest.type === "plugin"
      ? "plugin"
      : manifest.name === "log-viewer"
        ? "package"
        : "source";
  manifest.packageName =
    manifest.ownership === "plugin"
      ? "@mwillbanks/tuil-plugin"
      : manifest.ownership === "package"
        ? "@mwillbanks/tuil-log-viewer"
        : undefined;
  manifest.compatibility = {
    tuil: releaseMetadata.tuilCompatibility,
    renderers: manifest.renderer ? [manifest.renderer] : ["ink", "cell"],
    capabilities: [],
  };
  manifest.codemods ??= [];
  manifest.provenance = {
    source: manifest.provenance?.source ?? "tuil",
    license: manifest.provenance?.license ?? "MIT",
    mode:
      manifest.ownership === "package"
        ? "adapt"
        : manifest.ownership === "plugin"
          ? "use"
          : (manifest.provenance?.mode ?? "replace"),
  };
  manifest.integrity = registryIntegrity(parseRegistryItem(manifest));
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
      items: generatedItems.map(({ files, ...item }) => ({
        ...item,
        files: files.map(({ path, target, source }) => ({
          path,
          target,
          source,
        })),
      })),
    },
    null,
    2,
  )}\n`,
);
generatedPaths.push(registryIndexPath);

const {
  componentAcceptanceDocumentationLines,
  componentAcceptanceInventory,
  validateComponentAcceptanceInventory,
} = await import("../../registry/stories/component-acceptance.ts");
validateComponentAcceptanceInventory();
if (componentAcceptanceInventory.length !== generatedItems.length) {
  throw new Error(
    `Component acceptance inventory has ${componentAcceptanceInventory.length} entries for ${generatedItems.length} registry items`,
  );
}
const acceptanceEntries = new Map(
  componentAcceptanceInventory.map((entry) => [entry.name, entry]),
);

const acceptanceStoryPath = resolve(
  import.meta.dir,
  "../../apps/showcase/src/component-acceptance.stories.tsx",
);
const acceptanceStories = `import type { Meta, StoryObj } from "@storybook/react";
import {
  createShowcaseStorybookAdapter,
  showcaseStory,
} from "./storybook-adapter.ts";

const browserStorySet = {
  id: "component-acceptance",
  title: "Components/Acceptance",
  stories: {
${generatedItems
  .map(
    (item) =>
      `    ${JSON.stringify(registryExportName(item.name))}: { args: { name: ${JSON.stringify(item.name)} } },`,
  )
  .join("\n")}
  },
} as const;

const adapter = createShowcaseStorybookAdapter(browserStorySet);

const meta = {
  title: "Components/Acceptance",
  argTypes: adapter.meta.argTypes,
} satisfies Meta<Record<string, unknown>>;

export default meta;
type Story = StoryObj<typeof meta>;

${generatedItems
  .map(
    (item) =>
      `export const ${registryExportName(item.name)}: Story = showcaseStory(
  adapter,
  ${JSON.stringify(registryExportName(item.name))},
  "component acceptance",
);`,
  )
  .join("\n\n")}
`;
await Bun.write(acceptanceStoryPath, acceptanceStories);
generatedPaths.push(acceptanceStoryPath);

const acceptanceDocsPath = resolve(
  import.meta.dir,
  "../../apps/docs/content/docs/reference/components/acceptance-catalog.mdx",
);
const acceptanceDocs = `---
title: Component acceptance catalog
description: Executable story, semantics, keyboard, pointer, theme, static, and test contracts for every public registry item.
icon: BookOpenText
---

# Component acceptance catalog

Every public registry item below is backed by its own Storybook export and executable terminal fixture. The acceptance suite validates real component semantics, live theme updates, and committed deterministic output for every entry, plus callback state, keyboard input, focus, and measured pointer routing for each component that exposes those capabilities.

${generatedItems
  .map((item) => {
    const entry = acceptanceEntries.get(item.name);
    if (!entry) {
      throw new Error(
        `Missing component acceptance contract for "${item.name}"`,
      );
    }
    return `## ${item.title}

${componentAcceptanceDocumentationLines(entry).join("\n")}
`;
  })
  .join("\n")}
`
  .trimEnd()
  .concat("\n");
await Bun.write(acceptanceDocsPath, acceptanceDocs);
generatedPaths.push(acceptanceDocsPath);

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
