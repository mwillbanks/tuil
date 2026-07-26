import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTuil } from "@mwillbanks/tuil-testing-ink";
import { initWizardStories } from "../../../registry/blocks/init-wizard.stories.tsx";
import {
  type InitAnswers,
  InitWizard,
  installBundledSkills,
} from "./index.tsx";

const directories: string[] = [];
const cli = join(import.meta.dir, "bin.ts");

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function run(
  cwd: string,
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(["bun", cli, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  };
}

describe("tuil CLI", () => {
  test("keeps the self-hosted UI mirror identical to registry source", async () => {
    const sourcePaths = [
      "blocks/init-wizard.tsx",
      "components/button.tsx",
      "feedback/overlays.tsx",
      "forms/controls.tsx",
      "navigation/navigation.tsx",
      "workflows/workflow.tsx",
    ] as const;
    for (const sourcePath of sourcePaths) {
      expect(
        await readFile(
          join(import.meta.dir, `../../../registry/${sourcePath}`),
          "utf8",
        ),
      ).toBe(
        await readFile(
          join(import.meta.dir, `generated-ui/${sourcePath}`),
          "utf8",
        ),
      );
    }
  });

  test("creates a safe, complete project structure", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    const result = await run(root, [
      "init",
      "demo",
      "--template",
      "application",
      "--router",
      "--forms",
      "--workflow",
      "--output",
      "json",
    ]);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      project: "demo",
      template: "application",
      completed: 10,
    });
    const packageJson = JSON.parse(
      await readFile(join(root, "demo/package.json"), "utf8"),
    ) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(packageJson.scripts).toHaveProperty("typecheck");
    expect(packageJson.dependencies).toHaveProperty(
      "@mwillbanks/tuil-form",
      "^0.1.0",
    );
    expect(packageJson.dependencies).toHaveProperty(
      "@mwillbanks/tuil-router",
      "^0.1.0",
    );
    expect(packageJson.dependencies).toHaveProperty(
      "@mwillbanks/tuil-workflow",
      "^0.1.0",
    );
    expect(await readFile(join(root, "demo/src/index.tsx"), "utf8")).toContain(
      "FeaturePanels",
    );
    expect(
      await readFile(
        join(root, "demo/src/components/tuil/components/app-shell.tsx"),
        "utf8",
      ),
    ).toContain("export function AppShell");
    const projectForm = await readFile(
      join(root, "demo/src/features/project-form.tsx"),
      "utf8",
    );
    expect(projectForm).toContain("adaptTanStackField");
    expect(projectForm).toContain('command="project-form.submit"');
    expect(projectForm).not.toContain("onPress={() => form.handleSubmit()}");
    expect(
      await readFile(join(root, "demo/src/features/index.tsx"), "utf8"),
    ).toContain("<ProjectForm");
    expect(
      await readFile(
        join(root, "demo/src/components/tuil/forms/controls.tsx"),
        "utf8",
      ),
    ).toContain("export function TextInput");
    expect(
      await readFile(join(root, "demo/src/workflows/main.ts"), "utf8"),
    ).toContain("projectWorkflow");
    expect(
      await readFile(join(root, "demo/src/features/index.tsx"), "utf8"),
    ).toContain("<Workflow workflow={projectWorkflow}>");
    expect(
      await readFile(join(root, "demo/src/features/index.tsx"), "utf8"),
    ).toContain("<Workflow.Operations");
    expect(
      await readFile(join(root, "demo/src/features/router-panel.tsx"), "utf8"),
    ).toContain("router.navigate");
  });

  test("installs registry source and protects local changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    const added = await run(root, [
      "add",
      "button",
      "--no-install",
      "--output",
      "json",
    ]);
    expect(added.exitCode).toBe(0);
    const buttonPath = join(root, "src/components/tuil/components/button.tsx");
    expect(await readFile(buttonPath, "utf8")).toContain(
      "export function Button",
    );
    await Bun.write(buttonPath, "local change\n");
    const update = await run(root, [
      "update",
      "button",
      "--no-install",
      "--output",
      "json",
    ]);
    expect(update.exitCode).toBe(1);
    expect(update.stderr).toContain("locally modified");
  });

  test("updates individually requested aliases through canonical source owners", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    const added = await run(root, [
      "add",
      "text-input",
      "select",
      "--no-install",
      "--output",
      "json",
    ]);
    expect(added.exitCode).toBe(0);
    const updated = await run(root, [
      "update",
      "text-input",
      "--no-install",
      "--output",
      "json",
    ]);
    expect(updated).toMatchObject({ exitCode: 0, stderr: "" });
    expect(
      await readFile(
        join(root, "src/components/tuil/forms/controls.tsx"),
        "utf8",
      ),
    ).toContain("export function TextInput");
  });

  test("installs complex-data aliases through canonical source owners", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    const added = await run(root, [
      "add",
      "data-table",
      "json-viewer",
      "resizable-pane",
      "--no-install",
      "--output",
      "json",
    ]);
    expect(added.exitCode).toBe(0);
    const updated = await run(root, [
      "update",
      "data-table",
      "resizable-pane",
      "--no-install",
      "--output",
      "json",
    ]);
    expect(updated).toMatchObject({ exitCode: 0, stderr: "" });
    expect(
      await readFile(
        join(root, "src/components/tuil/data-display/complex-data.tsx"),
        "utf8",
      ),
    ).toContain("export function DataTable");
    expect(
      await readFile(
        join(root, "src/components/tuil/data-display/json-viewer.tsx"),
        "utf8",
      ),
    ).toContain("export function JsonViewer");
    expect(
      await readFile(
        join(root, "src/components/tuil/layout/resizable-pane.tsx"),
        "utf8",
      ),
    ).toContain("export function ResizablePane");
  });

  test("keeps unrelated complex-data source independently customizable", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    const tree = await run(root, [
      "add",
      "tree",
      "--no-install",
      "--output",
      "json",
    ]);
    expect(tree.exitCode).toBe(0);
    const treePath = join(root, "src/components/tuil/data-display/tree.tsx");
    await writeFile(
      treePath,
      `${await readFile(treePath, "utf8")}\n// project customization\n`,
    );
    const json = await run(root, [
      "add",
      "json-viewer",
      "--no-install",
      "--output",
      "json",
    ]);
    expect(json).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await readFile(treePath, "utf8")).toContain("project customization");
  });

  test("generates every distinct template and rejects unknown templates", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    const expectedContent: Record<string, string> = {
      minimal: "return <Text>",
      application: "Features: foundation",
      dashboard: "<Heading>Dashboard</Heading>",
      wizard: "const steps",
      "command-center": "Deployment requested",
      plugin: "Plugin Workspace",
      "component-library": "Foundational catalog",
    };
    for (const [template, marker] of Object.entries(expectedContent)) {
      const result = await run(root, [
        "init",
        `${template}-demo`,
        "--template",
        template,
        "--output",
        "silent",
      ]);
      expect(result.exitCode).toBe(0);
      expect(
        await readFile(join(root, `${template}-demo/src/app/app.tsx`), "utf8"),
      ).toContain(marker);
      expect(
        await readFile(
          join(root, `${template}-demo/src/features/index.tsx`),
          "utf8",
        ),
      ).toContain("FeaturePanels");
    }
    const librarySource = await readFile(
      join(root, "component-library-demo/src/app/app.tsx"),
      "utf8",
    );
    expect(librarySource).toContain("TextInput");
    expect(librarySource).toContain("Select");
    expect(librarySource).toContain("Breadcrumbs");
    expect(librarySource).toContain("Stepper");
    expect(librarySource).toContain("<Table");
    expect(librarySource).toContain("<Tree");
    expect(librarySource).toContain("<VirtualList");
    expect(librarySource).toContain("<JsonViewer");
    expect(librarySource).toContain("<SplitPane");
    expect(
      await readFile(
        join(root, "component-library-demo/src/features/router-panel.tsx"),
        "utf8",
      ),
    ).toContain("useSyncExternalStore");
    expect(
      await readFile(
        join(root, "component-library-demo/src/workflows/main.ts"),
        "utf8",
      ),
    ).toContain("defineOperation");
    expect(librarySource).toContain("50 components");
    const libraryPackage = JSON.parse(
      await readFile(join(root, "component-library-demo/package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(libraryPackage.dependencies).toMatchObject({
      "@mwillbanks/tuil-virtual": "^0.1.0",
      "@tanstack/react-table": "^8.21.3",
      diff: "^9.0.0",
      "react-dom": "^19.2.8",
    });
    const invalid = await run(root, [
      "init",
      "invalid-demo",
      "--template",
      "unknown",
      "--output",
      "silent",
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("Unknown template");
  });

  test("uses tuil input, focus, and buttons for interactive initialization", async () => {
    let answers: InitAnswers | undefined;
    const focusWhenReady = async (
      app: ReturnType<typeof renderTuil>["app"],
      id: string,
    ): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (app.focus.focus(id)) return;
        await Bun.sleep(1);
      }
      throw new Error(`Focus target "${id}" was not registered`);
    };
    const view = renderTuil(
      <InitWizard
        initialName="demo"
        onComplete={(value) => {
          answers = value;
        }}
        onCancel={() => {
          throw new Error("unexpected cancellation");
        }}
      />,
    );
    await view.ready;
    await focusWhenReady(view.app, "init-project-name");
    await view.user.press("enter");
    await focusWhenReady(view.app, "init-template");
    await view.user.press("enter");
    await view.user.press("enter");
    await focusWhenReady(view.app, "init-features");
    await view.user.press("space");
    await focusWhenReady(view.app, "review-project");
    await view.user.press("enter");
    await Bun.sleep(10);
    const confirm = view.screen.getByRole("button", {
      name: "Create project",
    });
    expect(confirm.id).toBeDefined();
    await focusWhenReady(view.app, confirm.id as string);
    await view.user.press("enter");
    expect(answers).toEqual({
      name: "demo",
      template: "application",
      features: ["router"],
    });
    await view.cleanup();
  });

  test("renders the documented initializer static fallback story", async () => {
    const story = initWizardStories.stories.StaticFallback;
    const view = renderTuil(
      <InitWizard
        initialName={story.args.initialName ?? "static-tuil-app"}
        onComplete={() => undefined}
        onCancel={() => undefined}
      />,
      {
        terminal: {
          mode: "static",
          capabilities: {
            interactive: false,
            tty: false,
            unicode: story.terminal?.unicode,
            width: story.terminal?.width,
            height: story.terminal?.height,
          },
        },
      },
    );
    await view.ready;
    await Bun.sleep(10);
    expect(view.screen.frame()).toContain("tuil init");
    expect(view.screen.frame()).toContain("Project name");
    expect(
      view.screen.getByRole("textbox", { name: "Project name" }),
    ).toBeDefined();
    await view.cleanup();
  });

  test("stages forced initialization and preserves unrelated project files", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    const target = join(root, "existing");
    await mkdir(target);
    await writeFile(join(target, "keep.txt"), "preserve me\n");
    const result = await run(root, [
      "init",
      "existing",
      "--template",
      "dashboard",
      "--force",
      "--output",
      "silent",
    ]);
    expect(result.exitCode).toBe(0);
    expect(await readFile(join(target, "keep.txt"), "utf8")).toBe(
      "preserve me\n",
    );
    expect(await readFile(join(target, "src/app/app.tsx"), "utf8")).toContain(
      "<Heading>Dashboard</Heading>",
    );
  });

  test("rolls back package changes when registry source cannot commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    const originalPackage = `${JSON.stringify(
      { name: "registry-transaction", private: true },
      null,
      2,
    )}\n`;
    await writeFile(join(root, "package.json"), originalPackage);
    await mkdir(join(root, "local-registry"));
    await writeFile(
      join(root, "local-registry/transaction-test.json"),
      `${JSON.stringify({
        name: "transaction-test",
        type: "component",
        dependencies: ["kleur@^4.1.5"],
        files: [
          {
            path: "transaction-test.ts",
            target: "src/transaction-test.ts",
            content: "export const installed = true;\n",
          },
        ],
      })}\n`,
    );
    await writeFile(
      join(root, "local-registry/registry.json"),
      `${JSON.stringify({
        items: [
          {
            name: "transaction-test",
            type: "component",
            title: "Transaction test",
            description: "Transaction test",
          },
        ],
      })}\n`,
    );
    await writeFile(
      join(root, "tuil.config.ts"),
      `export default {
  renderer: "ink",
  paths: {
    components: "./src/components/tuil",
    utilities: "./src/lib",
    hooks: "./src/hooks",
  },
  registry: {
    sources: [{id: "local", url: "./local-registry"}],
  },
  theme: {preset: "default"},
  packageManager: "bun",
};
`,
    );
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/transaction-test.ts"), "local source\n");
    const result = await run(root, [
      "add",
      "@local/transaction-test",
      "--output",
      "silent",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("untracked file");
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(
      originalPackage,
    );
    expect(await Bun.file(join(root, "bun.lock")).exists()).toBeFalse();
    expect(await readFile(join(root, "src/transaction-test.ts"), "utf8")).toBe(
      "local source\n",
    );
  });

  test("installs package dependencies introduced by registry updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-cli-"));
    directories.push(root);
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "registry-update", private: true })}\n`,
    );
    await mkdir(join(root, "local-registry"));
    const writeItem = async (
      content: string,
      dependencies: readonly string[],
    ) => {
      await writeFile(
        join(root, "local-registry/evolving.json"),
        `${JSON.stringify({
          name: "evolving",
          type: "component",
          dependencies,
          files: [
            {
              path: "evolving.ts",
              target: "src/evolving.ts",
              content,
            },
          ],
        })}\n`,
      );
    };
    await writeItem("export const version = 1;\n", []);
    await writeFile(
      join(root, "local-registry/registry.json"),
      `${JSON.stringify({ items: [] })}\n`,
    );
    await writeFile(
      join(root, "tuil.config.ts"),
      `export default {
  renderer: "ink",
  paths: {
    components: "./src/components/tuil",
    utilities: "./src/lib",
    hooks: "./src/hooks",
  },
  registry: {
    sources: [{id: "local", url: "./local-registry"}],
  },
  theme: {preset: "default"},
  packageManager: "bun",
};
`,
    );
    expect(
      (
        await run(root, [
          "add",
          "@local/evolving",
          "--no-install",
          "--output",
          "silent",
        ])
      ).exitCode,
    ).toBe(0);
    await writeItem("export const version = 2;\n", ["kleur@^4.1.5"]);
    const update = await run(root, [
      "update",
      "@local/evolving",
      "--output",
      "silent",
    ]);
    expect(update.exitCode).toBe(0);
    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.["kleur"]).toBeDefined();
    expect(await readFile(join(root, "src/evolving.ts"), "utf8")).toContain(
      "version = 2",
    );
  });

  test("installs bundled skills transactionally and rejects overlap", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-skills-"));
    directories.push(root);
    const source = join(root, "source");
    const destination = join(root, "destination");
    await mkdir(join(source, "alpha"), { recursive: true });
    await mkdir(join(source, "beta"), { recursive: true });
    await writeFile(join(source, "alpha/SKILL.md"), "alpha\n");
    await writeFile(join(source, "beta/SKILL.md"), "beta\n");
    await mkdir(join(destination, "beta"), { recursive: true });
    await writeFile(join(destination, "beta/SKILL.md"), "existing\n");
    await writeFile(join(destination, "unrelated.txt"), "preserve\n");

    await expect(installBundledSkills(source, destination)).rejects.toThrow(
      "Refusing to overwrite",
    );
    expect(
      await Bun.file(join(destination, "alpha/SKILL.md")).exists(),
    ).toBeFalse();
    expect(await readFile(join(destination, "beta/SKILL.md"), "utf8")).toBe(
      "existing\n",
    );
    await expect(
      installBundledSkills(source, source, { force: true }),
    ).rejects.toThrow("must not overlap");
    expect(await readFile(join(source, "alpha/SKILL.md"), "utf8")).toBe(
      "alpha\n",
    );

    expect(
      await installBundledSkills(source, destination, { force: true }),
    ).toEqual(["alpha", "beta"]);
    expect(await readFile(join(destination, "alpha/SKILL.md"), "utf8")).toBe(
      "alpha\n",
    );
    expect(await readFile(join(destination, "unrelated.txt"), "utf8")).toBe(
      "preserve\n",
    );

    const controller = new AbortController();
    controller.abort();
    await expect(
      installBundledSkills(source, destination, {
        force: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(await readFile(join(destination, "beta/SKILL.md"), "utf8")).toBe(
      "beta\n",
    );
    expect(await readFile(join(destination, "unrelated.txt"), "utf8")).toBe(
      "preserve\n",
    );
  });
});
