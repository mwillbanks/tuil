import { mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { discoverPublishArtifacts, npmPackArguments } from "./artifacts.ts";
import { publishTarballName } from "./publish.ts";
import {
  expectedReleaseTags,
  verifyRecoveryRelease,
} from "./verify-recovery.ts";

export async function packRecoveryRelease(
  workspace: string | undefined,
  output: string | undefined,
  releaseSha: string | undefined,
): Promise<void> {
  if (
    !workspace ||
    !isAbsolute(workspace) ||
    !output ||
    !isAbsolute(output) ||
    !releaseSha
  ) {
    throw new Error(
      "Pass the absolute release workspace, output directory, and release SHA",
    );
  }

  await verifyRecoveryRelease(workspace, releaseSha);
  const tags = await expectedReleaseTags(workspace, releaseSha.toLowerCase());
  const directory = join(output, "packs");
  await mkdir(output, { recursive: true });
  await mkdir(directory);
  const artifacts = await discoverPublishArtifacts(workspace);
  if (artifacts.length === 0) {
    throw new Error("No public release artifacts to pack");
  }

  for (const artifact of artifacts) {
    const pack = Bun.spawn([...npmPackArguments(directory)], {
      cwd: artifact.artifactDirectory,
      stdout: "inherit",
      stderr: "inherit",
    });
    if ((await pack.exited) !== 0) {
      throw new Error(`Could not pack ${artifact.name}@${artifact.version}`);
    }
    if (
      !(await Bun.file(join(directory, publishTarballName(artifact))).exists())
    ) {
      throw new Error(
        `npm pack did not produce the expected tarball for ${artifact.name}`,
      );
    }
  }

  await Bun.write(
    join(output, "source.json"),
    JSON.stringify({
      source: {
        repository: "https://github.com/mwillbanks/tuil",
        commit: releaseSha.toLowerCase(),
        tags,
      },
    }),
  );
}

if (import.meta.main) {
  const [workspace, output, releaseSha] = Bun.argv.slice(2);
  await packRecoveryRelease(workspace, output, releaseSha);
}
