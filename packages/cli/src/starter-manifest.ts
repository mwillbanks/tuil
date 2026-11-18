import workspace from "../../../package.json" with { type: "json" };
import code from "../../code/package.json" with { type: "json" };
import content from "../../content/package.json" with { type: "json" };
import core from "../../core/package.json" with { type: "json" };
import editor from "../../editor/package.json" with { type: "json" };
import focus from "../../focus/package.json" with { type: "json" };
import form from "../../form/package.json" with { type: "json" };
import hotkeys from "../../hotkeys/package.json" with { type: "json" };
import ink from "../../ink/package.json" with { type: "json" };
import logViewer from "../../log-viewer/package.json" with { type: "json" };
import logging from "../../logging/package.json" with { type: "json" };
import operations from "../../operations/package.json" with { type: "json" };
import plugin from "../../plugin/package.json" with { type: "json" };
import router from "../../router/package.json" with { type: "json" };
import streaming from "../../streaming/package.json" with { type: "json" };
import theme from "../../theme/package.json" with { type: "json" };
import tuil from "../../tuil/package.json" with { type: "json" };
import virtual from "../../virtual/package.json" with { type: "json" };
import workflow from "../../workflow/package.json" with { type: "json" };

const packageVersions = new Map(
  [
    code,
    content,
    core,
    editor,
    focus,
    form,
    hotkeys,
    ink,
    logViewer,
    logging,
    operations,
    plugin,
    router,
    streaming,
    theme,
    tuil,
    virtual,
    workflow,
  ].map(({ name, version }) => [name, "^" + version]),
);
const catalog: Readonly<Record<string, string>> = workspace.workspaces.catalog;

export function starterManifest(name: string, requested: readonly string[]) {
  const dependencies = Object.fromEntries(
    [...new Set(requested)].sort().map((dependency) => {
      const range = packageVersions.get(dependency) ?? catalog[dependency];
      if (!range) throw new Error(`No starter version for "${dependency}"`);
      return [dependency, range];
    }),
  );
  return {
    name,
    private: true,
    type: "module",
    packageManager: workspace.packageManager,
    scripts: {
      dev: "bun --watch src/index.tsx",
      start: "bun src/index.tsx",
      test: "bun test",
    },
    dependencies,
    ...("@tanstack/react-form" in dependencies && {
      overrides: {
        "@tanstack/devtools-event-client":
          workspace.overrides["@tanstack/devtools-event-client"],
      },
    }),
    devDependencies: {
      "@types/bun": workspace.devDependencies["@types/bun"],
      "@types/node": workspace.devDependencies["@types/node"],
      "@types/react": workspace.devDependencies["@types/react"],
    },
  };
}
