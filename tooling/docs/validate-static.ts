import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface StaticDocsValidationOptions {
  readonly basePath?: string;
  readonly outDirectory?: string;
}

const requiredFiles = [
  ".nojekyll",
  "api/search",
  "docs/architecture/index.html",
  "docs/guides/index.html",
  "docs/index.html",
  "index.html",
  "logo.svg",
];

function normalizeBasePath(value: string): string {
  if (!value || value === "/") return "";
  return value.replace(/\/+$/, "").replace(/^([^/])/, "/$1");
}

async function requireFile(path: string): Promise<void> {
  if (!(await stat(path)).isFile()) {
    throw new Error(`Expected static documentation file: ${path}`);
  }
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
    if (!home.includes(`"${target}`)) {
      throw new Error(
        `Static home page is missing base-path target "${target}"`,
      );
    }
  }
  if (home.includes("/api/tuil-story")) {
    throw new Error("Static documentation retained the live story endpoint");
  }
}

function validateInternalTargets(
  internalTargets: readonly string[],
  basePath: string,
): void {
  if (
    basePath &&
    internalTargets.some(
      (target) => target !== basePath && !target.startsWith(`${basePath}/`),
    )
  ) {
    throw new Error("Static documentation emitted a root-relative target");
  }
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
  if (!stylesheet) {
    throw new Error("Static documentation did not emit a stylesheet");
  }
  const stylesheetPath = stylesheet.slice(basePath.length).replace(/^\//, "");
  const css = await readFile(join(outDirectory, stylesheetPath), "utf8");
  if (!css.includes(".flex{display:flex}")) {
    throw new Error("Tailwind utilities were not compiled into the docs CSS");
  }
}

async function validateSearch(outDirectory: string): Promise<void> {
  const search = JSON.parse(
    await readFile(join(outDirectory, "api/search"), "utf8"),
  ) as unknown;
  if (!JSON.stringify(search).includes("/docs")) {
    throw new Error("Static documentation search index contains no docs");
  }
}

async function validateLogo(
  workspace: string,
  outDirectory: string,
): Promise<void> {
  const sourceLogo = await readFile(join(workspace, "logo.svg"), "utf8");
  const outputLogo = await readFile(join(outDirectory, "logo.svg"), "utf8");
  if (outputLogo !== sourceLogo) {
    throw new Error("Static documentation logo differs from logo.svg");
  }
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
  await validateLogo(workspace, outDirectory);
}

if (import.meta.main) {
  await validateStaticDocs();
}
