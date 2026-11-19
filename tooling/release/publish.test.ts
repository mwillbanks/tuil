import { expect, test } from "bun:test";
import type { PublishArtifact } from "./artifacts.ts";
import {
  oidcPublishEnvironment,
  publicationPaths,
  publishRelease,
  publishTarballName,
  type PublishRuntime,
} from "./publish.ts";

const artifacts: readonly PublishArtifact[] = ["core", "consumer"].map(
  (name) => ({
    name: `@example/${name}`,
    version: "1.0.0",
    sourceDirectory: `/source/${name}`,
    artifactDirectory: `/artifact/${name}`,
    workspaceDependencies: name === "consumer" ? ["@example/core"] : [],
  }),
);

function fixture() {
  const calls: string[] = [];
  const commands: string[][] = [];
  const environments: Readonly<Record<string, string | undefined>>[] = [];
  const visible = new Set<string>();
  const requested: RequestInit[] = [];
  let sleeps = 0;
  let exitCode = 0;
  let status = 404;
  const runtime: PublishRuntime = {
    discover: async (workspace) => {
      calls.push(`discover ${workspace}`);
      return artifacts;
    },
    environment: {
      NODE_AUTH_TOKEN: "unused",
      NPM_TOKEN: "unused",
      GITHUB_SHA: "immutable-source",
      ACTIONS_ID_TOKEN_REQUEST_URL: "oidc",
    },
    exists: async () => true,
    fetch: (async (input: string | URL | Request, options?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const name = decodeURIComponent(
        new URL(url).pathname.split("/")[1] ?? "",
      );
      calls.push(`lookup ${name}`);
      requested.push(options ?? {});
      return new Response(null, { status: visible.has(name) ? 200 : status });
    }) as typeof fetch,
    spawn: (command, options) => {
      calls.push(`publish ${options.cwd}`);
      commands.push([...command]);
      environments.push(options.env);
      return { exited: Promise.resolve(exitCode) };
    },
    sleep: async (milliseconds) => {
      expect(milliseconds).toBe(5_000);
      sleeps += 1;
      calls.push("sleep");
      if (sleeps === 3) {
        visible.add("@example/core");
        visible.add("@example/consumer");
      }
    },
  };
  return {
    runtime,
    calls,
    commands,
    environments,
    visible,
    requested,
    get sleeps() {
      return sleeps;
    },
    set exitCode(value: number) {
      exitCode = value;
    },
    set status(value: number) {
      status = value;
    },
  };
}

test("submits dependencies and consumers before shared registry scan polling", async () => {
  const state = fixture();
  const result = await publishRelease("/release", "next", state.runtime);
  expect(state.calls.slice(0, 5)).toEqual([
    "discover /release",
    "lookup @example/core",
    "publish /artifact/core",
    "lookup @example/consumer",
    "publish /artifact/consumer",
  ]);
  expect(state.sleeps).toBe(3);
  expect(result).toEqual({
    published: ["@example/core@1.0.0", "@example/consumer@1.0.0"],
    releaseTag: "next",
  });
  expect(state.commands.every((command) => command.at(-1) === "next")).toBe(
    true,
  );
  expect(state.requested.every((options) => options.cache === "no-store")).toBe(
    true,
  );
  expect(
    state.requested.every(
      (options) =>
        new Headers(options.headers).get("cache-control") === "no-cache",
    ),
  ).toBe(true);
  expect(state.environments[0]).toEqual({
    GITHUB_SHA: "immutable-source",
    ACTIONS_ID_TOKEN_REQUEST_URL: "oidc",
  });
  expect(Object.isFrozen(result.published)).toBe(true);
});

test("retries skip visible publications without delaying or republishing them", async () => {
  const state = fixture();
  state.visible.add("@example/core");
  state.visible.add("@example/consumer");
  expect(await publishRelease("/release", "latest", state.runtime)).toEqual({
    published: [],
    releaseTag: "latest",
  });
  expect(state.commands).toEqual([]);
  expect(state.sleeps).toBe(0);
});

test("resumes a partial release and reports only packages still scanning", async () => {
  const state = fixture();
  state.visible.add("@example/core");
  let intervals = 0;
  const runtime = {
    ...state.runtime,
    sleep: async () => {
      intervals += 1;
    },
  };
  await expect(publishRelease("/release", "latest", runtime)).rejects.toThrow(
    "npm did not expose published packages: @example/consumer@1.0.0",
  );
  expect(intervals).toBe(120);
  expect(state.commands).toHaveLength(1);
  expect(
    state.calls.filter((call) => call === "lookup @example/core"),
  ).toHaveLength(1);
});

test("fails a refused submission before publishing dependent consumers", async () => {
  const state = fixture();
  state.exitCode = 1;
  await expect(
    publishRelease("/release", "latest", state.runtime),
  ).rejects.toThrow("Failed to publish @example/core@1.0.0");
  expect(state.commands).toHaveLength(1);
  expect(state.sleeps).toBe(0);
});

test("reports every remaining package after bounded shared polling", async () => {
  const state = fixture();
  const runtime = { ...state.runtime, sleep: async () => {} };
  await expect(publishRelease("/release", "latest", runtime)).rejects.toThrow(
    "npm did not expose published packages: @example/core@1.0.0, @example/consumer@1.0.0",
  );
  expect(state.commands).toHaveLength(2);
  expect(state.requested).toHaveLength(244);
});

test("stops on registry errors instead of treating unavailable service as unpublished", async () => {
  const state = fixture();
  state.status = 503;
  await expect(
    publishRelease("/release", "latest", state.runtime),
  ).rejects.toThrow(
    "npm registry lookup failed for @example/core@1.0.0: HTTP 503",
  );
  expect(state.commands).toEqual([]);
});

test("publishes preflighted exact tarballs with existing provenance flags", async () => {
  const state = fixture();
  const checked: string[] = [];
  const runtime = {
    ...state.runtime,
    exists: async (path: string) => {
      checked.push(path);
      return true;
    },
  };
  await publishRelease("/release", "latest", runtime, "/tarballs");
  expect(checked).toEqual([
    "/tarballs/example-core-1.0.0.tgz",
    "/tarballs/example-consumer-1.0.0.tgz",
  ]);
  expect(state.commands[0]).toEqual([
    "npm",
    "publish",
    "--access",
    "public",
    "--provenance",
    "--tag",
    "latest",
    "/tarballs/example-core-1.0.0.tgz",
  ]);
  expect(state.commands[1]?.at(-1)).toBe(
    "/tarballs/example-consumer-1.0.0.tgz",
  );
});

test("rejects missing tarballs before publishing any package", async () => {
  const state = fixture();
  const runtime = {
    ...state.runtime,
    exists: async (path: string) => path.endsWith("example-core-1.0.0.tgz"),
  };
  await expect(
    publishRelease("/release", "latest", runtime, "/tarballs"),
  ).rejects.toThrow(
    "Missing publication tarball /tarballs/example-consumer-1.0.0.tgz",
  );
  expect(state.commands).toEqual([]);
  expect(state.requested).toEqual([]);
  await expect(
    publishRelease("/release", "latest", runtime, "tarballs"),
  ).rejects.toThrow("Publication tarball directory must be absolute");
});

test("accepts explicit absolute release paths and rejects ambiguous CLI arguments", () => {
  expect(publicationPaths(["/release", "/tarballs"])).toEqual({
    workspace: "/release",
    tarballDirectory: "/tarballs",
  });
  expect(publicationPaths(["/release"])).toEqual({
    workspace: "/release",
    tarballDirectory: undefined,
  });
  expect(publicationPaths([]).workspace).toBe(
    import.meta.dir.replace(/\/tooling\/release$/, ""),
  );
  expect(() => publicationPaths(["relative"])).toThrow("Usage:");
  expect(() => publicationPaths(["/release", "/tarballs", "/extra"])).toThrow(
    "Usage:",
  );
  expect(publishTarballName({ name: "unscoped", version: "2.0.0" })).toBe(
    "unscoped-2.0.0.tgz",
  );
  expect(
    oidcPublishEnvironment({ NPM_TOKEN: "unused", OTHER: "retained" }),
  ).toEqual({ OTHER: "retained" });
});
