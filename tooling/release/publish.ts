import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  discoverPublishArtifacts,
  npmPublishArguments,
  resolveReleaseTag,
} from "./artifacts.ts";

const workspace = resolve(import.meta.dir, "../..");
const artifacts = await discoverPublishArtifacts(workspace);
const releaseTag = await resolveReleaseTag(workspace);
const published: string[] = [];
const releaseEvents: Array<{
  readonly type: "git-tag";
  readonly tag: string;
  readonly packageName: string;
}> = [];

async function isPublished(name: string, version: string): Promise<boolean> {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
  );
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new Error(
    `npm registry lookup failed for ${name}@${version}: HTTP ${response.status}`,
  );
}

for (const artifact of artifacts) {
  const specifier = `${artifact.name}@${artifact.version}`;
  if (!(await isPublished(artifact.name, artifact.version))) {
    const publish = Bun.spawn([...npmPublishArguments(releaseTag)], {
      cwd: artifact.artifactDirectory,
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        NODE_AUTH_TOKEN:
          process.env["NODE_AUTH_TOKEN"] ?? process.env["NPM_TOKEN"] ?? "",
      },
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
    await Bun.sleep(1_000);
  }
  if (!verified) {
    throw new Error(`npm did not expose published package ${specifier}`);
  }
}

for (const artifact of artifacts) {
  const tag = `${artifact.name}@${artifact.version}`;
  const existing = Bun.spawn(["git", "tag", "--list", tag], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = (await new Response(existing.stdout).text()).trim();
  const error = await new Response(existing.stderr).text();
  if ((await existing.exited) !== 0) {
    throw new Error(`Could not inspect release tag ${tag}: ${error.trim()}`);
  }
  if (!output) {
    releaseEvents.push({
      type: "git-tag",
      tag,
      packageName: artifact.name,
    });
  }
}

const changesetsOutput = process.env["CHANGESETS_OUTPUT"];
if (changesetsOutput) {
  await appendFile(
    changesetsOutput,
    releaseEvents.map((event) => JSON.stringify(event)).join("\n") +
      (releaseEvents.length > 0 ? "\n" : ""),
    "utf8",
  );
} else {
  for (const event of releaseEvents) {
    const create = Bun.spawn(["git", "tag", event.tag], {
      cwd: workspace,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await create.exited) !== 0) {
      throw new Error(`Could not create release tag ${event.tag}`);
    }
  }
}

process.stdout.write(
  `${JSON.stringify({ published, releaseTag, releaseEvents })}\n`,
);
