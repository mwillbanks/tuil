import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPublishArtifacts } from "../../../tooling/release/artifacts.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(value)}\n`);
}

test("discovers validated publication artifacts and rejects stale output", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "tuil-artifacts-"));
  try {
    const packageRoot = join(workspace, "packages");
    await mkdir(join(packageRoot, "core/dist"), { recursive: true });
    await mkdir(join(packageRoot, "private"), { recursive: true });
    await mkdir(join(packageRoot, "empty"), { recursive: true });
    await Bun.write(join(packageRoot, "README.md"), "not a package");
    await writeJson(join(packageRoot, "core/package.json"), {
      name: "@example/core",
      version: "1.0.0",
      dependencies: { "@example/shared": "workspace:*" },
      optionalDependencies: {
        "@example/shared": "workspace:*",
        "@example/optional": "workspace:*",
      },
    });
    await writeJson(join(packageRoot, "core/dist/package.json"), {
      name: "@example/core",
      version: "1.0.0",
    });
    await writeJson(join(packageRoot, "private/package.json"), {
      name: "@example/private",
      version: "1.0.0",
      private: true,
    });
    const artifacts = await discoverPublishArtifacts(workspace);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.workspaceDependencies).toEqual([
      "@example/shared",
      "@example/optional",
    ]);

    await mkdir(join(packageRoot, "missing"), { recursive: true });
    await writeJson(join(packageRoot, "missing/package.json"), {
      name: "@example/missing",
      version: "1.0.0",
    });
    await expect(discoverPublishArtifacts(workspace)).rejects.toThrow(
      "Missing publication artifact",
    );
    await rm(join(packageRoot, "missing"), { recursive: true });

    await writeJson(join(packageRoot, "core/dist/package.json"), {
      name: "@example/core",
      version: "2.0.0",
    });
    await expect(discoverPublishArtifacts(workspace)).rejects.toThrow(
      "identity mismatch",
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
