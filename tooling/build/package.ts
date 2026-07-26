import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { normalizePublishedDependencies } from "./publication-manifest.ts";

export async function buildPackage(directory = process.cwd()): Promise<void> {
  const entries = [
    "src/index.ts",
    "src/index.tsx",
    "src/static.ts",
    "src/bin.ts",
  ]
    .map((candidate) => join(directory, candidate))
    .filter(existsSync);

  if (entries.length === 0) {
    throw new Error(`No package entrypoint found in ${directory}`);
  }

  const build = Bun.spawn(
    [
      "bun",
      "build",
      ...entries,
      "--outdir",
      join(directory, "dist"),
      "--target",
      "bun",
      "--format",
      "esm",
      "--sourcemap=external",
      "--packages",
      "external",
      "--external",
      "@mwillbanks/*",
    ],
    { cwd: directory, stdout: "inherit", stderr: "inherit" },
  );

  if ((await build.exited) !== 0) {
    throw new Error(`JavaScript build failed for ${basename(directory)}`);
  }

  const browserEntries = ["src/browser.tsx", "src/storybook.tsx"]
    .map((candidate) => join(directory, candidate))
    .filter(existsSync);
  for (const browserEntry of browserEntries) {
    const browserBuild = Bun.spawn(
      [
        "bun",
        "build",
        browserEntry,
        "--outdir",
        join(directory, "dist"),
        "--target",
        "browser",
        "--format",
        "esm",
        "--sourcemap=external",
        "--packages",
        "external",
        "--external",
        "@mwillbanks/*",
        "--banner",
        '"use client";',
      ],
      { cwd: directory, stdout: "inherit", stderr: "inherit" },
    );
    if ((await browserBuild.exited) !== 0) {
      throw new Error(`Browser build failed for ${basename(directory)}`);
    }
  }

  const types = Bun.spawn(
    ["bun", "x", "tsc", "--project", "tsconfig.build.json"],
    {
      cwd: directory,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  if ((await types.exited) !== 0) {
    throw new Error(`Declaration build failed for ${basename(directory)}`);
  }

  const manifest = await Bun.file(join(directory, "package.json")).json();
  const workspaceManifest = (await Bun.file(
    resolve(directory, "../../package.json"),
  ).json()) as {
    readonly workspaces?: {
      readonly catalog?: Readonly<Record<string, string>>;
    };
  };
  const catalog = workspaceManifest.workspaces?.catalog ?? {};
  const workspaceRoot = resolve(directory, "../..");
  const workspaceVersions = new Map<string, string>();
  for await (const path of new Bun.Glob("packages/*/package.json").scan({
    cwd: workspaceRoot,
    absolute: true,
  })) {
    const packageManifest = (await Bun.file(path).json()) as {
      readonly name: string;
      readonly version: string;
    };
    workspaceVersions.set(packageManifest.name, packageManifest.version);
  }
  const normalizeDependencies = (
    dependencies: Record<string, string> | undefined,
  ) =>
    normalizePublishedDependencies(dependencies, {
      catalog,
      workspaceVersions,
    });
  const published = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    license: manifest.license,
    homepage: manifest.homepage,
    repository: manifest.repository,
    bugs: manifest.bugs,
    keywords: manifest.keywords,
    type: manifest.type,
    sideEffects: manifest.sideEffects,
    exports: manifest.exports
      ? JSON.parse(JSON.stringify(manifest.exports).replaceAll("./dist/", "./"))
      : undefined,
    bin: manifest.bin
      ? Object.fromEntries(
          Object.entries(manifest.bin as Record<string, string>).map(
            ([name, path]) => [name, path.replace("./dist/", "./")],
          ),
        )
      : undefined,
    dependencies: normalizeDependencies(manifest.dependencies),
    peerDependencies: normalizeDependencies(manifest.peerDependencies),
    peerDependenciesMeta: manifest.peerDependenciesMeta,
    tuil: manifest.tuil,
  };
  await Bun.write(
    join(directory, "dist/package.json"),
    `${JSON.stringify(
      Object.fromEntries(
        Object.entries(published).filter(([, value]) => value !== undefined),
      ),
      null,
      2,
    )}\n`,
  );
  await cp(join(workspaceRoot, "LICENSE"), join(directory, "dist/LICENSE"));
  await cp(join(workspaceRoot, "README.md"), join(directory, "dist/README.md"));

  if (basename(directory) === "tuil") {
    const cli = Bun.spawn(
      [
        "bun",
        "build",
        join(directory, "../cli/src/bin.ts"),
        "--outfile",
        join(directory, "dist/cli.js"),
        "--target",
        "bun",
        "--format",
        "esm",
        "--packages",
        "bundle",
      ],
      { cwd: directory, stdout: "inherit", stderr: "inherit" },
    );
    if ((await cli.exited) !== 0) {
      throw new Error("Standalone tuil CLI build failed");
    }
    const skillsDestination = join(directory, "dist/skills");
    await rm(skillsDestination, { recursive: true, force: true });
    await cp(join(workspaceRoot, "skills"), skillsDestination, {
      recursive: true,
    });
  } else if (basename(directory) === "cli") {
    const skillsDestination = join(directory, "dist/skills");
    await rm(skillsDestination, { recursive: true, force: true });
    await cp(join(workspaceRoot, "skills"), skillsDestination, {
      recursive: true,
    });
  }
}

await (import.meta.main ? buildPackage() : undefined);
