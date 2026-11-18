import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveBuildScope,
  selectImpactedWorkspaces,
  type WorkspaceManifest,
} from "../../../../tooling/build/workspace-scope.ts";

const manifests = [
  {
    name: "core",
    directory: "packages/core",
    build: true,
    dependencies: [],
  },
  {
    name: "feature",
    directory: "packages/feature",
    build: true,
    dependencies: ["core"],
  },
  {
    name: "application",
    directory: "apps/application",
    build: true,
    dependencies: ["feature"],
  },
  {
    name: "unrelated",
    directory: "packages/unrelated",
    build: true,
    dependencies: [],
  },
] as const satisfies readonly WorkspaceManifest[];

async function runGit(workspace: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return stdout.trim();
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "tuil-workspace-scope-"));
  await writeFile(join(workspace, "package.json"), '{"private":true}\n');
  await writeFile(join(workspace, "bun.lock"), "initial\n");
  for (const directory of [
    "packages/core",
    "packages/feature",
    "packages/no-manifest",
    "apps/application",
    "examples/demo",
  ]) {
    await mkdir(join(workspace, directory), { recursive: true });
  }
  await writeFile(join(workspace, "packages/README.md"), "not a workspace\n");
  await writeFile(
    join(workspace, "packages/core/package.json"),
    JSON.stringify({ name: "core", scripts: { build: "build" } }),
  );
  await writeFile(join(workspace, "packages/core/source.ts"), "initial\n");
  await writeFile(
    join(workspace, "packages/feature/package.json"),
    JSON.stringify({
      name: "feature",
      scripts: { build: "build" },
      dependencies: { core: "workspace:*" },
      peerDependencies: { application: "workspace:*" },
      optionalDependencies: { demo: "workspace:*" },
    }),
  );
  await writeFile(
    join(workspace, "apps/application/package.json"),
    JSON.stringify({ name: "application" }),
  );
  await writeFile(
    join(workspace, "examples/demo/package.json"),
    JSON.stringify({ name: "demo", scripts: { build: "build" } }),
  );
  await runGit(workspace, "init", "--quiet");
  await runGit(workspace, "config", "user.email", "tests@example.com");
  await runGit(workspace, "config", "user.name", "Tests");
  await runGit(workspace, "add", ".");
  await runGit(workspace, "commit", "--quiet", "-m", "initial");
  return workspace;
}

test("selects changed workspaces, dependents, and required dependencies", () => {
  expect(
    selectImpactedWorkspaces(manifests, ["packages/feature/src/index.ts"]),
  ).toEqual(new Set(["feature", "application", "core"]));
});

test("does not build unrelated workspaces", () => {
  expect(
    selectImpactedWorkspaces(manifests, ["packages/unrelated/src/index.ts"]),
  ).toEqual(new Set(["unrelated"]));
});

test("selects explicit full builds and special shared inputs", () => {
  const specialManifests = [
    ...manifests,
    {
      name: "@mwillbanks/tuil",
      directory: "packages/tuil",
      build: true,
      dependencies: [],
    },
    {
      name: "@mwillbanks/tuil-cli",
      directory: "packages/cli",
      build: true,
      dependencies: [],
    },
    {
      name: "example",
      directory: "examples/example",
      build: true,
      dependencies: [],
    },
  ] satisfies readonly WorkspaceManifest[];

  expect([
    ...selectImpactedWorkspaces(specialManifests, [], true),
  ]).toHaveLength(specialManifests.length);
  expect(
    selectImpactedWorkspaces(specialManifests, ["skills/example.md"]),
  ).toEqual(new Set(["@mwillbanks/tuil", "@mwillbanks/tuil-cli"]));
  expect(
    selectImpactedWorkspaces(specialManifests, ["examples/_shared.tsx"]),
  ).toEqual(new Set(["example"]));
  expect(
    selectImpactedWorkspaces(specialManifests, ["examples/assets/demo.txt"]),
  ).toEqual(new Set(["example"]));
  expect(
    selectImpactedWorkspaces(specialManifests, ["registry/button.tsx"]),
  ).toEqual(new Set(["@mwillbanks/tuil-cli"]));
  expect(
    selectImpactedWorkspaces(specialManifests, ["tooling/registry/build.ts"]),
  ).toEqual(new Set(["@mwillbanks/tuil-cli"]));
});

test("builds every workspace for shared build infrastructure changes", () => {
  expect(
    selectImpactedWorkspaces(manifests, ["tooling/build/package.ts"]),
  ).toEqual(new Set(["core", "feature", "application", "unrelated"]));
});

test("builds every remaining workspace when a workspace manifest is deleted", () => {
  expect(
    selectImpactedWorkspaces(manifests, ["packages/removed/package.json"]),
  ).toEqual(new Set(["core", "feature", "application", "unrelated"]));
});

test("rejects a missing explicit base instead of using the environment", async () => {
  for (const args of [
    ["--all", "--base"],
    ["--base", "--all"],
  ]) {
    await expect(
      resolveBuildScope(resolve(import.meta.dir, "../../../.."), args, {
        TUIL_BUILD_BASE: "HEAD",
        TUIL_BUILD_ALL: "true",
      }),
    ).rejects.toThrow("--base requires a Git reference");
  }
});

test("discovers manifests and resolves tracked and untracked changes", async () => {
  const workspace = await createWorkspace();
  try {
    const all = await resolveBuildScope(
      workspace,
      ["--all", "--base", "HEAD"],
      {},
    );
    expect(all).toMatchObject({
      all: true,
      base: "HEAD",
      buildRegistry: true,
    });
    expect([...all.workspaceNames]).toEqual(["core", "feature", "demo"]);

    await writeFile(join(workspace, "packages/core/source.ts"), "changed\n");
    await writeFile(
      join(workspace, "packages/core/untracked.ts"),
      "untracked\n",
    );
    const changed = await resolveBuildScope(workspace, ["--base", "HEAD"], {});
    expect(changed.buildRegistry).toBeFalse();
    expect(changed.workspaceNames).toEqual(
      new Set(["core", "feature", "demo"]),
    );

    await mkdir(join(workspace, "registry"));
    await writeFile(join(workspace, "registry/button.tsx"), "untracked\n");
    const registryChanged = await resolveBuildScope(
      workspace,
      ["--base", "HEAD"],
      {},
    );
    expect(registryChanged.buildRegistry).toBeTrue();
    expect(registryChanged.workspaceNames).toEqual(
      new Set(["core", "@mwillbanks/tuil-cli", "feature", "demo"]),
    );

    await rm(join(workspace, "registry/button.tsx"));
    await writeFile(join(workspace, "package.json"), '{"private":false}\n');
    const packageChanged = await resolveBuildScope(
      workspace,
      ["--base", "HEAD"],
      {},
    );
    expect(packageChanged.buildRegistry).toBeTrue();
    expect(packageChanged.workspaceNames).toEqual(
      new Set(["core", "feature", "demo"]),
    );

    await writeFile(join(workspace, "package.json"), '{"private":true}\n');
    await writeFile(join(workspace, "bun.lock"), "changed\n");
    const lockfileChanged = await resolveBuildScope(
      workspace,
      ["--base", "HEAD"],
      {},
    );
    expect(lockfileChanged.buildRegistry).toBeTrue();
    expect(lockfileChanged.workspaceNames).toEqual(
      new Set(["core", "feature", "demo"]),
    );

    await expect(
      resolveBuildScope(workspace, ["--base", "missing-reference"], {}),
    ).rejects.toThrow("Failed to resolve changed workspaces");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("full discovery orders directories ordinally within package, app, and example roots", async () => {
  const workspace = await createWorkspace();
  try {
    for (const [directory, name] of [
      ["packages/zeta", "zeta"],
      ["packages/alpha", "alpha"],
      ["apps/buildable", "app"],
    ] as const) {
      await mkdir(join(workspace, directory), { recursive: true });
      await writeFile(
        join(workspace, directory, "package.json"),
        JSON.stringify({ name, scripts: { build: "build" } }),
      );
    }
    const all = await resolveBuildScope(workspace, ["--all"], {});
    expect([...all.workspaceNames]).toEqual([
      "alpha",
      "core",
      "feature",
      "zeta",
      "app",
      "demo",
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("explicit environments control full builds and base selection without mutating process state", async () => {
  const workspace = await createWorkspace();
  try {
    const unchanged = await resolveBuildScope(workspace, [], {
      TUIL_BUILD_BASE: "HEAD",
    });
    expect(unchanged).toMatchObject({
      all: false,
      base: "HEAD",
      buildRegistry: false,
    });
    expect(unchanged.workspaceNames.size).toBe(0);
    const all = await resolveBuildScope(workspace, [], {
      TUIL_BUILD_ALL: "true",
      TUIL_BUILD_BASE: "environment-base",
    });
    expect(all).toMatchObject({
      all: true,
      base: "environment-base",
      buildRegistry: true,
    });
    expect([...all.workspaceNames]).toEqual(["core", "feature", "demo"]);
    const argumentBase = await resolveBuildScope(
      workspace,
      ["--base", "HEAD"],
      { TUIL_BUILD_BASE: "missing-reference" },
    );
    expect(argumentBase.base).toBe("HEAD");
    expect(argumentBase.workspaceNames.size).toBe(0);
    await expect(
      resolveBuildScope(workspace, [], {
        TUIL_BUILD_BASE: "missing-reference",
      }),
    ).rejects.toThrow("Failed to resolve changed workspaces");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("tracked and untracked Unicode and whitespace filenames retain their workspace identity", async () => {
  const workspace = await createWorkspace();
  try {
    const path = join(workspace, "packages/core/café\nwith space.ts");
    await writeFile(path, "initial\n");
    const untracked = await resolveBuildScope(
      workspace,
      ["--base", "HEAD"],
      {},
    );
    expect(untracked.workspaceNames).toEqual(
      new Set(["core", "feature", "demo"]),
    );
    await runGit(workspace, "add", ".");
    await runGit(workspace, "commit", "--quiet", "-m", "unicode");
    await writeFile(path, "changed\n");
    const tracked = await resolveBuildScope(workspace, ["--base", "HEAD"], {});
    expect(tracked.workspaceNames).toEqual(
      new Set(["core", "feature", "demo"]),
    );
    expect(tracked.buildRegistry).toBeFalse();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
