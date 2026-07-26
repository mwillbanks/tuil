import { expect, test } from "bun:test";
import { normalizePublishedDependencies } from "./publication-manifest.ts";

test("publishes each workspace dependency at its own independent version", () => {
  expect(
    normalizePublishedDependencies(
      {
        "@mwillbanks/tuil-core": "workspace:*",
        react: "catalog:",
      },
      {
        catalog: { react: "^19.2.8" },
        workspaceVersions: new Map([
          ["@mwillbanks/tuil-story", "0.2.0"],
          ["@mwillbanks/tuil-core", "0.1.3"],
        ]),
      },
    ),
  ).toEqual({
    "@mwillbanks/tuil-core": "^0.1.3",
    react: "^19.2.8",
  });
  expect(
    normalizePublishedDependencies(undefined, {
      catalog: {},
      workspaceVersions: new Map(),
    }),
  ).toBeUndefined();
  expect(
    normalizePublishedDependencies(
      { exact: "1.2.3" },
      { catalog: {}, workspaceVersions: new Map() },
    ),
  ).toEqual({ exact: "1.2.3" });
  expect(() =>
    normalizePublishedDependencies(
      { missing: "workspace:*" },
      { catalog: {}, workspaceVersions: new Map() },
    ),
  ).toThrow("no publishable package version");
  expect(() =>
    normalizePublishedDependencies(
      { missing: "catalog:" },
      { catalog: {}, workspaceVersions: new Map() },
    ),
  ).toThrow("no published version");
});
