import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installRegistryDependencies,
  type RegistryDependencySpawn,
} from "./registry-dependencies.ts";

test("registry dependency transactions restore files and reconcile locks", async () => {
  const root = await mkdtemp(join(tmpdir(), "tuil-dependencies-"));
  try {
    await writeFile(join(root, "package.json"), "original package\n");
    await writeFile(join(root, "bun.lock"), "original lock\n");
    const commands: readonly string[][] = [];
    const successful: RegistryDependencySpawn = (command) => {
      (commands as string[][]).push([...command]);
      return { exited: Promise.resolve(0) };
    };
    const rollback = await installRegistryDependencies(
      root,
      ["example@1"],
      "json",
      successful,
    );
    await writeFile(join(root, "package.json"), "changed\n");
    await writeFile(join(root, "bun.lock"), "changed\n");
    await writeFile(join(root, "bun.lockb"), "generated\n");
    await rollback();
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(
      "original package\n",
    );
    expect(await readFile(join(root, "bun.lock"), "utf8")).toBe(
      "original lock\n",
    );
    expect(await Bun.file(join(root, "bun.lockb")).exists()).toBeFalse();
    expect(commands).toEqual([
      ["bun", "add", "--", "example@1"],
      ["bun", "install", "--frozen-lockfile"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("registry dependency transactions report install and reconciliation failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "tuil-dependencies-"));
  try {
    await writeFile(join(root, "package.json"), "original\n");
    const exits = [1, 0];
    await expect(
      installRegistryDependencies(root, ["example@1"], "interactive", () => ({
        exited: Promise.resolve(exits.shift() ?? 0),
      })),
    ).rejects.toThrow("Registry dependency installation failed");

    const reconciliationExits = [0, 1];
    const rollback = await installRegistryDependencies(
      root,
      ["example@1"],
      "silent",
      () => ({
        exited: Promise.resolve(reconciliationExits.shift() ?? 0),
      }),
    );
    await expect(rollback()).rejects.toThrow(
      "Dependency rollback reconciliation failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
