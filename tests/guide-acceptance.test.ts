import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { devtoolsPanels } from "@mwillbanks/tuil-devtools";
import { defaultTerminalStoryControls } from "@mwillbanks/tuil-story";

const root = join(import.meta.dir, "..");

const phases = {
  foundation: [
    "box",
    "stack",
    "container",
    "text",
    "heading",
    "divider",
    "button",
    "badge",
    "spinner",
    "progress",
    "alert",
    "app-shell",
    "app-bar",
    "status-bar",
  ],
  formsAndOverlays: [
    "field",
    "text-input",
    "text-area",
    "number-input",
    "checkbox",
    "radio-group",
    "switch",
    "select",
    "multi-select",
    "autocomplete",
    "dialog",
    "confirm-dialog",
    "tooltip",
    "toast",
    "command-palette",
  ],
  navigationAndWorkflows: [
    "tabs",
    "menu",
    "menubar",
    "breadcrumbs",
    "stepper",
    "workflow",
    "operation-list",
    "operation-tree",
    "splash-screen",
    "help-overlay",
  ],
  complexData: [
    "table",
    "data-table",
    "tree",
    "transfer-list",
    "log-viewer",
    "diff-viewer",
    "json-viewer",
    "virtual-list",
    "split-pane",
    "resizable-pane",
  ],
} as const;

const foundationPackages = [
  "core",
  "events",
  "plugin",
  "theme",
  "focus",
  "hotkeys",
  "ink",
  "testing",
  "testing-ink",
  "cli",
  "registry",
  "form",
  "router",
  "workflow",
  "operations",
] as const;

const exampleApplications = [
  "minimal",
  "forms",
  "dashboard",
  "project-wizard",
  "command-center",
  "file-browser",
  "ai-assistant",
] as const;

const skills = [
  "building-tuil-applications",
  "authoring-tuil-components",
  "building-tuil-forms",
  "building-tuil-workflows",
  "building-tuil-plugins",
  "testing-tuil-applications",
  "publishing-tuil-registry-items",
] as const;

async function manifest(path: string) {
  return (await Bun.file(path).json()) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
}

test("every component and package in phases one through four is shipped", async () => {
  const index = (await Bun.file(
    join(root, "apps/registry/public/registry.json"),
  ).json()) as { readonly items: readonly { readonly name: string }[] };
  const names = new Set(index.items.map((item) => item.name));
  for (const component of Object.values(phases).flat()) {
    expect(names.has(component)).toBeTrue();
  }
  for (const packageName of foundationPackages) {
    const packageManifest = await manifest(
      join(root, "packages", packageName, "package.json"),
    );
    for (const command of ["build", "typecheck", "test"]) {
      expect(packageManifest.scripts?.[command]).toBeDefined();
    }
  }
});

test("phase five ships every ecosystem surface with executable validation", async () => {
  expect(Object.keys(defaultTerminalStoryControls).sort()).toEqual(
    [
      "colorDepth",
      "height",
      "hyperlinks",
      "interactive",
      "mouse",
      "platform",
      "reducedMotion",
      "theme",
      "unicode",
      "width",
    ].sort(),
  );
  expect(devtoolsPanels).toEqual([
    "Events",
    "Commands",
    "Routes",
    "Focus",
    "Hotkeys",
    "Plugins",
    "Workflows",
    "Operations",
    "Services",
    "Theme",
    "Terminal capabilities",
    "Performance",
  ]);
  for (const path of [
    "packages/story/src/browser.tsx",
    "packages/story/src/static.ts",
    "apps/docs/source.config.ts",
    "apps/docs/content/docs/components/initializer.story.tsx",
    "apps/showcase/.storybook/main.ts",
    "packages/devtools/src/index.tsx",
    ".changeset/config.json",
    ".github/workflows/release.yml",
  ]) {
    expect(await Bun.file(join(root, path)).exists()).toBeTrue();
  }
  for (const application of ["playground", "showcase"]) {
    const packageManifest = await manifest(
      join(root, "apps", application, "package.json"),
    );
    for (const command of ["build", "typecheck", "test"]) {
      expect(packageManifest.scripts?.[command]).toBeDefined();
    }
  }
  for (const application of exampleApplications) {
    const packageManifest = await manifest(
      join(root, "examples", application, "package.json"),
    );
    for (const command of ["build", "typecheck", "test"]) {
      expect(packageManifest.scripts?.[command]).toBeDefined();
    }
  }
  for (const skill of skills) {
    expect(
      await Bun.file(join(root, "skills", skill, "SKILL.md")).exists(),
    ).toBeTrue();
    expect(
      await Bun.file(
        join(root, "skills", skill, "agents/openai.yaml"),
      ).exists(),
    ).toBeTrue();
  }
});

test("implementation sources contain no deferred placeholders", async () => {
  const findings: string[] = [];
  const excluded = new Set([
    ".next",
    ".source",
    "dist",
    "dist-storybook",
    "node_modules",
  ]);
  const extensions = /\.(?:json|md|mjs|ts|tsx|yaml|yml)$/;
  const deferred = new RegExp(
    `${["TO", "DO"].join("")}|${["FIX", "ME"].join("")}|placeholder implementation|not implemented`,
    "i",
  );
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (extensions.test(entry.name)) {
        const content = await Bun.file(path).text();
        if (deferred.test(content)) findings.push(path.slice(root.length + 1));
      }
    }
  };
  for (const directory of [
    "apps",
    "examples",
    "packages",
    "registry",
    "skills",
    "tooling",
  ]) {
    await visit(join(root, directory));
  }
  expect(findings).toEqual([]);
});
