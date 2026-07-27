import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveReleaseSha,
  writeReleaseSha,
  writeReleaseShaFromEnvironment,
} from "./resolve-release-sha.ts";

const firstSha = "1".repeat(40);
const secondSha = "2".repeat(40);

test("resolves one immutable commit for every released package", () => {
  expect(
    resolveReleaseSha(
      JSON.stringify(["packages/core", "packages/events"]),
      `${firstSha}\n${firstSha}\n`,
    ),
  ).toBe(firstSha);
});

test("writes the immutable commit to the GitHub Actions output", async () => {
  const root = await mkdtemp(join(tmpdir(), "tuil-release-sha-"));
  const output = join(root, "output");
  try {
    await writeReleaseSha(output, JSON.stringify(["packages/core"]), firstSha);
    expect(await readFile(output, "utf8")).toBe(`release_sha=${firstSha}\n`);
    await writeReleaseShaFromEnvironment({
      GITHUB_OUTPUT: output,
      RELEASED_PATHS: JSON.stringify(["packages/core"]),
      RELEASE_SHAS: firstSha,
    });
    expect(await readFile(output, "utf8")).toBe(
      `release_sha=${firstSha}\nrelease_sha=${firstSha}\n`,
    );
    await expect(writeReleaseShaFromEnvironment({})).rejects.toThrow(
      "GITHUB_OUTPUT is required",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects missing, malformed, or divergent release outputs", () => {
  expect(() => resolveReleaseSha("[]", "")).toThrow(
    "did not report any released package paths",
  );
  expect(() =>
    resolveReleaseSha(JSON.stringify(["packages/core"]), ""),
  ).toThrow("one full commit SHA per released package");
  expect(() =>
    resolveReleaseSha(
      JSON.stringify(["packages/core", "packages/events"]),
      `${firstSha}\n${secondSha}`,
    ),
  ).toThrow("disagree on their commit");
});
