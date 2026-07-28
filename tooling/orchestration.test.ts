import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkCoverageCompleteness,
  checkCoverageFile,
  coverageSources,
  missingCoverageSources,
} from "./coverage/check.ts";
import { generateReferenceDocs } from "./docs/generate-reference.ts";
import { prepareDocsAssets } from "./docs/prepare-assets.ts";
import {
  assertStaticDocs,
  validateStaticDocs,
} from "./docs/validate-static.ts";
import type { PublishArtifact } from "./release/artifacts.ts";
import { type PublishRuntime, publishRelease } from "./release/publish.ts";
import {
  expectedReleaseTags,
  git,
  verifyRecoveryRelease,
} from "./release/verify-recovery.ts";

const workspace = resolve(import.meta.dir, "..");

async function run(command: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd,
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

test("build, registry, documentation, and publication orchestration completes", async () => {
  await generateReferenceDocs();
  const registryBuild = await import("./registry/build.ts");
  expect(registryBuild.deriveRegistryReleaseMetadata("1.4.7", "2.3.9")).toEqual(
    {
      version: "1.4.7",
      tuilCompatibility: "^2.3.0",
    },
  );
  expect(() =>
    registryBuild.deriveRegistryReleaseMetadata("next", "2.3.9"),
  ).toThrow("Invalid registry package version");
  const registryCheck = await import("./registry/check.ts");
  await registryCheck.checkRegistryArtifacts();
  for (const generatedPath of [
    "packages/cli/src/generated-registry.ts",
    "apps/showcase/src/component-acceptance.stories.tsx",
    "apps/docs/content/docs/reference/components/acceptance-catalog.mdx",
  ]) {
    const generatedFile = join(workspace, generatedPath);
    const generatedSource = await readFile(generatedFile, "utf8");
    await writeFile(generatedFile, `${generatedSource}\n`);
    await expect(registryCheck.checkRegistryArtifacts()).rejects.toThrow(
      "Registry artifacts are stale",
    );
    expect(await readFile(generatedFile, "utf8")).toBe(`${generatedSource}\n`);
    await writeFile(generatedFile, generatedSource);
  }
  await import("./build/build-all.ts");
  await import("./build/build-ecosystem.ts");
  await validateStaticDocs({
    outDirectory: join(workspace, "apps/docs/out"),
  });

  const packageBuild = await import("./build/package.ts");
  for (const packageName of ["core", "story", "tuil", "cli"]) {
    await packageBuild.buildPackage(join(workspace, "packages", packageName));
  }
  const publication = await import("./build/publication-smoke.ts");
  expect(() => publication.assertPublication(false, "invalid")).toThrow(
    "invalid",
  );
  const buildAll = await import("./build/build-all.ts");
  expect(() =>
    buildAll.orderWorkspacePackages(
      new Map<
        string,
        {
          readonly name: string;
          readonly dependencies: Readonly<Record<string, string>>;
        }
      >([
        ["a", { name: "a", dependencies: { b: "workspace:*" } }],
        ["b", { name: "b", dependencies: { a: "workspace:*" } }],
      ]),
      new Map([
        ["a", "a"],
        ["b", "b"],
      ]),
    ),
  ).toThrow("dependency cycle");
}, 180_000);

test("coverage and documentation gates own their complete source sets", async () => {
  const sources = await coverageSources(workspace);
  const report = sources
    .map((path) => `SF:${join(workspace, path)}`)
    .join("\n");
  expect(await missingCoverageSources(report, workspace)).toEqual([]);
  await checkCoverageCompleteness(report, workspace);
  await expect(
    checkCoverageCompleteness(report.replace(/^SF:.+\n?/, ""), workspace),
  ).rejects.toThrow("omits in-scope implementation files");

  const root = await mkdtemp(join(tmpdir(), "tuil-gates-"));
  try {
    await expect(
      checkCoverageFile(join(root, "missing.info"), workspace),
    ).rejects.toThrow("Coverage report is missing");
    const reportPath = join(root, "lcov.info");
    await writeFile(reportPath, report);
    await checkCoverageFile(reportPath, workspace);

    const publicDirectory = join(root, "public");
    await prepareDocsAssets({
      logoSource: join(workspace, "logo.svg"),
      publicDirectory,
    });
    expect(() => assertStaticDocs(false, "invalid docs")).toThrow(
      "invalid docs",
    );
    expect(await readFile(join(publicDirectory, ".nojekyll"), "utf8")).toBe("");

    for (const path of [
      "api/search",
      "docs/concepts/architecture/index.html",
      "docs/index.html",
      "docs/reference/components/forms/index.html",
      "docs/reference/packages/cli/index.html",
      "docs/reference/packages/tuil/index.html",
      "es/docs/concepts/architecture/index.html",
      "es/docs/index.html",
      "es/index.html",
      "index.html",
      "llms-full.txt",
      "llms.mdx/en/docs/index.md",
      "llms.mdx/es/docs/concepts/architecture/index.md",
      "llms.mdx/es/docs/index.md",
      "llms.txt",
      "og/docs/en/image.webp",
      "playground/index.html",
      "showcase/index.html",
      "_next/static/chunks/app.css",
    ]) {
      const target = join(publicDirectory, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, "");
    }
    await writeFile(
      join(publicDirectory, "index.html"),
      [
        '<link href="/tuil/_next/static/chunks/app.css">',
        '<a href="/tuil/docs/">Docs</a>',
        '<img src="/tuil/logo.svg">',
      ].join(""),
    );
    await writeFile(
      join(publicDirectory, "_next/static/chunks/app.css"),
      ".flex{display:flex}",
    );
    await writeFile(
      join(publicDirectory, "api/search"),
      JSON.stringify([{ url: "/docs/reference/packages/tuil" }]),
    );
    await writeFile(
      join(publicDirectory, "docs/index.html"),
      [
        '<meta property="og:image" content="https://mwillbanks.github.io/tuil/og/docs/en/image.webp">',
        ...Array.from(
          { length: 10 },
          (_, index) =>
            `<a data-active="false" href="/tuil/docs/page-${index}/"><svg></svg>Page</a>`,
        ),
      ].join(""),
    );
    await writeFile(
      join(publicDirectory, "playground/index.html"),
      "Portable story controls",
    );
    await writeFile(
      join(publicDirectory, "showcase/index.html"),
      "COMPONENT GALLERY",
    );
    await writeFile(
      join(publicDirectory, "llms.txt"),
      "[Architecture](/tuil/docs/concepts/architecture)\nPackage Reference",
    );
    await writeFile(
      join(publicDirectory, "llms-full.txt"),
      "# @mwillbanks/tuil\n# Architecture\nSource: /tuil/docs",
    );
    await writeFile(
      join(publicDirectory, "llms.mdx/en/docs/index.md"),
      "Source: /tuil/docs",
    );
    await writeFile(
      join(publicDirectory, "es/index.html"),
      '<!DOCTYPE html><html lang="es"><main><a href="/tuil/es/docs/">Docs</a></main></html>',
    );
    await writeFile(
      join(publicDirectory, "es/docs/index.html"),
      '<!DOCTYPE html><html lang="es"><a data-card="true" href="/tuil/es/docs/concepts/architecture/">Architecture</a></html>',
    );
    await writeFile(
      join(publicDirectory, "es/docs/concepts/architecture/index.html"),
      '<!DOCTYPE html><html lang="es"><main>Arquitectura</main></html>',
    );
    await writeFile(
      join(publicDirectory, "llms.mdx/es/docs/index.md"),
      [
        "Source: /tuil/es/docs",
        "[Architecture](/tuil/es/docs/concepts/architecture)",
        '<Card href="/tuil/es/docs/reference" />',
      ].join("\n"),
    );
    await writeFile(
      join(publicDirectory, "llms.mdx/es/docs/concepts/architecture/index.md"),
      [
        "Source: /tuil/es/docs/concepts/architecture",
        "[Introduction](/tuil/es/docs)",
      ].join("\n"),
    );
    await validateStaticDocs({
      outDirectory: publicDirectory,
      basePath: "tuil/",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release publishing handles existing, new, failed, and delayed artifacts", async () => {
  const artifact: PublishArtifact = {
    sourceDirectory: "/source",
    artifactDirectory: "/artifact",
    name: "@scope/package",
    version: "1.2.3",
    workspaceDependencies: [],
  };
  const responses: number[] = [404, 200];
  let publishEnvironment:
    | Readonly<Record<string, string | undefined>>
    | undefined;
  const runtime: PublishRuntime = {
    discover: () => Promise.resolve([artifact]),
    environment: {
      PATH: "/bin",
      NODE_AUTH_TOKEN: "legacy-node-token",
      NPM_TOKEN: "legacy-npm-token",
    },
    fetch: (() =>
      Promise.resolve(
        new Response(null, { status: responses.shift() ?? 200 }),
      )) as unknown as typeof fetch,
    spawn: (_command, options) => {
      publishEnvironment = options.env;
      return { exited: Promise.resolve(0) };
    },
    sleep: () => Promise.resolve(),
  };
  expect(await publishRelease("/workspace", "next", runtime)).toEqual({
    published: ["@scope/package@1.2.3"],
    releaseTag: "next",
  });
  expect(publishEnvironment).toEqual({ PATH: "/bin" });

  await expect(
    publishRelease("/workspace", "latest", {
      ...runtime,
      fetch: (() =>
        Promise.resolve(
          new Response(null, { status: 500 }),
        )) as unknown as typeof fetch,
    }),
  ).rejects.toThrow("registry lookup failed");
  await expect(
    publishRelease("/workspace", "latest", {
      ...runtime,
      fetch: (() =>
        Promise.resolve(
          new Response(null, { status: 404 }),
        )) as unknown as typeof fetch,
      spawn: () => ({ exited: Promise.resolve(1) }),
    }),
  ).rejects.toThrow("Failed to publish");
  await expect(
    publishRelease("/workspace", "latest", {
      ...runtime,
      fetch: (() =>
        Promise.resolve(
          new Response(null, { status: 404 }),
        )) as unknown as typeof fetch,
    }),
  ).rejects.toThrow("did not expose");
});

test("recovery verification requires the exact commit and release tags", async () => {
  const root = await mkdtemp(join(tmpdir(), "tuil-recovery-"));
  try {
    await run(["git", "init", "-q"], root);
    await run(["git", "config", "user.email", "test@example.com"], root);
    await run(["git", "config", "user.name", "Tuil Test"], root);
    await mkdir(join(root, "packages/example"), { recursive: true });
    await mkdir(join(root, "packages/stable"), { recursive: true });
    await writeFile(
      join(root, "release-please-config.json"),
      JSON.stringify({
        packages: {
          "packages/example": { component: "example" },
          "packages/stable": { component: "stable" },
        },
      }),
    );
    await writeFile(
      join(root, "packages/example/package.json"),
      JSON.stringify({ name: "example", version: "1.2.2" }),
    );
    await writeFile(
      join(root, "packages/stable/package.json"),
      JSON.stringify({ name: "stable", version: "4.5.6" }),
    );
    await run(["git", "add", "."], root);
    await run(["git", "commit", "-qm", "test: seed recovery"], root);
    await run(["git", "tag", "example-v1.2.2"], root);
    await run(["git", "tag", "stable-v4.5.6"], root);
    await writeFile(
      join(root, "packages/example/package.json"),
      JSON.stringify({ name: "example", version: "1.2.3" }),
    );
    await run(["git", "add", "."], root);
    await run(["git", "commit", "-qm", "chore: release example"], root);
    const sha = await run(["git", "rev-parse", "HEAD"], root);
    await run(["git", "tag", "example-v1.2.3"], root);
    expect(await expectedReleaseTags(root, sha)).toEqual(["example-v1.2.3"]);
    await verifyRecoveryRelease(root, sha);
    await expect(verifyRecoveryRelease(root, "invalid")).rejects.toThrow(
      "full 40-character",
    );
    await expect(verifyRecoveryRelease(root, "0".repeat(40))).rejects.toThrow(
      "Recovery checkout",
    );
    await run(["git", "tag", "-d", "example-v1.2.3"], root);
    await expect(verifyRecoveryRelease(root, sha)).rejects.toThrow(
      "missing release tags",
    );
    await expect(git(root, "not-a-command")).rejects.toThrow("failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
