import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateReferenceDocs } from "../../../tooling/docs/generate-reference.ts";
import { prepareDocsAssets } from "../../../tooling/docs/prepare-assets.ts";
import { GET } from "./app/api/search/route.ts";
import { getLLMText } from "./lib/get-llm-text.ts";
import {
  localeFromPath,
  localizeDocsHref,
  localizeMarkdownDocsPaths,
} from "./lib/i18n.ts";
import { source } from "./lib/source.ts";

async function countFiles(pattern: string, cwd: string): Promise<number> {
  let count = 0;
  for await (const _path of new Bun.Glob(pattern).scan({ cwd })) count += 1;
  return count;
}

test("Fumadocs source exposes the documentation tree", () => {
  expect(source.getPage([], "en")?.url).toBe("/docs");
  for (const page of [
    ["introduction", "quick-start"],
    ["concepts", "architecture"],
    ["concepts", "events"],
    ["guides", "authoring-plugins"],
    ["guides", "testing"],
    ["reference"],
    ["reference", "packages", "tuil"],
    ["reference", "components", "initializer"],
  ]) {
    expect(source.getPage(page, "en")?.url).toBe(`/docs/${page.join("/")}`);
  }
  expect(source.getPage(["concepts", "architecture"], "es")?.url).toBe(
    "/es/docs/concepts/architecture",
  );
  expect(source.getLanguages().map(({ language }) => language)).toEqual([
    "en",
    "es",
  ]);
});

test("documentation search exposes the static export handler", () => {
  expect(GET).toBeFunction();
});

test("localized documentation keeps search and content links in locale", () => {
  expect(localeFromPath("/es/docs/concepts/events")).toBe("es");
  expect(localeFromPath("/docs/concepts/events")).toBe("en");
  expect(localizeDocsHref("/docs/concepts/events", "es")).toBe(
    "/es/docs/concepts/events",
  );
  expect(localizeDocsHref("/playground", "es")).toBe("/playground");
  expect(localizeDocsHref("/docs#install", "es")).toBe("/es/docs#install");
  expect(localizeDocsHref("/docs?tab=api", "es")).toBe("/es/docs?tab=api");
  expect(localizeDocsHref("https://example.com/docs", "es")).toBe(
    "https://example.com/docs",
  );
  expect(
    localizeMarkdownDocsPaths(
      '[Architecture](/docs/concepts/architecture) [Install](/docs#install) <Card href="/docs?tab=api" />',
      "es",
    ),
  ).toBe(
    '[Architecture](/es/docs/concepts/architecture) [Install](/es/docs#install) <Card href="/es/docs?tab=api" />',
  );
});

test("localized LLM text applies locale before the deployment base path", async () => {
  const previousBasePath = process.env["NEXT_PUBLIC_BASE_PATH"];
  process.env["NEXT_PUBLIC_BASE_PATH"] = "/tuil";
  try {
    const page = {
      data: {
        description: "Localized page",
        getText: () =>
          Promise.resolve(
            '[Install](/docs#install) <Card href="/docs/reference" />',
          ),
        title: "Introduction",
      },
      locale: "es",
      url: "/es/docs",
    } as unknown as Parameters<typeof getLLMText>[0];
    const text = await getLLMText(page);
    expect(text).toContain("Source: /tuil/es/docs");
    expect(text).toContain("[Install](/tuil/es/docs#install)");
    expect(text).toContain('href="/tuil/es/docs/reference"');
    expect(text).not.toContain("](/tuil/docs");
  } finally {
    if (previousBasePath === undefined) {
      delete process.env["NEXT_PUBLIC_BASE_PATH"];
    } else {
      process.env["NEXT_PUBLIC_BASE_PATH"] = previousBasePath;
    }
  }
});

test("reference generation covers every package and component family", async () => {
  await generateReferenceDocs();
  const contentRoot = resolve(import.meta.dir, "../content/docs/reference");
  expect(await countFiles("packages/*/index.mdx", contentRoot)).toBe(30);
  expect(await countFiles("components/*/index.mdx", contentRoot)).toBe(16);
  const cliReference = await readFile(
    join(contentRoot, "packages/cli/index.mdx"),
    "utf8",
  );
  expect(cliReference).toContain("| `InitWizard` | export |");
  expect(cliReference).toContain("| `main` | function |");
  expect(cliReference).not.toContain("| `App` |");
  expect(cliReference).not.toContain("| `operands` |");
});

test("generated package examples compile their documented imports", async () => {
  await generateReferenceDocs();
  const contentRoot = resolve(import.meta.dir, "../content/docs/reference");
  const directory = await mkdtemp(
    resolve(import.meta.dir, "../../../.tmp-doc-snippets-"),
  );
  const entrypoints: string[] = [];
  try {
    for await (const path of new Bun.Glob("packages/*/index.mdx").scan({
      cwd: contentRoot,
      absolute: true,
    })) {
      const content = await Bun.file(path).text();
      const snippets = [...content.matchAll(/```tsx\n([\s\S]*?)```/g)]
        .map((match) => match[1] ?? "")
        .filter((snippet) => snippet.includes('from "@mwillbanks/'));
      for (const [index, snippet] of snippets.entries()) {
        const entrypoint = join(
          directory,
          `${path.split("/").at(-2) ?? "package"}-${index}.tsx`,
        );
        await writeFile(entrypoint, snippet);
        entrypoints.push(entrypoint);
      }
    }
    expect(entrypoints.length).toBeGreaterThan(0);
    const result = await Bun.build({
      entrypoints,
      outdir: join(directory, "out"),
      target: "bun",
    });
    expect(
      result.success,
      result.logs.map((log) => log.message).join("\n"),
    ).toBeTrue();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("documentation assets preserve the repository-owned logo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tuil-docs-"));
  const logoSource = resolve(import.meta.dir, "../../../logo.svg");
  try {
    await prepareDocsAssets({
      logoSource,
      publicDirectory: directory,
      storyFrames: [
        {
          id: "foundation:Running",
          storyId: "foundation",
          storyTitle: "Components/Foundation",
          variant: "Running",
          frame: "Build pipeline",
          events: [],
          focus: ["Run build (button)"],
          controls: {
            height: 24,
            interactive: true,
            theme: "default-dark",
            width: 80,
          },
        },
      ],
    });
    expect(await readFile(join(directory, "logo.svg"), "utf8")).toBe(
      await readFile(logoSource, "utf8"),
    );
    expect(await readFile(join(directory, ".nojekyll"), "utf8")).toBe("");
    expect(
      JSON.parse(
        await readFile(
          join(directory, "integrations/story-frames.json"),
          "utf8",
        ),
      ),
    ).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("package-manager commands use translatable npm code fences", async () => {
  const contentRoot = resolve(import.meta.dir, "../content/docs");
  const nonTranslatable: string[] = [];
  for await (const path of new Bun.Glob("**/*.mdx").scan({
    cwd: contentRoot,
    absolute: true,
  })) {
    const content = await Bun.file(path).text();
    const commandFence =
      /```(?:bash|sh|shell|zsh)\n[\s\S]*?(?:\bnpm\b|\bnpx\b|\bbun\b|\bbunx\b|\byarn\b|\bpnpm\b)[\s\S]*?```/g;
    if (commandFence.test(content)) {
      nonTranslatable.push(path);
    }
  }
  expect(nonTranslatable).toEqual([]);
});

test("every documentation navigation item declares an icon", async () => {
  const contentRoot = resolve(import.meta.dir, "../content/docs");
  const missingIcons: string[] = [];
  for await (const path of new Bun.Glob("**/*.{mdx,json}").scan({
    cwd: contentRoot,
    absolute: true,
  })) {
    const content = await Bun.file(path).text();
    if (
      (path.endsWith(".mdx") && !/^icon:\s+\w+/m.test(content)) ||
      (path.endsWith("meta.json") &&
        path !== join(contentRoot, "meta.json") &&
        !/"icon":\s*"\w+"/.test(content))
    ) {
      missingIcons.push(path);
    }
  }
  expect(missingIcons).toEqual([]);
});
