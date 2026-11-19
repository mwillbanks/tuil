import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPublishArtifacts } from "../../../tooling/release/artifacts.ts";
import { packRecoveryRelease } from "../../../tooling/release/pack-recovery.ts";
import { git } from "../../../tooling/release/verify-recovery.ts";

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

test("packs the tagged recovery source and records its immutable identity", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "tuil-recovery-"));
  const path = "packages/core";
  const version = "1.0.1";
  const tag = "tuil-core-v1.0.1";
  const output = join(workspace, "out");
  try {
    await git(workspace, "init", "-q");
    await git(workspace, "config", "user.name", "TUIL tests");
    await git(workspace, "config", "user.email", "tuil@example.invalid");
    await writeJson(join(workspace, "release-please-config.json"), {
      packages: { [path]: { component: "tuil-core" } },
    });
    await writeJson(join(workspace, path, "package.json"), {
      name: "@example/core",
      version: "1.0.0",
    });
    await git(workspace, "add", ".");
    await git(workspace, "commit", "-qm", "base");
    const manifest = { name: "@example/core", version };
    await writeJson(join(workspace, path, "package.json"), manifest);
    await git(workspace, "add", ".");
    await git(workspace, "commit", "-qm", "release");
    const releaseSha = await git(workspace, "rev-parse", "HEAD");
    await expect(
      packRecoveryRelease(workspace, output, releaseSha),
    ).rejects.toThrow("missing release tags");
    expect(await Bun.file(join(output, "source.json")).exists()).toBe(false);

    await git(workspace, "tag", tag);
    await writeJson(join(workspace, path, "dist/package.json"), manifest);
    await packRecoveryRelease(workspace, output, releaseSha);
    const tarball = Bun.file(join(output, "packs", "example-core-1.0.1.tgz"));
    expect(await tarball.exists()).toBe(true);
    expect(await Bun.file(join(output, "source.json")).json()).toEqual({
      source: {
        repository: "https://github.com/mwillbanks/tuil",
        commit: releaseSha,
        tags: [tag],
      },
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
