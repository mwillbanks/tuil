import { appendFile } from "node:fs/promises";

export function resolveReleaseSha(
  releasedPathsJson: string,
  releaseShas: string,
): string {
  const releasedPaths = JSON.parse(releasedPathsJson) as unknown;
  if (
    !Array.isArray(releasedPaths) ||
    releasedPaths.length === 0 ||
    releasedPaths.some((path) => typeof path !== "string")
  ) {
    throw new Error("Release Please did not report any released package paths");
  }

  const shas = releaseShas
    .split(/\s+/)
    .map((sha) => sha.trim().toLowerCase())
    .filter(Boolean);
  if (
    shas.length !== releasedPaths.length ||
    shas.some((sha) => !/^[0-9a-f]{40}$/.test(sha))
  ) {
    throw new Error(
      "Release Please did not report one full commit SHA per released package",
    );
  }

  const uniqueShas = [...new Set(shas)];
  if (uniqueShas.length !== 1) {
    throw new Error(
      `Released package tags disagree on their commit: ${uniqueShas.join(", ")}`,
    );
  }
  return uniqueShas[0] as string;
}

export async function writeReleaseSha(
  githubOutput: string,
  releasedPathsJson: string,
  releaseShas: string,
): Promise<void> {
  const releaseSha = resolveReleaseSha(releasedPathsJson, releaseShas);
  await appendFile(githubOutput, `release_sha=${releaseSha}\n`);
}

export async function writeReleaseShaFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const githubOutput = environment["GITHUB_OUTPUT"];
  if (!githubOutput) throw new Error("GITHUB_OUTPUT is required");
  await writeReleaseSha(
    githubOutput,
    environment["RELEASED_PATHS"] ?? "",
    environment["RELEASE_SHAS"] ?? "",
  );
}

await (import.meta.main
  ? writeReleaseShaFromEnvironment(process.env)
  : undefined);
