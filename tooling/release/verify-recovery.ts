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
  releaseSha: string,
): Promise<readonly string[]> {
  const config = JSON.parse(
    await git(workspace, "show", `${releaseSha}:release-please-config.json`),
  ) as {
    readonly packages: Readonly<Record<string, ReleasePleasePackage>>;
  };
  const [, parent] = (
    await git(workspace, "rev-list", "--parents", "-n", "1", releaseSha)
  ).split(/\s+/);
  const tags = (
    await Promise.all(
      Object.entries(config.packages).map(
        async ([path, releasePackage]): Promise<string | undefined> => {
          const manifestPath = `${path}/package.json`;
          const manifest = JSON.parse(
            await git(workspace, "show", `${releaseSha}:${manifestPath}`),
          ) as { readonly version: string };
          if (parent) {
            try {
              const previous = JSON.parse(
                await git(workspace, "show", `${parent}:${manifestPath}`),
              ) as { readonly version: string };
              if (previous.version === manifest.version) return undefined;
            } catch {
              // A package absent from the first parent is a new release.
            }
          }
          return `${releasePackage.component}-v${manifest.version}`;
        },
      ),
    )
  ).filter((tag): tag is string => tag !== undefined);
  if (tags.length === 0) {
    throw new Error(
      `Release commit ${releaseSha} does not change a configured package version`,
    );
  }
  return Object.freeze(tags.sort());
}

async function missingReleaseTags(
  workspace: string,
  releaseSha: string,
  tags: readonly string[],
): Promise<readonly string[]> {
  const missing: string[] = [];
  for (const tag of tags) {
    try {
      const taggedSha = (
        await git(workspace, "rev-parse", `${tag}^{commit}`)
      ).toLowerCase();
      if (taggedSha !== releaseSha) missing.push(tag);
    } catch {
      missing.push(tag);
    }
  }
  return Object.freeze(missing);
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

  const missing = await missingReleaseTags(
    workspace,
    expectedSha,
    await expectedReleaseTags(workspace, expectedSha),
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
