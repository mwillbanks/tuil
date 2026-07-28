import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RenderMode } from "@mwillbanks/tuil";

interface FileSnapshot {
  readonly path: string;
  readonly content?: Uint8Array;
}

export interface RegistryDependencyProcess {
  readonly exited: Promise<number>;
}

export type RegistryDependencySpawn = (
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly stdout: "ignore" | "inherit";
    readonly stderr: "ignore" | "inherit";
  },
) => RegistryDependencyProcess;

const defaultSpawn: RegistryDependencySpawn = (command, options) =>
  Bun.spawn([...command], options);

async function captureFile(path: string): Promise<FileSnapshot> {
  try {
    return { path, content: await readFile(path) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path };
    throw error;
  }
}

async function restoreFiles(snapshots: readonly FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.content === undefined) {
      await rm(snapshot.path, { force: true });
    } else {
      await writeFile(snapshot.path, snapshot.content);
    }
  }
}

export async function installRegistryDependencies(
  root: string,
  dependencies: readonly string[],
  mode: RenderMode,
  spawn: RegistryDependencySpawn = defaultSpawn,
): Promise<() => Promise<void>> {
  const snapshots = await Promise.all(
    ["package.json", "bun.lock", "bun.lockb"].map((name) =>
      captureFile(join(root, name)),
    ),
  );
  const quiet = mode === "silent" || mode === "json";
  const rollback = async () => {
    await restoreFiles(snapshots);
    const reconcile = spawn(
      [
        "bun",
        "install",
        ...(snapshots.some(
          (snapshot) =>
            basename(snapshot.path) === "bun.lock" &&
            snapshot.content !== undefined,
        )
          ? ["--frozen-lockfile"]
          : []),
      ],
      {
        cwd: root,
        stdout: quiet ? "ignore" : "inherit",
        stderr: quiet ? "ignore" : "inherit",
      },
    );
    if ((await reconcile.exited) !== 0) {
      throw new Error("Dependency rollback reconciliation failed");
    }
    await restoreFiles(snapshots);
  };
  const install = spawn(["bun", "add", "--", ...dependencies], {
    cwd: root,
    stdout: quiet ? "ignore" : "inherit",
    stderr: quiet ? "ignore" : "inherit",
  });
  if ((await install.exited) !== 0) {
    await rollback();
    throw new Error("Registry dependency installation failed");
  }
  return rollback;
}
