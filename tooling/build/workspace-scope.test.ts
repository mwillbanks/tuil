import { expect, test } from "bun:test";
import {
  selectImpactedWorkspaces,
  type WorkspaceManifest,
} from "./workspace-scope.ts";

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

test("selects changed workspaces, dependents, and required dependencies", () => {
  expect([
    ...selectImpactedWorkspaces(manifests, ["packages/feature/src/index.ts"]),
  ]).toEqual(["feature", "application", "core"]);
});

test("does not build unrelated workspaces", () => {
  expect([
    ...selectImpactedWorkspaces(manifests, ["packages/unrelated/src/index.ts"]),
  ]).toEqual(["unrelated"]);
});

test("builds every workspace for shared build infrastructure changes", () => {
  expect([
    ...selectImpactedWorkspaces(manifests, ["tooling/build/package.ts"]),
  ]).toEqual(["core", "feature", "application", "unrelated"]);
});
