import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "../..");
const packageRoot = join(workspace, "packages");
const packageDirectories = (
  await readdir(packageRoot, {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packageRoot, entry.name))
  .sort();

for (const directory of packageDirectories) {
  const sourceManifest = Bun.file(join(directory, "package.json"));
  if (!(await sourceManifest.exists())) continue;
  const manifest = (await Bun.file(
    join(directory, "dist/package.json"),
  ).json()) as {
    readonly name: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<
      Record<string, string | Readonly<Record<string, string>>>
    >;
    readonly bin?: Readonly<Record<string, string>>;
  };
  for (const version of Object.values({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })) {
    if (version.startsWith("workspace:") || version.startsWith("catalog:")) {
      throw new Error(`${manifest.name} publishes an internal dependency`);
    }
  }
  const exportedPaths = Object.values(manifest.exports ?? {}).flatMap(
    (value) => (typeof value === "string" ? [value] : Object.values(value)),
  );
  for (const path of [...exportedPaths, ...Object.values(manifest.bin ?? {})]) {
    if (!(await Bun.file(join(directory, "dist", path)).exists())) {
      throw new Error(`${manifest.name} publishes missing path "${path}"`);
    }
  }
}

const tuilBundle = await readFile(
  join(packageRoot, "tuil/dist/index.js"),
  "utf8",
);
if (
  !tuilBundle.includes('from "@mwillbanks/tuil-core"') ||
  tuilBundle.includes("class Lifecycle")
) {
  throw new Error("Published tuil runtime bundles a duplicate core runtime");
}

const cli = Bun.spawn(
  ["bun", join(packageRoot, "tuil/dist/cli.js"), "info", "--output", "json"],
  { cwd: workspace, stdout: "pipe", stderr: "pipe" },
);
const cliOutput = await new Response(cli.stdout).text();
const cliError = await new Response(cli.stderr).text();
if ((await cli.exited) !== 0) {
  throw new Error(`Published tuil CLI failed: ${cliError.trim()}`);
}
if (
  (JSON.parse(cliOutput) as { readonly name?: string }).name !==
  "@mwillbanks/tuil"
) {
  throw new Error("Published tuil CLI returned invalid package information");
}

const destination = await mkdtemp(join(tmpdir(), "tuil-publication-"));
try {
  const archiveByPackage = new Map<string, string>();
  for (const directory of packageDirectories) {
    if (!(await Bun.file(join(directory, "dist/package.json")).exists())) {
      continue;
    }
    const manifest = (await Bun.file(
      join(directory, "dist/package.json"),
    ).json()) as { readonly name: string };
    const pack = Bun.spawn(
      [
        "bun",
        "pm",
        "pack",
        "--destination",
        destination,
        "--ignore-scripts",
        "--quiet",
      ],
      {
        cwd: join(directory, "dist"),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const packedOutput = await new Response(pack.stdout).text();
    const error = await new Response(pack.stderr).text();
    if ((await pack.exited) !== 0) {
      throw new Error(`${manifest.name} could not be packed: ${error.trim()}`);
    }
    const packedName = packedOutput.trim().split("\n").at(-1);
    if (!packedName) {
      throw new Error(`${manifest.name} did not report a package archive`);
    }
    const archive = isAbsolute(packedName)
      ? packedName
      : join(destination, basename(packedName));
    if ((await stat(archive)).size === 0) {
      throw new Error(`${manifest.name} produced an empty package archive`);
    }
    archiveByPackage.set(manifest.name, archive);
  }
  const archives = await readdir(destination);
  if (archives.length !== packageDirectories.length) {
    throw new Error(
      `Expected ${packageDirectories.length} package archives, found ${archives.length}`,
    );
  }
  const manifests = await Promise.all(
    packageDirectories.map((directory) =>
      readFile(join(directory, "dist/package.json"), "utf8"),
    ),
  );
  if (
    manifests.some(
      (manifest) =>
        manifest.includes('"workspace:') || manifest.includes('"catalog:'),
    )
  ) {
    throw new Error(
      "A packed manifest retained a workspace or catalog protocol",
    );
  }
  const formManifest = JSON.parse(
    await readFile(join(packageRoot, "form/dist/package.json"), "utf8"),
  ) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
  };
  if (
    formManifest.dependencies?.["@tanstack/react-form"] ||
    !formManifest.peerDependencies?.["@tanstack/react-form"]
  ) {
    throw new Error(
      "Published form package must expose TanStack React Form as a peer",
    );
  }
  const consumer = join(destination, "consumer");
  await mkdir(consumer, { recursive: true });
  await Bun.write(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "tuil-publication-consumer",
        private: true,
        type: "module",
        dependencies: {
          "@tanstack/react-form": "^1.33.2",
          "@tanstack/pacer": "^0.21.1",
          ink: "^7.1.1",
          "ink-testing-library": "^4.0.0",
          react: "^19.2.8",
          "react-devtools-core": "^7.0.1",
          nusm: "^1.1.0",
          "@types/bun": "latest",
          "@types/react": "^19.2.17",
          typescript: "^7.0.2",
        },
      },
      null,
      2,
    )}\n`,
  );
  const install = Bun.spawn(["bun", "install", "--ignore-scripts"], {
    cwd: consumer,
    stdout: "pipe",
    stderr: "pipe",
  });
  const installError = await new Response(install.stderr).text();
  if ((await install.exited) !== 0) {
    throw new Error(
      `Packed package consumer installation failed: ${installError.trim()}`,
    );
  }
  for (const [name, archive] of archiveByPackage) {
    const packageDirectory = join(consumer, "node_modules", ...name.split("/"));
    await mkdir(packageDirectory, { recursive: true });
    const extract = Bun.spawn(
      ["tar", "-xzf", archive, "-C", packageDirectory, "--strip-components=1"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const extractError = await new Response(extract.stderr).text();
    if ((await extract.exited) !== 0) {
      throw new Error(
        `Could not extract packed package ${name}: ${extractError.trim()}`,
      );
    }
  }
  await Bun.write(
    join(consumer, "smoke.ts"),
    `import {Lifecycle} from "@mwillbanks/tuil-core";
import {createApp, createOperation, createRouter, createWorkflow, defineOperation, defineRoutes, defineStep, defineWorkflow, route} from "@mwillbanks/tuil";
import {Text, renderStatic} from "@mwillbanks/tuil-ink";
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
  if ((await consumerSmoke.exited) !== 0) {
    throw new Error(`Packed package consumer failed: ${smokeError.trim()}`);
  }
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
  if ((await installedCli.exited) !== 0) {
    throw new Error(`Packed CLI failed: ${installedCliError.trim()}`);
  }
  if (
    (JSON.parse(installedCliOutput) as { readonly name?: string }).name !==
    "@mwillbanks/tuil"
  ) {
    throw new Error("Packed CLI returned invalid package information");
  }
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
    const generatedProject = join(consumer, `generated-${template}`);
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
    if ((await initialize.exited) !== 0) {
      throw new Error(
        `Packed CLI could not initialize the ${template} template: ${initializeError.trim()}`,
      );
    }
    await symlink(
      join(consumer, "node_modules"),
      join(generatedProject, "node_modules"),
      "dir",
    );
    const generatedTypecheck = Bun.spawn(
      ["bun", join(consumer, "node_modules/typescript/bin/tsc"), "--noEmit"],
      { cwd: generatedProject, stdout: "pipe", stderr: "pipe" },
    );
    const generatedTypecheckOutput = await new Response(
      generatedTypecheck.stdout,
    ).text();
    const generatedTypecheckError = await new Response(
      generatedTypecheck.stderr,
    ).text();
    if ((await generatedTypecheck.exited) !== 0) {
      throw new Error(
        `Generated ${template} typecheck failed: ${generatedTypecheckOutput}${generatedTypecheckError}`,
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
    if ((await generatedTests.exited) !== 0) {
      throw new Error(
        `Generated ${template} tests failed: ${generatedTestOutput}${generatedTestError}`,
      );
    }
  }
} finally {
  await rm(destination, { recursive: true, force: true });
}
