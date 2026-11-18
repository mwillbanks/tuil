import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  discoverPublishArtifacts,
  npmPackArguments,
} from "../release/artifacts.ts";
import { assertPublication } from "../release/assert-publication.ts";

const workspace = resolve(import.meta.dir, "../..");
const packageRoot = join(workspace, "packages");
const publishArtifacts = await discoverPublishArtifacts(workspace);
const packageDirectories = publishArtifacts.map(
  (artifact) => artifact.sourceDirectory,
);

for (const directory of packageDirectories) {
  const sourceManifest = Bun.file(join(directory, "package.json"));
  if (!(await sourceManifest.exists())) continue;
  const manifest = (await Bun.file(
    join(directory, "dist/package.json"),
  ).json()) as {
    readonly name: string;
    readonly description?: string;
    readonly license?: string;
    readonly homepage?: string;
    readonly repository?: {
      readonly type?: string;
      readonly url?: string;
      readonly directory?: string;
    };
    readonly bugs?: { readonly url?: string };
    readonly keywords?: readonly string[];
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly peerDependenciesMeta?: Readonly<
      Record<string, { readonly optional?: boolean }>
    >;
    readonly exports?: Readonly<
      Record<string, string | Readonly<Record<string, string>>>
    >;
    readonly bin?: Readonly<Record<string, string>>;
  };
  assertPublication(
    manifest.description &&
      manifest.license === "MIT" &&
      manifest.homepage === "https://mwillbanks.github.io/tuil/" &&
      manifest.repository?.type === "git" &&
      manifest.repository.url ===
        "git+https://github.com/mwillbanks/tuil.git" &&
      manifest.bugs?.url === "https://github.com/mwillbanks/tuil/issues" &&
      (manifest.keywords?.length ?? 0) >= 5,
    `${manifest.name} publishes incomplete package metadata`,
  );
  assertPublication(
    await Bun.file(join(directory, "dist/LICENSE")).exists(),
    `${manifest.name} does not publish its MIT license`,
  );
  assertPublication(
    await Bun.file(join(directory, "dist/README.md")).exists(),
    `${manifest.name} does not publish usage documentation`,
  );
  if (manifest.name === "@mwillbanks/tuil-cell") {
    for (const artifact of [
      "prebuilds/darwin-arm64/libtuil_cell.dylib",
      "prebuilds/darwin-x64/libtuil_cell.dylib",
      "prebuilds/linux-arm64/libtuil_cell.so",
      "prebuilds/linux-x64/libtuil_cell.so",
      "prebuilds/win32-x64/tuil_cell.dll",
      "prebuilds/manifest.json",
      "native/cell_diff.zig",
    ]) {
      assertPublication(
        await Bun.file(join(directory, "dist", artifact)).exists(),
        `${manifest.name} does not publish native artifact "${artifact}"`,
      );
    }
  }
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: join(directory, "dist"),
  })) {
    assertPublication(
      !path.startsWith("src/") && !/\.test\.[^.]+(?:\.map)?$/.test(path),
      `${manifest.name} publishes stale build artifact "${path}"`,
    );
  }
  for (const version of Object.values({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })) {
    assertPublication(
      !version.startsWith("workspace:") && !version.startsWith("catalog:"),
      `${manifest.name} publishes an internal dependency`,
    );
  }
  const exportedPaths = Object.values(manifest.exports ?? {}).flatMap(
    (value) => (typeof value === "string" ? [value] : Object.values(value)),
  );
  for (const path of [...exportedPaths, ...Object.values(manifest.bin ?? {})]) {
    assertPublication(
      await Bun.file(join(directory, "dist", path)).exists(),
      `${manifest.name} publishes missing path "${path}"`,
    );
  }
  assertPublication(
    manifest.name !== "@mwillbanks/tuil-story" ||
      manifest.peerDependenciesMeta?.["@storybook/react"]?.optional,
    "Published story package must keep Storybook optional",
  );
}

const tuilBundle = await readFile(
  join(packageRoot, "tuil/dist/index.js"),
  "utf8",
);
assertPublication(
  tuilBundle.includes('from "@mwillbanks/tuil-core"') &&
    !tuilBundle.includes("class Lifecycle"),
  "Published tuil runtime bundles a duplicate core runtime",
);
const bundledSkills = await readdir(join(packageRoot, "tuil/dist/skills"));
assertPublication(
  bundledSkills.length === 7,
  `Published tuil package must contain seven Agent Skills, found ${bundledSkills.length}`,
);
for (const packageName of ["tuil", "cli"]) {
  const manifest = (await Bun.file(
    join(packageRoot, packageName, "dist/package.json"),
  ).json()) as { readonly tuil?: { readonly skills?: string } };
  const skillsPath = manifest.tuil?.skills;
  assertPublication(
    skillsPath &&
      (await Bun.file(
        join(
          packageRoot,
          packageName,
          "dist",
          skillsPath,
          "building-tuil-applications/SKILL.md",
        ),
      ).exists()),
    `Published ${packageName} manifest must resolve its bundled Agent Skills`,
  );
}

const cli = Bun.spawn(
  ["bun", join(packageRoot, "tuil/dist/cli.js"), "info", "--output", "json"],
  { cwd: workspace, stdout: "pipe", stderr: "pipe" },
);
const cliOutput = await new Response(cli.stdout).text();
const cliError = await new Response(cli.stderr).text();
assertPublication(
  (await cli.exited) === 0,
  `Published tuil CLI failed: ${cliError.trim()}`,
);
const cliInfo = JSON.parse(cliOutput) as { name?: string; version?: string };
const standaloneManifest = (await Bun.file(
  join(packageRoot, "tuil/dist/package.json"),
).json()) as { version: string };
assertPublication(
  cliInfo.name === "@mwillbanks/tuil" &&
    cliInfo.version === standaloneManifest.version,
  "Published tuil CLI returned invalid package information",
);

const destination = await mkdtemp(join(tmpdir(), "tuil-publication-"));
try {
  const archiveByPackage = new Map<string, string>();
  for (const artifact of publishArtifacts) {
    const directory = artifact.sourceDirectory;
    const manifest = (await Bun.file(
      join(directory, "dist/package.json"),
    ).json()) as { readonly name: string };
    const pack = Bun.spawn([...npmPackArguments(destination)], {
      cwd: artifact.artifactDirectory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const packedOutput = await new Response(pack.stdout).text();
    const error = await new Response(pack.stderr).text();
    assertPublication(
      (await pack.exited) === 0,
      `${manifest.name} could not be packed: ${error.trim()}`,
    );
    const packedName = packedOutput.trim().split("\n").at(-1);
    assertPublication(
      packedName,
      `${manifest.name} did not report a package archive`,
    );
    const archive = isAbsolute(packedName)
      ? packedName
      : join(destination, basename(packedName));
    assertPublication(
      (await stat(archive)).size > 0,
      `${manifest.name} produced an empty package archive`,
    );
    archiveByPackage.set(manifest.name, archive);
  }
  const archives = await readdir(destination);
  assertPublication(
    archives.length === packageDirectories.length,
    `Expected ${packageDirectories.length} package archives, found ${archives.length}`,
  );
  const manifests = await Promise.all(
    packageDirectories.map((directory) =>
      readFile(join(directory, "dist/package.json"), "utf8"),
    ),
  );
  assertPublication(
    !manifests.some(
      (manifest) =>
        manifest.includes('"workspace:') || manifest.includes('"catalog:'),
    ),
    "A packed manifest retained a workspace or catalog protocol",
  );
  const formManifest = JSON.parse(
    await readFile(join(packageRoot, "form/dist/package.json"), "utf8"),
  ) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
  };
  assertPublication(
    !formManifest.dependencies?.["@tanstack/react-form"] &&
      formManifest.peerDependencies?.["@tanstack/react-form"],
    "Published form package must expose TanStack React Form as a peer",
  );
  const sourceVersions = new Map<string, string>();
  for (const directory of packageDirectories) {
    const source = (await Bun.file(join(directory, "package.json")).json()) as {
      readonly name: string;
      readonly version: string;
    };
    sourceVersions.set(source.name, source.version);
  }
  for (const directory of packageDirectories) {
    const published = (await Bun.file(
      join(directory, "dist/package.json"),
    ).json()) as {
      readonly name: string;
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };
    for (const [name, version] of Object.entries({
      ...published.dependencies,
      ...published.peerDependencies,
    })) {
      const workspaceVersion = sourceVersions.get(name);
      assertPublication(
        !workspaceVersion || version === `^${workspaceVersion}`,
        `${published.name} points at ${name}@${version}, expected ^${workspaceVersion}`,
      );
    }
  }
  const consumer = join(destination, "consumer");
  await mkdir(consumer, { recursive: true });
  const rootManifest = await Bun.file(join(workspace, "package.json")).json();
  const dependencies: Record<string, string> = {};
  const overrides: Record<string, string> = { ...rootManifest.overrides };
  for (const [name, archive] of archiveByPackage) {
    dependencies[name] = archive;
    overrides[name] = archive;
  }
  // Optional peers are exercised too, including the published Storybook adapter.
  for (const directory of packageDirectories) {
    const manifest = await Bun.file(
      join(directory, "dist/package.json"),
    ).json();
    for (const [name, version] of Object.entries(
      manifest.peerDependencies ?? {},
    )) {
      if (archiveByPackage.has(name)) continue;
      const preferred =
        rootManifest.workspaces.catalog[name] ??
        rootManifest.dependencies[name] ??
        rootManifest.devDependencies[name];
      dependencies[name] =
        preferred && preferred !== "catalog:" ? preferred : String(version);
    }
  }
  for (const name of [
    "@types/bun",
    "@types/react",
    "@types/react-dom",
    "@types/node",
  ]) {
    dependencies[name] = rootManifest.devDependencies[name];
  }
  await Bun.write(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "tuil-publication-consumer",
        private: true,
        type: "module",
        dependencies,
        overrides,
      },
      null,
      2,
    ) + "\n",
  );
  const install = Bun.spawn(["bun", "install", "--ignore-scripts"], {
    cwd: consumer,
    stdout: "pipe",
    stderr: "pipe",
  });
  const installError = await new Response(install.stderr).text();
  assertPublication(
    (await install.exited) === 0,
    `Packed package consumer installation failed: ${installError.trim()}`,
  );
  const typeImports: string[] = [];
  for (const name of archiveByPackage.keys()) {
    const manifest = await Bun.file(
      join(consumer, "node_modules", name, "package.json"),
    ).json();
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      if (!target || typeof target !== "object" || !("types" in target))
        continue;
      const specifier = subpath === "." ? name : name + subpath.slice(1);
      const index = typeImports.length;
      typeImports.push(
        `import type * as Export${index} from ${JSON.stringify(specifier)};\nexport type Checked${index} = typeof Export${index};`,
      );
    }
  }
  assertPublication(
    typeImports.length > 0,
    "Packed exports have no declarations",
  );
  await Bun.write(join(consumer, "exports.ts"), typeImports.join("\n") + "\n");
  await Bun.write(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        lib: ["ESNext", "DOM", "DOM.Iterable"],
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["bun", "react"],
      },
      include: ["exports.ts", "storybook-consumer.ts"],
    }),
  );
  await Bun.write(
    join(consumer, "storybook-consumer.ts"),
    `import {createStorybookAdapter} from "@mwillbanks/tuil-story/storybook";
import type {Meta} from "@storybook/react";
const adapter = createStorybookAdapter({
  id: "packed-adapter",
  title: "Packed adapter",
  stories: {Default: {args: {label: "Published"}}},
});
const meta: Meta<Record<string, unknown>> = adapter.meta;
const story = adapter.stories["Default"];
if (meta.title !== "Packed adapter" || !story || typeof story.render !== "function") {
  throw new Error("Packed Storybook adapter is unusable");
}
const element = story.render(story.args ?? {}, {} as never);
if (!element) throw new Error("Packed Storybook adapter did not render");
`,
  );
  const declarations = Bun.spawn(["bun", "check", "--no-script"], {
    cwd: consumer,
    stdout: "pipe",
    stderr: "pipe",
  });
  const declarationOutput = await new Response(declarations.stdout).text();
  const declarationError = await new Response(declarations.stderr).text();
  assertPublication(
    (await declarations.exited) === 0,
    `Packed declaration exports failed: ${declarationOutput}${declarationError}`,
  );
  const storybook = Bun.spawn(["bun", "storybook-consumer.ts"], {
    cwd: consumer,
    stdout: "pipe",
    stderr: "pipe",
  });
  const storybookError = await new Response(storybook.stderr).text();
  assertPublication(
    (await storybook.exited) === 0,
    `Packed Storybook adapter failed: ${storybookError}`,
  );
  await Bun.write(
    join(consumer, "smoke.ts"),
    `import {Lifecycle} from "@mwillbanks/tuil-core";
import {createApp, createOperation, createRouter, createWorkflow, defineOperation, defineRoutes, defineStep, defineWorkflow, route} from "@mwillbanks/tuil";
import {Text, renderStatic} from "@mwillbanks/tuil-ink";
import {CellBuffer, loadNativeCellAccelerator} from "@mwillbanks/tuil-cell";
import {LayoutProjection} from "@mwillbanks/tuil-renderer";
import {PointerRouter} from "@mwillbanks/tuil-pointer";
import {ScrollAreaState} from "@mwillbanks/tuil-scroll";
import {textBufferProvider} from "@mwillbanks/tuil-editor/buffer";
import {vimEditorProvider} from "@mwillbanks/tuil-editor/vim";
import {richEditorProvider} from "@mwillbanks/tuil-editor/rich";
import {runEditorProviderConformance} from "@mwillbanks/tuil-editor/testing";
import {CodeDocument} from "@mwillbanks/tuil-code";
import {DiffModel} from "@mwillbanks/tuil-content";
import {StreamingPipeline} from "@mwillbanks/tuil-streaming";
import {LogPipeline} from "@mwillbanks/tuil-logging";
import {LogViewerModel} from "@mwillbanks/tuil-log-viewer";
import {createProtocolMessage, validateProtocolMessage} from "@mwillbanks/tuil-protocol";
import {DevtoolsExtensionRegistry} from "@mwillbanks/tuil-devtools";
import {createElement} from "react";

const app = createApp({
  component: () => createElement(Text, null, "published runtime"),
  terminal: {mode: "static"},
});
if (!(app.lifecycle instanceof Lifecycle)) {
  throw new Error("consumer loaded duplicate runtime instances");
}
const frame = await renderStatic(app);
if (!frame.includes("published runtime")) {
  throw new Error("consumer could not render through the packed packages");
}
const layout = new LayoutProjection();
new PointerRouter(layout);
new ScrollAreaState({id: "smoke", viewport: {width: 10, height: 2}, extent: {width: 10, height: 4}});
const cells = new CellBuffer(4, 1);
cells.write(0, 0, "cell");
if (cells.get(0, 0)?.grapheme !== "c") throw new Error("packed cell renderer failed");
if ((await loadNativeCellAccelerator())?.id !== "zig-ffi") {
  throw new Error("packed native cell accelerator failed to load");
}
await runEditorProviderConformance(textBufferProvider);
await runEditorProviderConformance(vimEditorProvider);
await runEditorProviderConformance(richEditorProvider);
const code = new CodeDocument("const value = 1", {language: "javascript"});
if ((await code.parse()).spans.length === 0) throw new Error("packed Tree-sitter code parser failed");
if (!new DiffModel("--- a\\n+++ b\\n-a\\n+b").render().length) throw new Error("packed content model failed");
const stream = new StreamingPipeline({format: "json"});
await stream.write('{"ok":true}');
if (!(await stream.end()).complete) throw new Error("packed streaming pipeline failed");
const logs = new LogPipeline();
logs.ingest('{"body":"ready"}', "json");
const logViewer = new LogViewerModel(logs, {
  queryEditor: textBufferProvider.create({id: "smoke-query"}),
  queryEditorOwnership: "owned",
});
if (logViewer.snapshot().total !== 1) throw new Error("packed log viewer failed");
logViewer.dispose();
if (!validateProtocolMessage(createProtocolMessage("snapshot", {}))) throw new Error("packed protocol failed");
new DevtoolsExtensionRegistry().dispose();
const operation = createOperation(defineOperation({id: "smoke", title: "Smoke", run: () => "ok"}));
if (await operation.execute() !== "ok") {
  throw new Error("consumer could not execute packed operations");
}
const router = createRouter(defineRoutes({home: route({})}));
if ((await router.navigate({to: "home"})).route !== "home") {
  throw new Error("consumer could not navigate with the packed router");
}
const workflow = createWorkflow(defineWorkflow({
  id: "smoke",
  version: 1,
  initialState: {},
  steps: {only: defineStep({})},
  transitions: [],
}));
await workflow.start();
await workflow.next();
if (workflow.snapshot.status !== "completed") {
  throw new Error("consumer could not execute the packed workflow");
}
`,
  );
  const consumerSmoke = Bun.spawn(["bun", "smoke.ts"], {
    cwd: consumer,
    stdout: "pipe",
    stderr: "pipe",
  });
  const smokeError = await new Response(consumerSmoke.stderr).text();
  assertPublication(
    (await consumerSmoke.exited) === 0,
    `Packed package consumer failed: ${smokeError.trim()}`,
  );
  const installedCli = Bun.spawn(
    [
      "bun",
      join(consumer, "node_modules/@mwillbanks/tuil/cli.js"),
      "info",
      "--output",
      "json",
    ],
    { cwd: consumer, stdout: "pipe", stderr: "pipe" },
  );
  const installedCliOutput = await new Response(installedCli.stdout).text();
  const installedCliError = await new Response(installedCli.stderr).text();
  assertPublication(
    (await installedCli.exited) === 0,
    `Packed CLI failed: ${installedCliError.trim()}`,
  );
  assertPublication(
    (JSON.parse(installedCliOutput) as { readonly name?: string }).name ===
      "@mwillbanks/tuil",
    "Packed CLI returned invalid package information",
  );
  const standaloneSkills = Bun.spawn(
    [
      "bun",
      join(consumer, "node_modules/@mwillbanks/tuil-cli/bin.js"),
      "skills",
      "list",
      "--output",
      "json",
    ],
    { cwd: consumer, stdout: "pipe", stderr: "pipe" },
  );
  const standaloneSkillsOutput = await new Response(
    standaloneSkills.stdout,
  ).text();
  const standaloneSkillsError = await new Response(
    standaloneSkills.stderr,
  ).text();
  assertPublication(
    (await standaloneSkills.exited) === 0 &&
      (JSON.parse(standaloneSkillsOutput) as readonly unknown[]).length === 7,
    `Standalone packed CLI has no complete Agent Skills bundle: ${standaloneSkillsError.trim()}`,
  );
  const installedSkills = Bun.spawn(
    [
      "bun",
      join(consumer, "node_modules/@mwillbanks/tuil/cli.js"),
      "skills",
      "install",
      "--target",
      "installed-skills",
      "--output",
      "json",
    ],
    { cwd: consumer, stdout: "pipe", stderr: "pipe" },
  );
  const installedSkillsOutput = await new Response(
    installedSkills.stdout,
  ).text();
  const installedSkillsError = await new Response(
    installedSkills.stderr,
  ).text();
  assertPublication(
    (await installedSkills.exited) === 0,
    `Packed CLI could not install Agent Skills: ${installedSkillsError.trim()}`,
  );
  const installedSkillNames = (
    JSON.parse(installedSkillsOutput) as {
      readonly installed: readonly string[];
    }
  ).installed;
  assertPublication(
    installedSkillNames.length === 7 &&
      (await Bun.file(
        join(consumer, "installed-skills/building-tuil-applications/SKILL.md"),
      ).exists()),
    "Packed CLI installed an incomplete Agent Skills bundle",
  );
  const generatedTemplates = [
    "minimal",
    "application",
    "dashboard",
    "wizard",
    "command-center",
    "plugin",
    "component-library",
  ];
  for (const template of generatedTemplates) {
    const generatedProject = join(destination, `generated-${template}`);
    const initialize = Bun.spawn(
      [
        "bun",
        join(consumer, "node_modules/@mwillbanks/tuil/cli.js"),
        "init",
        generatedProject,
        "--template",
        template,
        "--router",
        "--forms",
        "--workflow",
        "--output",
        "silent",
      ],
      { cwd: consumer, stdout: "pipe", stderr: "pipe" },
    );
    const initializeError = await new Response(initialize.stderr).text();
    assertPublication(
      (await initialize.exited) === 0,
      `Packed CLI could not initialize the ${template} template: ${initializeError.trim()}`,
    );
    const generatedManifest = await Bun.file(
      join(generatedProject, "package.json"),
    ).json();
    assertPublication(
      generatedManifest.packageManager === "bun@1.4.4" &&
        generatedManifest.scripts?.dev === "bun --watch src/index.tsx" &&
        generatedManifest.scripts?.start === "bun src/index.tsx" &&
        generatedManifest.scripts?.test === "bun test" &&
        !generatedManifest.scripts?.typecheck &&
        !generatedManifest.scripts?.check &&
        !generatedManifest.devDependencies?.typescript,
      `Generated ${template} must publish the documented native Bun command contract`,
    );
    assertPublication(
      generatedManifest.overrides?.["@tanstack/devtools-event-client"] ===
        "0.5.1",
      `Generated ${template} must prevent optional form devtools from retaining terminal processes`,
    );
    for (const [name, version] of Object.entries(
      generatedManifest.dependencies ?? {},
    )) {
      if (!name.startsWith("@mwillbanks/")) continue;
      assertPublication(
        sourceVersions.has(name) && version === `^${sourceVersions.get(name)}`,
        `Generated ${template} dependency ${name} must match its current package version`,
      );
    }
    await Bun.write(
      join(generatedProject, "package.json"),
      JSON.stringify(
        {
          ...generatedManifest,
          overrides: { ...generatedManifest.overrides, ...overrides },
        },
        null,
        2,
      ) + "\n",
    );
    const generatedInstall = Bun.spawn(["bun", "install", "--ignore-scripts"], {
      cwd: generatedProject,
      stdout: "pipe",
      stderr: "pipe",
    });
    const generatedInstallError = await new Response(
      generatedInstall.stderr,
    ).text();
    assertPublication(
      (await generatedInstall.exited) === 0,
      `Generated ${template} installation failed: ${generatedInstallError}`,
    );
    const generatedTypecheck = Bun.spawn(["bun", "check", "--no-script"], {
      cwd: generatedProject,
      stdout: "pipe",
      stderr: "pipe",
    });
    const generatedTypecheckOutput = await new Response(
      generatedTypecheck.stdout,
    ).text();
    const generatedTypecheckError = await new Response(
      generatedTypecheck.stderr,
    ).text();
    assertPublication(
      (await generatedTypecheck.exited) === 0,
      `Generated ${template} typecheck failed: ${generatedTypecheckOutput}${generatedTypecheckError}`,
    );
    const generatedStart = Bun.spawn(["bun", "run", "start"], {
      cwd: generatedProject,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
    });
    const generatedStartOutput = await new Response(
      generatedStart.stdout,
    ).text();
    const generatedStartError = await new Response(
      generatedStart.stderr,
    ).text();
    const generatedStartExit = await generatedStart.exited;
    assertPublication(
      generatedStartExit === 0 &&
        generatedStartOutput.includes("Project setup"),
      `Generated ${template} start failed (exit ${generatedStartExit}, signal ${generatedStart.signalCode}): ${generatedStartOutput}${generatedStartError}`,
    );
    if (template === "component-library") {
      await Bun.write(
        join(generatedProject, "tests/phase4-runtime.test.tsx"),
        `import {expect, test} from "bun:test";
import {createApp} from "@mwillbanks/tuil";
import {renderStatic} from "@mwillbanks/tuil-ink";
import {defaultTheme, ThemeProvider} from "@mwillbanks/tuil-theme";
import {App} from "../src/app/app.tsx";

test("generated component library renders Phase 4 source", async () => {
  const app = createApp({
    component: () => <ThemeProvider theme={defaultTheme}><App /></ThemeProvider>,
    terminal: {mode: "static"},
    theme: defaultTheme,
  });
  const frame = await renderStatic(app);
  expect(frame).toContain("Component Library");
  expect(frame).toContain("Component");
  expect(frame).toContain("Data display");
});
`,
      );
    }
    const generatedTests = Bun.spawn(["bun", "test", "--bail"], {
      cwd: generatedProject,
      stdout: "pipe",
      stderr: "pipe",
    });
    const generatedTestOutput = await new Response(
      generatedTests.stdout,
    ).text();
    const generatedTestError = await new Response(generatedTests.stderr).text();
    assertPublication(
      (await generatedTests.exited) === 0,
      `Generated ${template} tests failed: ${generatedTestOutput}${generatedTestError}`,
    );
  }
} finally {
  await rm(destination, { recursive: true, force: true });
}
