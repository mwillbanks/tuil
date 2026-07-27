import { resolve } from "node:path";
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
): Promise<{
  readonly published: readonly string[];
  readonly releaseTag: string;
}> {
  const artifacts = await runtime.discover(workspace);
  const published: string[] = [];
  const isPublished = async (
    name: string,
    version: string,
  ): Promise<boolean> => {
    const response = await runtime.fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
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
      const publish = runtime.spawn([...npmPublishArguments(releaseTag)], {
        cwd: artifact.artifactDirectory,
        stdout: "inherit",
        stderr: "inherit",
        env: oidcPublishEnvironment(runtime.environment),
      });
      if ((await publish.exited) !== 0) {
        throw new Error(`Failed to publish ${specifier}`);
      }
      published.push(specifier);
    }
    let verified = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await isPublished(artifact.name, artifact.version)) {
        verified = true;
        break;
      }
      await runtime.sleep(1_000);
    }
    if (!verified) {
      throw new Error(`npm did not expose published package ${specifier}`);
    }
  }

  return Object.freeze({
    published: Object.freeze(published),
    releaseTag,
  });
}

const workspace = resolve(import.meta.dir, "../..");
const releaseTag = process.env["NPM_CONFIG_TAG"] ?? "latest";
const result = import.meta.main
  ? await publishRelease(workspace, releaseTag)
  : undefined;
process.stdout.write(result ? `${JSON.stringify(result)}\n` : "");
