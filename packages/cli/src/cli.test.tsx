import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderTuil } from "@mwillbanks/tuil-testing-ink";
import { type InitAnswers, InitWizard } from "./index.tsx";

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
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts).toHaveProperty("typecheck");
    expect(await readFile(join(root, "demo/src/index.tsx"), "utf8")).toContain(
      "createApp",
    );
    expect(
      await readFile(
        join(root, "demo/src/components/tuil/components/app-shell.tsx"),
        "utf8",
      ),
    ).toContain("export function AppShell");
    expect(
      await readFile(join(root, "demo/src/features/project-form.ts"), "utf8"),
    ).toContain("validateProjectForm");
    expect(
      await readFile(join(root, "demo/src/workflows/main.ts"), "utf8"),
    ).toContain("nextWorkflowStep");
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
    }
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
    await view.user.press("enter");
    await Bun.sleep(10);
    await view.user.press("tab");
    await view.user.press("enter");
    await Bun.sleep(10);
    await view.user.press("enter");
    await view.user.press("tab");
    await view.user.press("tab");
    await view.user.press("tab");
    await view.user.press("enter");
    expect(answers).toEqual({
      name: "demo",
      template: "application",
      features: ["router"],
    });
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
});
