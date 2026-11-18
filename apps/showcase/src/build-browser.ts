import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBrowserShowcaseCatalog } from "./catalog.ts";
import { createCoveragePlugin } from "../../../tests/helpers/coverage-instrument.ts";

export async function buildBrowserShowcase(
  options: {
    readonly coverage?: boolean;
    readonly outputDirectory?: string;
  } = {},
): Promise<void> {
  const application = resolve(import.meta.dir, "..");
  const output =
    options.outputDirectory ??
    resolve(
      application,
      options.coverage ? "dist/browser-coverage" : "dist/browser",
    );
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const coveragePlugin = options.coverage
    ? await createCoveragePlugin(resolve(application, "../.."))
    : undefined;
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "browser.tsx")],
    outdir: output,
    target: "browser",
    format: "esm",
    sourcemap: "external",
    minify: true,
    naming: "[name].[ext]",
    define: options.coverage
      ? {
          global: "globalThis",
          "process.env.NODE_ENV": JSON.stringify("production"),
          "process.env.DEV": JSON.stringify("false"),
        }
      : { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      ...(coveragePlugin ? [coveragePlugin] : []),
      {
        name: "showcase-browser-runtime",
        setup(build) {
          const packageDirectory = resolve(
            application,
            "../../packages/ghostty-web",
          );
          const shimDirectory = resolve(packageDirectory, "src/shims");
          const aliases: Readonly<Record<string, string>> = {
            "@mwillbanks/tuil-code": resolve(shimDirectory, "code.ts"),
            "ansi-escapes": resolve(shimDirectory, "ansi-escapes.ts"),
            "node:events": resolve(shimDirectory, "events.ts"),
            events: resolve(shimDirectory, "events.ts"),
            "node:fs": resolve(shimDirectory, "fs.ts"),
            fs: resolve(shimDirectory, "fs.ts"),
            "node:fs/promises": resolve(shimDirectory, "fs-promises.ts"),
            "fs/promises": resolve(shimDirectory, "fs-promises.ts"),
            "node:path": resolve(shimDirectory, "path.ts"),
            path: resolve(shimDirectory, "path.ts"),
            "node:process": resolve(shimDirectory, "process.ts"),
            process: resolve(shimDirectory, "process.ts"),
            "node:stream": resolve(shimDirectory, "stream.ts"),
            stream: resolve(shimDirectory, "stream.ts"),
            "node:buffer": "buffer",
            "es-toolkit/compat": resolve(shimDirectory, "es-toolkit-compat.ts"),
            "node:module": resolve(shimDirectory, "module.ts"),
            module: resolve(shimDirectory, "module.ts"),
            "node:os": resolve(shimDirectory, "os.ts"),
            "node:url": resolve(shimDirectory, "url.ts"),
            os: resolve(shimDirectory, "os.ts"),
          };
          const productionExample = resolve(
            shimDirectory,
            "production-examples.tsx",
          );
          build.onLoad(
            { filter: /^ink-devtools$/, namespace: "terminal-only" },
            () => ({ contents: "export {};" }),
          );
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "@mwillbanks/tuil-ghostty-web") {
              return {
                path: resolve(
                  packageDirectory,
                  options.coverage ? "src/browser.tsx" : "dist/browser.js",
                ),
              };
            }
            if (
              args.path.includes("/examples/") &&
              args.path.endsWith("/src/index.tsx")
            )
              return { path: productionExample };
            if (
              args.path === "./devtools.js" &&
              (args.importer.includes("/ink/build/reconciler.js") ||
                args.importer.includes("\\ink\\build\\reconciler.js"))
            ) {
              return { path: "ink-devtools", namespace: "terminal-only" };
            }
            const replacement = aliases[args.path];
            return replacement ? { path: replacement } : undefined;
          });
        },
      },
    ],
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Showcase browser bundle failed");
  }
  const catalog = await createBrowserShowcaseCatalog();
  await Bun.write(resolve(output, "catalog.json"), JSON.stringify(catalog));
  await copyFile(
    resolve(import.meta.dir, "showcase.css"),
    resolve(output, "showcase.css"),
  );
  const wasm = fileURLToPath(
    import.meta.resolve(
      "ghostty-web/ghostty-vt.wasm",
      resolve(application, "../../packages/ghostty-web/package.json"),
    ),
  );
  await copyFile(wasm, resolve(output, "ghostty-vt.wasm"));
  await Bun.write(
    resolve(output, "index.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TUIL Showcase</title><link rel="stylesheet" href="./showcase.css"></head><body><div id="showcase-root"></div><script type="module" src="./browser.js"></script></body></html>\n',
  );
}

if (import.meta.main) await buildBrowserShowcase();
