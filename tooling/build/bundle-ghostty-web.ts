import { resolve } from "node:path";

const workspace = resolve(import.meta.dir, "../..");
const packageDirectory = resolve(workspace, "packages/ghostty-web");
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
  os: resolve(shimDirectory, "os.ts"),
};
const productionExample = resolve(shimDirectory, "production-examples.tsx");

const result = await Bun.build({
  entrypoints: [resolve(packageDirectory, "src/browser.tsx")],
  outdir: resolve(packageDirectory, "dist"),
  target: "browser",
  format: "esm",
  sourcemap: "external",
  external: ["ghostty-web", "react", "react/jsx-runtime"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [
    {
      name: "tuil-browser-runtime-boundary",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (/^\.\.\/\.\.\/examples\/.+\/src\/index\.tsx$/u.test(args.path))
            return { path: productionExample };
          const replacement = aliases[args.path];
          return replacement ? { path: replacement } : undefined;
        });
      },
    },
  ],
});

if (!result.success) {
  throw new AggregateError(result.logs, "Ghostty browser bundle failed");
}
