import { resolve } from "node:path";

interface ReleasePleasePackage {
  readonly component: string;
}

export async function git(
  workspace: string,
  ...arguments_: readonly string[]
): Promise<string> {
  const process = Bun.spawn(["git", ...arguments_], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(process.stdout).text();
  const error = await new Response(process.stderr).text();
  if ((await process.exited) !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${error.trim()}`);
  }
  return output.trim();
}

export async function expectedReleaseTags(
  workspace: string,
): Promise<readonly string[]> {
  const config = (await Bun.file(
    resolve(workspace, "release-please-config.json"),
  ).json()) as {
    readonly packages: Readonly<Record<string, ReleasePleasePackage>>;
  };
  const tags = await Promise.all(
    Object.entries(config.packages).map(async ([path, releasePackage]) => {
      const manifest = (await Bun.file(
        resolve(workspace, path, "package.json"),
      ).json()) as { readonly version: string };
      return `${releasePackage.component}-v${manifest.version}`;
    }),
  );
  return Object.freeze(tags.sort());
}

export async function verifyRecoveryRelease(
  workspace: string,
  releaseSha: string,
): Promise<void> {
  if (!/^[0-9a-f]{40}$/i.test(releaseSha)) {
    throw new Error("RELEASE_SHA must be a full 40-character commit SHA");
  }
  const expectedSha = releaseSha.toLowerCase();
  const checkedOutSha = (
    await git(workspace, "rev-parse", "HEAD")
  ).toLowerCase();
  if (checkedOutSha !== expectedSha) {
    throw new Error(
      `Recovery checkout is ${checkedOutSha}, expected ${expectedSha}`,
    );
  }

  const tags = new Set(
    (await git(workspace, "tag", "--points-at", expectedSha))
      .split("\n")
      .filter(Boolean),
  );
  const missing = (await expectedReleaseTags(workspace)).filter(
    (tag) => !tags.has(tag),
  );
  if (missing.length > 0) {
    throw new Error(
      `Recovery commit is missing release tags: ${missing.join(", ")}`,
    );
  }
}

const workspace = resolve(import.meta.dir, "../..");
const releaseSha = process.env["RELEASE_SHA"] ?? "";
await (import.meta.main
  ? verifyRecoveryRelease(workspace, releaseSha)
  : undefined);
