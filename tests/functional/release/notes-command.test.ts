import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  notesDraft,
  notesManifest,
  releaseNotesCommand,
} from "../../../tooling/release/notes.ts";

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  if (result.exitCode !== 0)
    throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
}

test("stamps authored notes, verifies release tags, and publishes the curated body", async () => {
  const root = await mkdtemp(join(tmpdir(), "tuil-release-notes-"));
  const manifest = join(root, ".release-please-manifest.json");
  const path = "packages/core";
  try {
    git(root, "init", "-q");
    git(root, "config", "user.name", "TUIL tests");
    git(root, "config", "user.email", "tuil@example.invalid");
    await Bun.write(manifest, JSON.stringify({ [path]: "1.0.0" }));
    git(root, "add", ".");
    git(root, "commit", "-qm", "base");
    const base = git(root, "rev-parse", "HEAD");
    await Promise.all([
      Bun.write(manifest, JSON.stringify({ [path]: "1.0.1" })),
      Bun.write(
        join(root, "release-please-config.json"),
        JSON.stringify({ packages: { [path]: { component: "tuil-core" } } }),
      ),
      Bun.write(join(root, notesManifest), "{}"),
      Bun.write(
        join(root, notesDraft),
        "---\ntitle: Upcoming release\n---\n\nAuthored body with [examples](/docs/guides/testing/).\n",
      ),
      Bun.write(
        join(root, "CHANGELOG.md"),
        "# Changelog\n\n## NEXT_RELEASE\n\nAuthored entry.\n",
      ),
    ]);
    await expect(
      releaseNotesCommand(["check", "--base", base], { root }),
    ).rejects.toThrow("unstamped");
    await expect(
      releaseNotesCommand(["stamp", "--base", "0".repeat(40)], { root }),
    ).rejects.toThrow();
    await expect(
      releaseNotesCommand(["stamp", "--bogus", base], { root }),
    ).rejects.toThrow("Usage");
    await releaseNotesCommand(["stamp", "--base", base], { root });
    await releaseNotesCommand(["check", "--base", base], { root });
    expect(await Bun.file(join(root, notesDraft)).exists()).toBe(false);
    expect(await Bun.file(join(root, "CHANGELOG.md")).text()).toContain(
      "Authored entry.",
    );
    await expect(
      releaseNotesCommand(["verify-tags"], { root }),
    ).rejects.toThrow("no mapped component tags");
    git(root, "add", ".");
    git(root, "commit", "-qm", "candidate");
    git(root, "tag", "tuil-core-v1.0.1");
    await releaseNotesCommand(["verify-tags"], { root });
    let delivery: string[] | undefined;
    await releaseNotesCommand(["publish"], {
      root,
      editRelease: async (cwd, tag, markdown) => {
        delivery = [cwd, tag, markdown];
        return 0;
      },
    });
    expect(delivery?.slice(0, 2)).toEqual([root, "tuil-core-v1.0.1"]);
    expect(delivery?.[2]).toContain("Authored body");
    expect(delivery?.[2]).toContain(
      "https://mwillbanks.github.io/tuil/docs/guides/testing/",
    );
    await expect(
      releaseNotesCommand(["publish"], { root, editRelease: async () => 1 }),
    ).rejects.toThrow("Unable to publish");
    await Bun.write(join(root, notesManifest), "{}");
    await expect(
      releaseNotesCommand(["verify-tags"], { root }),
    ).rejects.toThrow("Missing release notes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
