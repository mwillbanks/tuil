import { resolve } from "node:path";
import { buildAll, spawnBuild } from "./build-all.ts";
import { buildEcosystem } from "./build-ecosystem.ts";
import { resolveBuildScope } from "./workspace-scope.ts";

const workspace = resolve(import.meta.dir, "../..");

export async function buildWorkspace(
  args = process.argv.slice(2),
): Promise<void> {
  const scope = await resolveBuildScope(workspace, args);
  if (scope.buildRegistry) {
    if ((await spawnBuild(["bun", "run", "registry:build"], workspace)) !== 0) {
      throw new Error("Registry build failed");
    }
  }
  await buildAll({ include: scope.workspaceNames });
  await buildEcosystem({ include: scope.workspaceNames });
}

await (import.meta.main ? buildWorkspace() : undefined);
