import { expect, test } from "bun:test";
import {
  type InitializerSpawn,
  runInitializerProcess,
  runInitializerSetup,
} from "./initializer-process.ts";

test("initializer subprocesses honor output policy and report failures", async () => {
  const calls: Array<{
    command: readonly string[];
    stdout: "ignore" | "inherit";
  }> = [];
  const successful: InitializerSpawn = (command, options) => {
    calls.push({ command, stdout: options.stdout });
    return { exited: Promise.resolve(0) };
  };
  await runInitializerProcess(["bun", "install"], {
    cwd: "/tmp/project",
    quiet: true,
    failureMessage: "install failed",
    spawn: successful,
  });
  await runInitializerProcess(["git", "init"], {
    cwd: "/tmp/project",
    quiet: false,
    failureMessage: "git failed",
    spawn: successful,
  });
  expect(calls).toEqual([
    { command: ["bun", "install"], stdout: "ignore" },
    { command: ["git", "init"], stdout: "inherit" },
  ]);

  await expect(
    runInitializerProcess(["bun", "run", "typecheck"], {
      cwd: "/tmp/project",
      quiet: true,
      failureMessage: "validation failed",
      spawn: () => ({ exited: Promise.resolve(1) }),
    }),
  ).rejects.toThrow("validation failed");

  calls.length = 0;
  await runInitializerSetup({
    cwd: "/tmp/project",
    quiet: true,
    install: true,
    git: true,
    spawn: successful,
  });
  expect(calls.map((call) => call.command)).toEqual([
    ["bun", "install"],
    ["bun", "run", "typecheck"],
    ["git", "init"],
  ]);
  calls.length = 0;
  await runInitializerSetup({
    cwd: "/tmp/project",
    quiet: false,
    install: false,
    git: false,
    spawn: successful,
  });
  expect(calls).toEqual([]);
});
