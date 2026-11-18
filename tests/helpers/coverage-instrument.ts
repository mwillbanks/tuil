import type { BunPlugin } from "bun";
import { createInstrumenter } from "istanbul-lib-instrument";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const coverageVariable = "__tuilCoverage__";
const rootDirectory = resolve(import.meta.dir, "../..");

export function instrumentCoverageSource(path: string, source: string): string {
  const instrumenter = createInstrumenter({
    coverageVariable,
    coverageGlobalScope: "globalThis",
    coverageGlobalScopeFunc: false,
    produceSourceMap: true,
    parserPlugins: path.endsWith(".tsx")
      ? ["typescript", "jsx", "importAttributes"]
      : ["typescript", "importAttributes"],
  });
  const instrumented = instrumenter.instrumentSync(source, path);
  const map = instrumenter.lastSourceMap();
  return map
    ? instrumented +
        "\n//# sourceMappingURL=data:application/json;base64," +
        Buffer.from(JSON.stringify(map)).toString("base64")
    : instrumented;
}

export async function createCoveragePlugin(
  root = rootDirectory,
  paths?: readonly string[],
): Promise<BunPlugin> {
  const enabled = (
    paths ??
    (await (
      await import("../../tooling/coverage/check.ts")
    ).coverageSources(root))
  ).map((path) => RegExp.escape(resolve(root, path)));
  const filter = enabled.length
    ? new RegExp("^(" + enabled.join("|") + ")$")
    : /(?!)/;
  return {
    name: "TUIL test coverage",
    setup(build) {
      build.onLoad({ filter }, ({ path }) => {
        return {
          contents: instrumentCoverageSource(path, readFileSync(path, "utf8")),
          loader: path.endsWith(".tsx") ? "tsx" : "ts",
        };
      });
    },
  };
}
