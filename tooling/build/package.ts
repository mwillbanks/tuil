import { existsSync } from "node:fs";
import { basename, join } from "node:path";

const directory = process.cwd();
const entries = ["src/index.ts", "src/index.tsx", "src/bin.ts"]
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
const normalizeDependencies = (
  dependencies: Record<string, string> | undefined,
) =>
  dependencies
    ? Object.fromEntries(
        Object.entries(dependencies).map(([name, version]) => [
          name,
          version.startsWith("workspace:") ? `^${manifest.version}` : version,
        ]),
      )
    : undefined;
const published = {
  name: manifest.name,
  version: manifest.version,
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
}
