import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "../..");

test("release please independently versions every publishable package", async () => {
  const config = (await Bun.file(
    join(workspace, "release-please-config.json"),
  ).json()) as {
    readonly plugins: readonly { readonly type: string }[];
    readonly packages: Readonly<Record<string, unknown>>;
  };
  expect(config.plugins).toEqual([{ type: "node-workspace" }]);

  const publishablePackages = (
    await Promise.all(
      (
        await readdir(join(workspace, "packages"))
      ).map(async (directory) => {
        const path = `packages/${directory}`;
        const manifest = Bun.file(join(workspace, path, "package.json"));
        if (!(await manifest.exists())) return undefined;
        const { private: isPrivate } = (await manifest.json()) as {
          readonly private?: boolean;
        };
        return isPrivate ? undefined : path;
      }),
    )
  )
    .filter((path): path is string => path !== undefined)
    .sort();

  expect(Object.keys(config.packages).sort()).toEqual(publishablePackages);
});

test("normal and recovery publishing share one trusted workflow identity", async () => {
  const ci = await readFile(
    join(workspace, ".github/workflows/ci.yml"),
    "utf8",
  );
  const release = await readFile(
    join(workspace, ".github/workflows/release.yml"),
    "utf8",
  );

  expect(ci).toContain("workflow_dispatch:");
  expect(ci).toContain("release_sha:");
  expect(ci).toContain("uses: ./.github/workflows/release.yml");
  expect(ci).toContain("id-token: write");
  expect(release).not.toContain("\n  workflow_dispatch:");
  expect(release).toContain("release_sha:");
  expect(release).toContain("inputs.release_sha");
  expect(release).toContain("id-token: write");
});
