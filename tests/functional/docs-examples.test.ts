import { starterManifest } from "../../packages/cli/src/starter-manifest.ts";
import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { optionalInkDevtoolsPlugin } from "../../tooling/build/optional-ink-devtools";

const workspace = resolve(import.meta.dir, "../..");
const contentRoot = resolve(workspace, "apps/docs/content/docs");
const codeLanguages = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "javascript",
  "typescript",
]);
const supportedLanguages = new Set([
  ...codeLanguages,
  "npm",
  "mermaid",
  "text",
  "json",
]);

interface Example {
  readonly path: string;
  readonly ordinal: number;
  readonly language: string;
  readonly code: string;
  readonly sourceContext?: string;
}

function examples(path: string, markdown: string): Example[] {
  const sourceLink = markdown.match(
    /https:\/\/github\.com\/mwillbanks\/tuil\/blob\/main\/([^\s)#]+)/,
  )?.[1];
  const registryImport = markdown.match(
    /from ["']@\/components\/tuil\/([^"']+)["']/,
  )?.[1];
  const packageImport = markdown.match(
    /from ["']@mwillbanks\/tuil(?:-([^"'/]+))?(?:\/[^"']*)?["']/,
  )?.[1];
  const sourceContext =
    sourceLink ??
    (registryImport
      ? "registry/" + registryImport + ".tsx"
      : packageImport
        ? "packages/" + packageImport + "/package.json"
        : undefined);
  return [...markdown.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)].map(
    (match, ordinal) => ({
      path,
      ordinal,
      language: match[1]!.trim().split(/\s+/)[0]!,
      code: match[2]!,
      sourceContext,
    }),
  );
}

function classify(example: Example): "complete" | "source-excerpt" | "prose" {
  if (!supportedLanguages.has(example.language))
    throw new Error(
      "Unclassified fence: " + example.path + ":" + example.ordinal,
    );
  if (!codeLanguages.has(example.language)) return "prose";
  if (/^import\s/m.test(example.code)) return "complete";
  if (example.path.includes("/reference/") && example.sourceContext)
    return "source-excerpt";
  throw new Error(
    "Snippet needs imports or explicit source context: " +
      example.path +
      ":" +
      example.ordinal,
  );
}

async function inventory(): Promise<Example[]> {
  const paths = [
    "README.md",
    ...Array.from(new Bun.Glob("**/*.mdx").scanSync({ cwd: contentRoot })).map(
      (path) => "apps/docs/content/docs/" + path,
    ),
  ].sort();
  const result: Example[] = [];
  for (const path of paths)
    result.push(
      ...examples(path, await Bun.file(resolve(workspace, path)).text()),
    );
  return result;
}

test("example inventory rejects unqualified snippets and unknown fence languages", () => {
  const fragment: Example = {
    path: "guide.mdx",
    ordinal: 0,
    language: "tsx",
    code: "<Missing />",
  };
  expect(() => classify(fragment)).toThrow("explicit source context");
  expect(() => classify({ ...fragment, language: "unknown" })).toThrow(
    "Unclassified fence",
  );
  expect(
    classify({
      ...fragment,
      code: 'import { Text } from "@mwillbanks/tuil-ink";\n<Text>Ready</Text>',
    }),
  ).toBe("complete");
  expect(
    classify({
      ...fragment,
      path: "docs/reference/example.mdx",
      sourceContext: "registry/components/button.tsx",
    }),
  ).toBe("source-excerpt");
});

function verifyDocumentedCommands(
  example: Example,
  workspaceScripts: Readonly<Record<string, string>>,
): void {
  expect(example.code.trim().length, example.path).toBeGreaterThan(0);
  const createsProject = /^bunx @mwillbanks\/tuil create ([\w-]+)$/m.exec(
    example.code,
  );
  const generatedDirectory =
    createsProject &&
    new RegExp("^cd " + createsProject[1] + "$", "m").test(example.code);
  const scripts: Readonly<Record<string, string>> = generatedDirectory
    ? starterManifest("example", []).scripts
    : workspaceScripts;
  for (const command of example.code.matchAll(/^bun run ([\w:-]+)/gm)) {
    expect(
      scripts[command[1]!],
      example.path + ": missing script " + command[1],
    ).toBeString();
  }
}

async function verifyExampleInventory(all: readonly Example[]) {
  const complete: Example[] = [];
  const counts = {
    complete: 0,
    sourceExcerpts: 0,
    commands: 0,
    diagrams: 0,
    data: 0,
  };
  const manifest = (await Bun.file(
    resolve(workspace, "package.json"),
  ).json()) as {
    scripts: Record<string, string>;
  };
  for (const example of all) {
    const kind = classify(example);
    if (kind === "complete") {
      complete.push(example);
      counts.complete++;
    } else if (kind === "source-excerpt") {
      counts.sourceExcerpts++;
      expect(
        await Bun.file(resolve(workspace, example.sourceContext!)).exists(),
        example.path,
      ).toBeTrue();
      new Bun.Transpiler({
        loader: example.language.includes("x") ? "tsx" : "ts",
      }).transformSync(
        example.code.replace(
          /^export (const|let|var) /gm,
          "export declare $1 ",
        ),
      );
    } else if (example.language === "npm") {
      counts.commands++;
      verifyDocumentedCommands(example, manifest.scripts);
    } else if (example.language === "mermaid") counts.diagrams++;
    else if (example.language === "json") {
      counts.data++;
      JSON.parse(example.code);
    } else counts.data++;
  }
  expect(complete.length).toBeGreaterThan(0);
  expect(counts.sourceExcerpts).toBeGreaterThan(0);
  return { complete, counts };
}

test("every documented example has a compile target or explicit owning source context", async () => {
  const { complete, counts } = await verifyExampleInventory(await inventory());
  const directory = await mkdtemp(resolve(workspace, ".tmp-doc-examples-"));
  try {
    const entrypoints: string[] = [];
    for (const [index, example] of complete.entries()) {
      const filename = example.path.replace(/[^a-zA-Z0-9.-]/g, "-");
      const entry = resolve(
        directory,
        index +
          "-" +
          filename +
          "-" +
          example.ordinal +
          (example.path.endsWith("/guides/testing.mdx") ? ".test.tsx" : ".tsx"),
      );
      const assertion = example.path.endsWith("/concepts/theming.mdx")
        ? 'if (ocean.id !== "ocean") throw new Error("Theme identity changed");'
        : example.path.endsWith("/guides/rich-documents.mdx")
          ? 'if (!editor.serialize("json").includes("Stop")) throw new Error("Rich document replacement failed");'
          : "";
      await Bun.write(
        entry,
        example.code + "\n" + assertion + "\nexport {};\n",
      );
      entrypoints.push(entry);
    }
    const build = await Bun.build({
      entrypoints,
      outdir: resolve(directory, "out"),
      target: "bun",
      splitting: true,
      define: {
        "process.env.NODE_ENV": '"production"',
        "process.env.DEV": "false",
      },
      external: ["@mwillbanks/tuil-ghostty-web"],
      plugins: [
        optionalInkDevtoolsPlugin,
        {
          name: "source-owned-doc-example-context",
          setup(build) {
            build.onResolve({ filter: /^@\/components\/tuil\// }, (args) => ({
              path:
                resolve(
                  workspace,
                  "registry",
                  args.path.slice("@/components/tuil/".length),
                ) + ".tsx",
            }));
          },
        },
      ],
    });
    expect(
      build.success,
      build.logs.map((log) => log.message).join("\n"),
    ).toBeTrue();

    const rootConfig = await Bun.file(
      resolve(workspace, "tsconfig.json"),
    ).json();
    const workspacePaths = Object.fromEntries(
      Object.entries(
        rootConfig.compilerOptions.paths as Record<string, string[]>,
      ).map(([name, paths]) => [
        name,
        paths.map((path) => resolve(workspace, path)),
      ]),
    );
    await Bun.write(
      resolve(directory, "tsconfig.json"),
      JSON.stringify({
        extends: resolve(workspace, "tsconfig.json"),
        compilerOptions: {
          paths: {
            ...workspacePaths,
            "@/components/tuil/*": [resolve(workspace, "registry/*")],
          },
          noUnusedLocals: false,
          noUnusedParameters: false,
        },
        files: entrypoints,
        include: [],
        exclude: [],
      }),
    );
    const check = Bun.spawn(
      [
        process.execPath,
        "check",
        "--no-script",
        "--project",
        resolve(directory, "tsconfig.json"),
      ],
      {
        cwd: workspace,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(check.stdout).text();
    const errors = await new Response(check.stderr).text();
    expect(await check.exited, output + errors).toBe(0);
    const runnableGuides = new Set([
      "apps/docs/content/docs/concepts/theming.mdx",
      "apps/docs/content/docs/guides/rich-documents.mdx",
      "apps/docs/content/docs/guides/testing.mdx",
    ]);
    let executed = 0;
    for (const [index, example] of complete.entries()) {
      if (!runnableGuides.has(example.path)) continue;
      const child = Bun.spawn(
        [
          process.execPath,
          ...(example.path.endsWith("/guides/testing.mdx")
            ? [
                "test",
                "--config",
                resolve(workspace, "tooling/bunfig.changed.toml"),
                entrypoints[index]!,
              ]
            : [
                "--eval",
                `await import(${JSON.stringify(entrypoints[index]!)}); process.exit(0);`,
              ]),
        ],
        {
          cwd: workspace,
          timeout: 10_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const stdout = await new Response(child.stdout).text();
      const stderr = await new Response(child.stderr).text();
      expect(await child.exited, example.path + "\n" + stdout + stderr).toBe(0);
      executed++;
    }
    expect(executed).toBe(runnableGuides.size);
    console.info(
      "Documentation example coverage: " +
        JSON.stringify({ ...counts, executed }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

test("documented CLI commands resolve through the built umbrella entry point", async () => {
  const cli = resolve(workspace, "packages/tuil/dist/cli.js");
  expect(
    await Bun.file(cli).exists(),
    "Build the package artifacts before functional qualification",
  ).toBeTrue();
  const directory = await mkdtemp(resolve(tmpdir(), "tuil-doc-cli-"));
  try {
    for (const args of [["--help"], ["init", "--help"], ["add", "--help"]]) {
      const child = Bun.spawn([process.execPath, cli, ...args], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(child.stdout).text();
      const stderr = await new Response(child.stderr).text();
      expect(await child.exited, stdout + stderr).toBe(0);
      expect(stdout + stderr).toMatch(/tuil|Usage|Options/i);
      expect(
        await readdir(directory),
        "Help must not create project files",
      ).toEqual([]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
