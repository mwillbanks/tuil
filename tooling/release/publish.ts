import { isAbsolute, join, resolve } from "node:path";
import {
  discoverPublishArtifacts,
  npmPublishArguments,
  type PublishArtifact,
} from "./artifacts.ts";

interface PublishProcess {
  readonly exited: Promise<number>;
}

export interface PublishRuntime {
  readonly discover: (workspace: string) => Promise<readonly PublishArtifact[]>;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  readonly exists?: (path: string) => Promise<boolean>;
  readonly spawn: (
    command: readonly string[],
    options: {
      readonly cwd: string;
      readonly stdout: "inherit";
      readonly stderr: "inherit";
      readonly env: Readonly<Record<string, string | undefined>>;
    },
  ) => PublishProcess;
  readonly sleep: (milliseconds: number) => Promise<unknown>;
}

const defaultRuntime: PublishRuntime = {
  discover: discoverPublishArtifacts,
  environment: process.env,
  fetch,
  spawn: Bun.spawn as unknown as PublishRuntime["spawn"],
  sleep: Bun.sleep,
};

const npmTokenVariables = new Set(["NODE_AUTH_TOKEN", "NPM_TOKEN"]);
const registryPollAttempts = 121;
const registryPollInterval = 5_000;

export function publishTarballName(
  artifact: Pick<PublishArtifact, "name" | "version">,
): string {
  return `${artifact.name.replace(/^@/, "").replace("/", "-")}-${artifact.version}.tgz`;
}

export function oidcPublishEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !npmTokenVariables.has(name),
    ),
  );
}

export async function publishRelease(
  workspace: string,
  releaseTag: string,
  runtime: PublishRuntime = defaultRuntime,
  tarballDirectory?: string,
): Promise<{
  readonly published: readonly string[];
  readonly releaseTag: string;
}> {
  const artifacts = await runtime.discover(workspace);
  const tarballs = new Map<string, string>();
  if (tarballDirectory !== undefined) {
    if (!isAbsolute(tarballDirectory)) {
      throw new Error("Publication tarball directory must be absolute");
    }
    for (const artifact of artifacts) {
      const path = join(tarballDirectory, publishTarballName(artifact));
      const exists =
        runtime.exists ?? ((path: string) => Bun.file(path).exists());
      if (!(await exists(path))) {
        throw new Error(`Missing publication tarball ${path}`);
      }
      tarballs.set(artifact.name, path);
    }
  }
  const published: string[] = [];
  const pending = new Map<string, PublishArtifact>();
  const isPublished = async (
    name: string,
    version: string,
  ): Promise<boolean> => {
    const response = await runtime.fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      { cache: "no-store", headers: { "cache-control": "no-cache" } },
    );
    if (response.ok) return true;
    if (response.status === 404) return false;
    throw new Error(
      `npm registry lookup failed for ${name}@${version}: HTTP ${response.status}`,
    );
  };

  for (const artifact of artifacts) {
    const specifier = `${artifact.name}@${artifact.version}`;
    if (!(await isPublished(artifact.name, artifact.version))) {
      const tarball = tarballs.get(artifact.name);
      const arguments_ = [...npmPublishArguments(releaseTag)];
      if (tarball) arguments_.push(tarball);
      const publish = runtime.spawn(arguments_, {
        cwd: artifact.artifactDirectory,
        stdout: "inherit",
        stderr: "inherit",
        env: oidcPublishEnvironment(runtime.environment),
      });
      if ((await publish.exited) !== 0) {
        throw new Error(`Failed to publish ${specifier}`);
      }
      published.push(specifier);
      pending.set(specifier, artifact);
    }
  }

  for (
    let attempt = 0;
    pending.size > 0 && attempt < registryPollAttempts;
    attempt += 1
  ) {
    for (const [specifier, artifact] of pending) {
      if (await isPublished(artifact.name, artifact.version)) {
        pending.delete(specifier);
      }
    }
    if (pending.size > 0 && attempt + 1 < registryPollAttempts) {
      await runtime.sleep(registryPollInterval);
    }
  }
  if (pending.size > 0) {
    throw new Error(
      `npm did not expose published packages: ${[...pending.keys()].join(", ")}`,
    );
  }

  return Object.freeze({
    published: Object.freeze(published),
    releaseTag,
  });
}

export function publicationPaths(arguments_: readonly string[]): {
  readonly workspace: string;
  readonly tarballDirectory: string | undefined;
} {
  if (arguments_.length > 2 || arguments_.some((path) => !isAbsolute(path))) {
    throw new Error(
      "Usage: publish.ts [absolute workspace] [absolute tarball directory]",
    );
  }
  return {
    workspace: arguments_[0] ?? resolve(import.meta.dir, "../.."),
    tarballDirectory: arguments_[1],
  };
}

if (import.meta.main) {
  const { workspace, tarballDirectory } = publicationPaths(
    process.argv.slice(2),
  );
  const releaseTag = process.env["NPM_CONFIG_TAG"] ?? "latest";
  const result = await publishRelease(
    workspace,
    releaseTag,
    defaultRuntime,
    tarballDirectory,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
