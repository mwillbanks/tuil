import { plugin } from "bun";
import { createMdxPlugin } from "fumadocs-mdx/bun";
import { createFromSource } from "fumadocs-core/search/server";
import { llms } from "fumadocs-core/source";
import { generate as DefaultImage } from "fumadocs-ui/og/takumi";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { ImageResponse } from "takumi-js/response";
import { StaticApplication } from "./components/static-application";
import { playgroundMetadata } from "./app/playground/page";
import { showcaseMetadata } from "./app/showcase/page";
import {
  getBasePath,
  prefixMarkdownDeploymentPaths,
  withBasePath,
} from "./lib/base-path";
import type { StaticRoute } from "./lib/static-types";
import { restoreElements } from "./lib/static-route";

const docsRoot = resolve(import.meta.dir, "..");
const workspace = resolve(docsRoot, "../..");
const output = resolve(docsRoot, "out");
const configuration = resolve(docsRoot, "source.config.ts");
let loaderRegistered = false;

function serializableRoute(route: StaticRoute): string {
  return JSON.stringify(route, (_key, value: unknown) => {
    if (isValidElement(value)) return { __html: renderToStaticMarkup(value) };
    return value;
  })
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

async function writeOutput(path: string, content: string | Uint8Array) {
  const destination = resolve(output, path);
  if (!destination.startsWith(output + sep))
    throw new Error("Output path leaves the docs directory");
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, content);
}

async function run(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: docsRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error("Documentation command failed: " + command.join(" "));
}

export async function exportDocs(): Promise<void> {
  process.chdir(docsRoot);
  if (!loaderRegistered) {
    await plugin(createMdxPlugin({ configPath: configuration }));
    loaderRegistered = true;
  }
  const { source, getPageImageUrl } = await import("./lib/source");
  const { getLLMText } = await import("./lib/get-llm-text");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(resolve(docsRoot, "public"), output, { recursive: true });
  await cp(resolve(workspace, "logo.svg"), resolve(output, "logo.svg"));
  await writeOutput(".nojekyll", "");

  const pages = source.getPages("en");
  const imports = pages.map((page) => {
    const documentPath = resolve(docsRoot, "content/docs", page.path);
    return (
      JSON.stringify(page.path) +
      ": () => import(" +
      JSON.stringify(documentPath) +
      ")"
    );
  });
  const clientContent =
    'import type { MDXContent } from "mdx/types";\n' +
    "const documents: Record<string, () => Promise<{default: MDXContent}>> = {\n" +
    imports.join(",\n") +
    "\n};\n" +
    "export async function loadDocument(path: string) {\n" +
    "  const load = documents[path];\n" +
    '  if (!load) throw new Error("Unknown documentation page: " + path);\n' +
    "  return load();\n}\n";

  const build = await Bun.build({
    entrypoints: [resolve(docsRoot, "src/client.tsx")],
    outdir: resolve(output, "assets"),
    target: "browser",
    splitting: true,
    minify: true,
    sourcemap: "external",
    naming: {
      entry: "[name].[ext]",
      chunk: "[name]-[hash].[ext]",
      asset: "[name]-[hash].[ext]",
    },
    define: {
      "process.env.TUIL_DOCS_BASE_PATH": JSON.stringify(getBasePath()),
      "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(getBasePath()),
      "process.env.NODE_ENV": '"production"',
    },
    plugins: [
      {
        name: "tuil-docs-pages",
        setup(build) {
          build.onResolve(
            { filter: /^@mwillbanks\/tuil-ghostty-web$/ },
            () => ({
              path: resolve(workspace, "packages/ghostty-web/dist/browser.js"),
            }),
          );
          build.onResolve({ filter: /^tuil:docs-content$/ }, () => ({
            path: "docs-content",
            namespace: "tuil",
          }));
          build.onResolve({ filter: /./, namespace: "tuil" }, (args) => ({
            path: args.path,
            namespace: "file",
          }));
          build.onLoad({ filter: /.*/, namespace: "tuil" }, () => ({
            contents: clientContent,
            loader: "ts",
            resolveDir: docsRoot,
          }));
        },
      },
      createMdxPlugin({ configPath: configuration }),
    ],
  });
  if (!build.success)
    throw new AggregateError(build.logs, "Documentation browser bundle failed");
  await run([
    process.execPath,
    resolve(workspace, "node_modules/.bin/tailwindcss"),
    "-i",
    resolve(docsRoot, "src/app/globals.css"),
    "-o",
    resolve(output, "assets/docs.css"),
    "--minify",
  ]);

  const basePath = getBasePath();
  async function render(
    route: StaticRoute,
    body?: Parameters<typeof StaticApplication>[0]["body"],
  ) {
    const encodedRoute = serializableRoute(route);
    const restoredRoute = restoreElements(
      JSON.parse(encodedRoute),
    ) as StaticRoute;
    const content = renderToString(
      createElement(StaticApplication, { route: restoredRoute, body }),
    );
    const canonical =
      "https://mwillbanks.github.io" + withBasePath(route.pathname);
    const image = route.page
      ? "https://mwillbanks.github.io" +
        getPageImageUrl(source.getPage(route.page.slugs, "en")!).url
      : undefined;
    const head =
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>" +
      escapeAttribute(route.title + " · tuil") +
      "</title>" +
      '<meta name="description" content="' +
      escapeAttribute(route.description ?? "") +
      '">' +
      '<link rel="canonical" href="' +
      escapeAttribute(canonical) +
      '">' +
      '<meta property="og:title" content="' +
      escapeAttribute(route.title) +
      '">' +
      '<meta property="og:description" content="' +
      escapeAttribute(route.description ?? "") +
      '">' +
      '<meta property="og:type" content="website"><meta property="og:site_name" content="tuil">' +
      '<meta property="og:url" content="' +
      escapeAttribute(canonical) +
      '">' +
      (image
        ? '<meta property="og:image" content="' + escapeAttribute(image) + '">'
        : "") +
      '<link rel="icon" href="' +
      basePath +
      '/logo.svg">' +
      '<link rel="stylesheet" href="' +
      basePath +
      '/assets/docs.css">';
    const html =
      '<!doctype html><html lang="en" class="dark"><head>' +
      head +
      '</head><body class="font-sans">' +
      '<div id="tuil-root">' +
      content +
      "</div>" +
      '<script type="application/json" id="tuil-route-data">' +
      encodedRoute +
      "</script>" +
      '<script type="module" src="' +
      basePath +
      '/assets/client.js"></script></body></html>';
    const pathname = route.pathname.replace(/^\/+|\/+$/g, "");
    await writeOutput(pathname ? pathname + "/index.html" : "index.html", html);
  }

  const home = {
    kind: "home",
    pathname: "/",
    title: "Terminal UI, without the runtime tax",
    description: "Build terminal applications with React, Ink, and Bun.",
  } as const;
  await render(home);
  await render({
    kind: "playground",
    pathname: "/playground/",
    ...playgroundMetadata,
  });
  await render({
    kind: "showcase",
    pathname: "/showcase/",
    ...showcaseMetadata,
  });
  await render({
    kind: "redirect",
    pathname: "/es/",
    title: "Documentation moved",
  });

  const markdown: string[] = [];
  const tree = source.getPageTree("en");
  for (const page of pages) {
    const { body, toc, title, description, full } = page.data;
    const route: StaticRoute = {
      kind: "docs",
      pathname: page.url.replace(/\/?$/, "/"),
      title,
      description,
      tree,
      page: {
        path: page.path,
        url: page.url,
        slugs: page.slugs,
        locale: page.locale,
        data: { title, description, full, toc },
      },
    };
    await render(route, body);
    const text = await getLLMText(page);
    markdown.push(text);
    await writeOutput(
      ["llms.mdx", "en", "docs", ...page.slugs, "index.md"].join("/"),
      text,
    );
    const image = new ImageResponse(
      createElement(DefaultImage, { title, description, site: "tuil" }),
      { format: "webp", height: 630, width: 1200 },
    );
    await writeOutput(
      "og/docs/" + getPageImageUrl(page).segments.join("/"),
      new Uint8Array(await image.arrayBuffer()),
    );
  }
  const search = createFromSource(source, { localeMap: { en: "english" } });
  await writeOutput("api/search", await (await search.staticGET()).text());
  await writeOutput(
    "llms.txt",
    prefixMarkdownDeploymentPaths(llms(source).index()),
  );
  await writeOutput("llms-full.txt", markdown.join("\n\n---\n\n"));
  await writeOutput(
    "routes.json",
    JSON.stringify(
      {
        basePath,
        pages: [
          "/",
          "/playground/",
          "/showcase/",
          "/es/",
          ...pages.map((page) => page.url.replace(/\/?$/, "/")),
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Exported " +
      pages.length +
      " Fumadocs pages to " +
      relative(workspace, output),
  );
}
