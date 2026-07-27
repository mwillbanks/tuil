import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface StaticDocsValidationOptions {
  readonly basePath?: string;
  readonly outDirectory?: string;
}

const requiredFiles = [
  ".nojekyll",
  "api/search",
  "docs/concepts/architecture/index.html",
  "docs/index.html",
  "docs/reference/components/forms/index.html",
  "docs/reference/packages/cli/index.html",
  "docs/reference/packages/tuil/index.html",
  "es/docs/concepts/architecture/index.html",
  "es/docs/index.html",
  "es/index.html",
  "index.html",
  "integrations/story-frames.json",
  "llms-full.txt",
  "llms.mdx/en/docs/index.md",
  "llms.mdx/es/docs/concepts/architecture/index.md",
  "llms.mdx/es/docs/index.md",
  "llms.txt",
  "logo.svg",
  "og/docs/en/image.webp",
  "playground/index.html",
  "showcase/index.html",
];

export function assertStaticDocs(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function normalizeBasePath(value: string): string {
  if (!value || value === "/") return "";
  return value.replace(/\/+$/, "").replace(/^([^/])/, "/$1");
}

async function requireFile(path: string): Promise<void> {
  assertStaticDocs(
    (await stat(path)).isFile(),
    `Expected static documentation file: ${path}`,
  );
}

function extractInternalTargets(home: string): string[] {
  return [...home.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)].map(
    (match) => match[1] as string,
  );
}

function validateHomeTargets(home: string, basePath: string): void {
  for (const target of [
    `${basePath}/_next/`,
    `${basePath}/docs/`,
    `${basePath}/logo.svg`,
  ]) {
    assertStaticDocs(
      home.includes(`"${target}`),
      `Static home page is missing base-path target "${target}"`,
    );
  }
  assertStaticDocs(
    !home.includes("/api/tuil-story"),
    "Static documentation retained the live story endpoint",
  );
}

function validateInternalTargets(
  internalTargets: readonly string[],
  basePath: string,
): void {
  assertStaticDocs(
    !basePath ||
      !internalTargets.some(
        (target) => target !== basePath && !target.startsWith(`${basePath}/`),
      ),
    "Static documentation emitted a root-relative target",
  );
}

async function validateStylesheet(
  internalTargets: readonly string[],
  outDirectory: string,
  basePath: string,
): Promise<void> {
  const stylesheet = internalTargets.find(
    (target) =>
      target.includes("/_next/static/chunks/") && target.endsWith(".css"),
  );
  assertStaticDocs(
    stylesheet,
    "Static documentation did not emit a stylesheet",
  );
  const stylesheetPath = stylesheet.slice(basePath.length).replace(/^\//, "");
  const css = await readFile(join(outDirectory, stylesheetPath), "utf8");
  assertStaticDocs(
    css.includes(".flex{display:flex}"),
    "Tailwind utilities were not compiled into the docs CSS",
  );
}

async function validateSearch(outDirectory: string): Promise<void> {
  const search = JSON.parse(
    await readFile(join(outDirectory, "api/search"), "utf8"),
  ) as unknown;
  assertStaticDocs(
    JSON.stringify(search).includes("/docs/reference/packages/tuil"),
    "Static documentation search index contains no package reference",
  );
}

async function validateIntegrations(outDirectory: string): Promise<void> {
  const frames = JSON.parse(
    await readFile(
      join(outDirectory, "integrations/story-frames.json"),
      "utf8",
    ),
  ) as readonly {
    readonly storyId?: string;
    readonly variant?: string;
    readonly frame?: string;
  }[];
  assertStaticDocs(
    frames.length >= 10 &&
      frames.every(
        (frame) => frame.storyId && frame.variant && frame.frame?.trim(),
      ),
    "Published playground and showcase frames are incomplete",
  );

  const playground = await readFile(
    join(outDirectory, "playground/index.html"),
    "utf8",
  );
  const showcase = await readFile(
    join(outDirectory, "showcase/index.html"),
    "utf8",
  );
  assertStaticDocs(
    playground.includes("Portable story controls") ||
      playground.includes("PORTABLE RUNTIME LAB"),
    "Static playground was not rendered",
  );
  assertStaticDocs(
    showcase.includes("COMPONENT GALLERY"),
    "Static showcase was not rendered",
  );
}

function containsEvery(value: string, fragments: readonly string[]): boolean {
  return fragments.every((fragment) => value.includes(fragment));
}

function containsNone(value: string, fragments: readonly string[]): boolean {
  return fragments.every((fragment) => !value.includes(fragment));
}

async function readMatchingTextFiles(
  directory: string,
  pattern: string,
): Promise<readonly string[]> {
  const contents: string[] = [];
  for await (const path of new Bun.Glob(pattern).scan({
    absolute: true,
    cwd: directory,
    onlyFiles: true,
  })) {
    contents.push(await readFile(path, "utf8"));
  }
  return contents;
}

function extractRootRelativeTargets(markdown: string): readonly string[] {
  return [
    ...markdown.matchAll(/\]\((\/[^)\s]+)\)/g),
    ...markdown.matchAll(/\b(?:href|src)=["'](\/[^"']+)["']/g),
  ].map((match) => match[1] as string);
}

function usesPathPrefix(target: string, prefix: string): boolean {
  if (!target.startsWith(prefix)) return false;
  const suffix = target.at(prefix.length);
  return (
    suffix === undefined || suffix === "/" || suffix === "?" || suffix === "#"
  );
}

function validateAIDeploymentPaths(
  index: string,
  full: string,
  raw: string,
  basePath: string,
): void {
  assertStaticDocs(
    containsEvery(index, [`](${basePath}/docs`]) &&
      containsEvery(full, [`Source: ${basePath}/docs`]) &&
      containsEvery(raw, [`Source: ${basePath}/docs`]),
    "AI documentation contains a URL without the deployment base path",
  );
  if (!basePath) return;
  assertStaticDocs(
    containsNone(index, ["](/docs", "](/es/docs"]) &&
      containsNone(full, ["Source: /docs", "Source: /es/docs"]),
    "AI documentation retained a domain-root documentation URL",
  );
}

async function validateLocalizedAIOutput(
  outDirectory: string,
  basePath: string,
): Promise<void> {
  const documents = await readMatchingTextFiles(
    join(outDirectory, "llms.mdx/es/docs"),
    "**/*.md",
  );
  assertStaticDocs(
    documents.length > 1 &&
      documents.every((document) =>
        document.includes(`Source: ${basePath}/es/docs`),
      ),
    "Localized AI documentation is incomplete",
  );
  const targets = documents.flatMap(extractRootRelativeTargets);
  assertStaticDocs(
    targets.some((target) => usesPathPrefix(target, `${basePath}/es/docs`)) &&
      targets.every((target) => !usesPathPrefix(target, `${basePath}/docs`)),
    "Localized AI documentation links leave the active locale",
  );
}

async function validateAIOutput(
  outDirectory: string,
  basePath: string,
): Promise<void> {
  const index = await readFile(join(outDirectory, "llms.txt"), "utf8");
  const full = await readFile(join(outDirectory, "llms-full.txt"), "utf8");
  const raw = await readFile(
    join(outDirectory, "llms.mdx/en/docs/index.md"),
    "utf8",
  );
  assertStaticDocs(
    containsEvery(index, ["Package Reference", "Architecture"]),
    "llms.txt does not index the core documentation",
  );
  assertStaticDocs(
    containsEvery(full, ["# @mwillbanks/tuil", "# Architecture"]),
    "llms-full.txt does not contain complete reference content",
  );
  validateAIDeploymentPaths(index, full, raw, basePath);
  await validateLocalizedAIOutput(outDirectory, basePath);
}

async function validateLocalizedHTML(outDirectory: string): Promise<void> {
  const documents = await readMatchingTextFiles(
    join(outDirectory, "es"),
    "**/*.html",
  );
  assertStaticDocs(
    documents.length > 2 &&
      documents.every((document) =>
        document.startsWith('<!DOCTYPE html><html lang="es"'),
      ),
    "One or more localized pages declares the wrong HTML language",
  );
}

async function validateDocsMetadataAndNavigation(
  outDirectory: string,
  basePath: string,
): Promise<void> {
  const docs = await readFile(join(outDirectory, "docs/index.html"), "utf8");
  const sidebarItems = [
    ...docs.matchAll(
      /<a data-active="[^"]+"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    ),
  ].filter((match) => match[1]?.startsWith(`${basePath || ""}/docs/`));
  assertStaticDocs(
    sidebarItems.length >= 10 &&
      sidebarItems.every((match) => match[2]?.includes("<svg")),
    "One or more documentation sidebar items is missing an icon",
  );
  const expectedOgImage = `https://mwillbanks.github.io${basePath}/og/docs/en/image.webp`;
  assertStaticDocs(
    docs.includes(`property="og:image" content="${expectedOgImage}"`),
    "Documentation Open Graph metadata is missing the base-path-aware image",
  );
  assertStaticDocs(
    !docs.includes("/tuil/tuil/"),
    "Documentation metadata duplicated the GitHub Pages base path",
  );

  const localizedHome = await readFile(
    join(outDirectory, "es/index.html"),
    "utf8",
  );
  const localizedDocs = await readFile(
    join(outDirectory, "es/docs/index.html"),
    "utf8",
  );
  await validateLocalizedHTML(outDirectory);
  assertStaticDocs(
    !localizedHome.includes('<html id="__next_error__"') &&
      localizedHome.includes(`href="${basePath}/es/docs/`),
    "Localized home page is not a static, locale-aware landing page",
  );
  const localizedCards = [
    ...localizedDocs.matchAll(/data-card="true"[^>]*href="([^"]+)"/g),
  ];
  assertStaticDocs(
    localizedCards.length > 0 &&
      localizedCards.every((match) =>
        match[1]?.startsWith(`${basePath}/es/docs/`),
      ),
    "Localized documentation card links leave the active locale",
  );
}

async function validateLogo(
  workspace: string,
  outDirectory: string,
): Promise<void> {
  const sourceLogo = await readFile(join(workspace, "logo.svg"), "utf8");
  const outputLogo = await readFile(join(outDirectory, "logo.svg"), "utf8");
  assertStaticDocs(
    outputLogo === sourceLogo,
    "Static documentation logo differs from logo.svg",
  );
}

export async function validateStaticDocs(
  options: StaticDocsValidationOptions = {},
): Promise<void> {
  const workspace = resolve(import.meta.dir, "../..");
  const outDirectory = options.outDirectory ?? join(workspace, "apps/docs/out");
  const basePath = normalizeBasePath(
    options.basePath ?? process.env["NEXT_PUBLIC_BASE_PATH"] ?? "",
  );
  await Promise.all(
    requiredFiles.map((path) => requireFile(join(outDirectory, path))),
  );

  const home = await readFile(join(outDirectory, "index.html"), "utf8");
  validateHomeTargets(home, basePath);
  const internalTargets = extractInternalTargets(home);
  validateInternalTargets(internalTargets, basePath);
  await validateStylesheet(internalTargets, outDirectory, basePath);
  await validateSearch(outDirectory);
  await validateIntegrations(outDirectory);
  await validateAIOutput(outDirectory, basePath);
  await validateDocsMetadataAndNavigation(outDirectory, basePath);
  await validateLogo(workspace, outDirectory);
}

await (import.meta.main ? validateStaticDocs() : undefined);
