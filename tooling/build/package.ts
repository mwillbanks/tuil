import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { normalizePublishedDependencies } from "./publication-manifest.ts";

interface WorkspaceManifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

async function buildMissingWorkspaceDependencies(
  directory: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  const workspaceRoot = resolve(directory, "../..");
  const packageDirectories = new Map<string, string>();
  for await (const path of new Bun.Glob("packages/*/package.json").scan({
    cwd: workspaceRoot,
    absolute: true,
  })) {
    const packageDirectory = resolve(path, "..");
    const packageManifest = (await Bun.file(path).json()) as {
      readonly name: string;
    };
    packageDirectories.set(packageManifest.name, packageDirectory);
  }
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  };
  for (const [dependency, version] of Object.entries(dependencies)) {
    if (version !== "workspace:*") continue;
    const dependencyDirectory = packageDirectories.get(dependency);
    if (!dependencyDirectory || existsSync(join(dependencyDirectory, "dist"))) {
      continue;
    }
    const process = Bun.spawn(["bun", "run", "build"], {
      cwd: dependencyDirectory,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await process.exited) !== 0) {
      throw new Error(`Dependency build failed for ${dependency}`);
    }
  }
}

export async function buildPackage(directory = process.cwd()): Promise<void> {
  const entries = [
    "src/index.ts",
    "src/index.tsx",
    "src/static.ts",
    "src/bin.ts",
    "src/buffer.ts",
    "src/vim.ts",
    "src/rich.ts",
    "src/testing.ts",
    "src/worker.ts",
  ]
    .map((candidate) => join(directory, candidate))
    .filter(existsSync);

  if (entries.length === 0) {
    throw new Error(`No package entrypoint found in ${directory}`);
  }
  await rm(join(directory, "dist"), { recursive: true, force: true });
  const manifest = (await Bun.file(
    join(directory, "package.json"),
  ).json()) as WorkspaceManifest & {
    readonly version: string;
    readonly description: string;
    readonly license: string;
    readonly homepage?: string;
    readonly repository?: unknown;
    readonly bugs?: unknown;
    readonly keywords?: readonly string[];
    readonly type?: string;
    readonly sideEffects?: boolean;
    readonly exports?: Readonly<Record<string, unknown>>;
    readonly bin?: Readonly<Record<string, string>>;
    readonly peerDependenciesMeta?: unknown;
    readonly tuil?: unknown;
  };
  await buildMissingWorkspaceDependencies(directory, manifest);

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

  if (basename(directory) === "cell") {
    await cp(join(directory, "native"), join(directory, "dist/native"), {
      recursive: true,
    });
    await cp(join(directory, "prebuilds"), join(directory, "dist/prebuilds"), {
      recursive: true,
    });
  } else if (basename(directory) === "tuil") {
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
