import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverPublishArtifacts,
  npmPackArguments,
  npmPublishArguments,
  orderPublishArtifacts,
  type PublishArtifact,
} from "./artifacts.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(value)}\n`);
}

test("packs and publishes the same normalized dist artifact", () => {
  expect(npmPackArguments("/tmp/releases")[0]).toBe("npm");
  expect(npmPublishArguments()).toEqual([
    "npm",
    "publish",
    "--access",
    "public",
    "--provenance",
    "--tag",
    "latest",
  ]);
  expect(npmPublishArguments("next").at(-1)).toBe("next");
});

test("publishes workspace dependencies before their consumers", () => {
  const artifact = (
    name: string,
    workspaceDependencies: readonly string[] = [],
  ): PublishArtifact => ({
    name,
    version: "1.0.0",
    sourceDirectory: `/source/${name}`,
    artifactDirectory: `/artifact/${name}`,
    workspaceDependencies,
  });
  const ordered = orderPublishArtifacts([
    artifact("@mwillbanks/tuil", [
      "@mwillbanks/tuil-story",
      "@mwillbanks/tuil-core",
    ]),
    artifact("@mwillbanks/tuil-story", ["@mwillbanks/tuil-core"]),
    artifact("@mwillbanks/tuil-core"),
  ]);
  expect(ordered.map(({ name }) => name)).toEqual([
    "@mwillbanks/tuil-core",
    "@mwillbanks/tuil-story",
    "@mwillbanks/tuil",
  ]);
  expect(() =>
    orderPublishArtifacts([artifact("a", ["b"]), artifact("b", ["a"])]),
  ).toThrow("dependency cycle");
});

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
