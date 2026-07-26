import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareDocsAssets } from "../../../tooling/docs/prepare-assets.ts";
import { GET } from "./app/api/search/route.ts";
import { source } from "./lib/source.ts";

test("Fumadocs source exposes the documentation tree", () => {
  expect(source.getPage([])?.url).toBe("/docs");
  for (const section of [
    "guides",
    "api",
    "registry",
    "architecture",
    "examples",
    "skills",
    "migration",
  ]) {
    expect(source.getPage([section])?.url).toBe(`/docs/${section}`);
  }
  expect(source.getPage(["components", "initializer"])?.url).toBe(
    "/docs/components/initializer",
  );
});

test("documentation search exposes the static export handler", () => {
  expect(GET).toBeFunction();
});

test("documentation assets preserve the repository-owned logo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tuil-docs-"));
  const logoSource = resolve(import.meta.dir, "../../../logo.svg");
  try {
    await prepareDocsAssets({
      logoSource,
      publicDirectory: directory,
    });
    expect(await readFile(join(directory, "logo.svg"), "utf8")).toBe(
      await readFile(logoSource, "utf8"),
    );
    expect(await readFile(join(directory, ".nojekyll"), "utf8")).toBe("");
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
