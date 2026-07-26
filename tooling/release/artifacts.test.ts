import { expect, test } from "bun:test";
import {
  npmPackArguments,
  npmPublishArguments,
  orderPublishArtifacts,
  type PublishArtifact,
} from "./artifacts.ts";

test("packs and publishes the same normalized dist artifact", () => {
  expect(npmPackArguments("/tmp/releases")[0]).toBe("npm");
  expect(npmPublishArguments()).toEqual([
    "npm",
    "publish",
    "--access",
    "public",
    "--provenance",
    "--tag",
    "latest",
  ]);
  expect(npmPublishArguments("next").at(-1)).toBe("next");
});

test("publishes workspace dependencies before their consumers", () => {
  const artifact = (
    name: string,
    workspaceDependencies: readonly string[] = [],
  ): PublishArtifact => ({
    name,
    version: "1.0.0",
    sourceDirectory: `/source/${name}`,
    artifactDirectory: `/artifact/${name}`,
    workspaceDependencies,
  });
  const ordered = orderPublishArtifacts([
    artifact("@mwillbanks/tuil", [
      "@mwillbanks/tuil-story",
      "@mwillbanks/tuil-core",
    ]),
    artifact("@mwillbanks/tuil-story", ["@mwillbanks/tuil-core"]),
    artifact("@mwillbanks/tuil-core"),
  ]);
  expect(ordered.map(({ name }) => name)).toEqual([
    "@mwillbanks/tuil-core",
    "@mwillbanks/tuil-story",
    "@mwillbanks/tuil",
  ]);
  expect(() =>
    orderPublishArtifacts([artifact("a", ["b"]), artifact("b", ["a"])]),
  ).toThrow("dependency cycle");
});
