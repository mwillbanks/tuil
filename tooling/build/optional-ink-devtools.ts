// Ink's development-only dependency is loaded only by terminal DevTools clients.
export const optionalInkDevtoolsPlugin: Bun.BunPlugin = {
  name: "optional-ink-devtools",
  setup(build) {
    build.onResolve({ filter: /^\.\/devtools\.js$/u }, (args) => {
      if (args.importer.endsWith("/ink/build/reconciler.js")) {
        return { path: "disabled", namespace: "ink-devtools" };
      }
    });
    build.onLoad({ filter: /^disabled$/, namespace: "ink-devtools" }, () => ({
      contents: "export {};",
      loader: "js",
    }));
  },
};
