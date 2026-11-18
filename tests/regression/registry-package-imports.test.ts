import { expect, test } from "bun:test";
import { isBuiltin } from "node:module";
import { generatedRegistryItems } from "../../packages/cli/src/generated-registry.ts";

test("source-owned registry artifacts declare their direct package imports", () => {
  const missing: string[] = [];
  for (const item of generatedRegistryItems) {
    const dependencies = new Set<string>(item.dependencies ?? []);
    for (const file of item.files) {
      if (!/\.tsx?$/.test(file.target) || !("content" in file)) continue;
      const loader = file.target.endsWith(".tsx") ? "tsx" : "ts";
      const scanner = new Bun.Transpiler({ loader });
      for (const imported of scanner.scanImports(file.content)) {
        if (imported.path.startsWith(".") || isBuiltin(imported.path)) continue;
        const segments = imported.path.split("/");
        const dependency = segments
          .slice(0, imported.path.startsWith("@") ? 2 : 1)
          .join("/");
        if (!dependencies.has(dependency))
          missing.push(item.name + " imports " + dependency);
      }
    }
  }
  expect([...new Set(missing)]).toEqual([]);
});
