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

test("publishable packages declare every internal source import", async () => {
  const findings: string[] = [];
  for (const directory of await readdir(join(workspace, "packages"))) {
    const packageDirectory = join(workspace, "packages", directory);
    const manifestFile = Bun.file(join(packageDirectory, "package.json"));
    if (!(await manifestFile.exists())) continue;
    const manifest = (await manifestFile.json()) as {
      readonly name: string;
      readonly private?: boolean;
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly optionalDependencies?: Readonly<Record<string, string>>;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };
    if (manifest.private) continue;
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    for await (const source of new Bun.Glob("src/**/*.{ts,tsx}").scan({
      cwd: packageDirectory,
      absolute: true,
    })) {
      if (/\.test\.tsx?$/.test(source)) continue;
      const imports = new Bun.Transpiler({
        loader: source.endsWith(".tsx") ? "tsx" : "ts",
      }).scanImports(
        (await Bun.file(source).text()).replace(/^#![^\n]*\n/, ""),
      );
      for (const { path } of imports) {
        const dependency = path.match(/^(@mwillbanks\/[^/]+)/)?.[1];
        if (
          dependency &&
          dependency !== manifest.name &&
          !declared.has(dependency)
        ) {
          findings.push(
            `${manifest.name} imports undeclared dependency ${dependency}`,
          );
        }
      }
    }
  }
  expect([...new Set(findings)].sort()).toEqual([]);
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
