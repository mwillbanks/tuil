export interface StorySurfaceProcess {
  readonly exitCode: number | null;
  readonly exited: Promise<number>;
  kill(): void;
}

export interface StorySurfaceRuntime {
  readonly spawn: (
    command: readonly string[],
    options: {
      readonly cwd: string;
      readonly stdout: "inherit";
      readonly stderr: "inherit";
      readonly env?: Readonly<Record<string, string | undefined>>;
    },
  ) => StorySurfaceProcess;
  readonly fetch: typeof fetch;
  readonly sleep: (milliseconds: number) => Promise<unknown>;
  readonly once: (
    signal: "SIGINT" | "SIGTERM",
    listener: () => void,
  ) => unknown;
}

const showcaseRoot = new URL("..", import.meta.url).pathname;
const commands = {
  storybook: {
    cwd: showcaseRoot,
    command: ["storybook", "dev", "--no-open", "--port", "6006"],
  },
  docs: {
    cwd: new URL("../../docs", import.meta.url).pathname,
    command: ["next", "dev"],
  },
} as const;

export async function runStorySurface(
  surface: string | undefined,
  runtime: StorySurfaceRuntime,
): Promise<number> {
  const selected =
    surface === "storybook" || surface === "docs"
      ? commands[surface]
      : undefined;
  if (!selected) {
    throw new Error("Expected development surface: storybook or docs");
  }

  const bridge = runtime.spawn(["bun", "story-server.ts"], {
    cwd: import.meta.dir,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, FORCE_COLOR: "3" },
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (bridge.exitCode !== null) {
      throw new Error("Story bridge exited before becoming ready");
    }
    try {
      const response = await runtime.fetch("http://127.0.0.1:4317/health");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await runtime.sleep(25);
    }
  }
  if (!ready) {
    bridge.kill();
    throw new Error("Story bridge did not become ready");
  }

  const application = runtime.spawn(selected.command, {
    cwd: selected.cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const stop = () => {
    application.kill();
    bridge.kill();
  };
  runtime.once("SIGINT", stop);
  runtime.once("SIGTERM", stop);
  const exitCode = await application.exited;
  bridge.kill();
  await bridge.exited;
  return exitCode;
}

const host: StorySurfaceRuntime = {
  spawn: Bun.spawn as unknown as StorySurfaceRuntime["spawn"],
  fetch,
  sleep: Bun.sleep,
  once: process.once.bind(process),
};
const surface = process.argv[2];
const surfaceExit = import.meta.main
  ? await runStorySurface(surface, host)
  : undefined;
process.exitCode = surfaceExit ?? process.exitCode;
