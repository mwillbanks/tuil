import { resolve } from "node:path";
import { discoverPublishArtifacts, npmPublishArguments } from "./artifacts.ts";

const workspace = resolve(import.meta.dir, "../..");
const artifacts = await discoverPublishArtifacts(workspace);
const releaseTag = process.env["NPM_CONFIG_TAG"] ?? "latest";
const published: string[] = [];

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

process.stdout.write(`${JSON.stringify({ published, releaseTag })}\n`);
