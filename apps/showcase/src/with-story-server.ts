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
  readonly off: (signal: "SIGINT" | "SIGTERM", listener: () => void) => unknown;
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

  const port = Number(process.env["TUIL_STORY_PORT"] ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("TUIL_STORY_PORT must be a valid TCP port");
  }
  const origin = `http://127.0.0.1:${port}`;
  const bridgeEnvironment = {
    ...process.env,
    FORCE_COLOR: "3",
    TUIL_STORY_PORT: String(port),
  };
  const bridge = runtime.spawn(["bun", "story-server.ts"], {
    cwd: import.meta.dir,
    stdout: "inherit",
    stderr: "inherit",
    env: bridgeEnvironment,
  });
  let application: StorySurfaceProcess | undefined;
  const stop = () => {
    if (application?.exitCode === null) application.kill();
    if (bridge.exitCode === null) bridge.kill();
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (bridge.exitCode !== null) {
        throw new Error("Story bridge exited before becoming ready");
      }
      try {
        const response = await runtime.fetch(`${origin}/health`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await runtime.sleep(25);
    }
    if (!ready) throw new Error("Story bridge did not become ready");

    application = runtime.spawn(selected.command, {
      cwd: selected.cwd,
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        TUIL_STORY_ENDPOINT: `${origin}/api/tuil-story`,
        TUIL_STORY_PORT: String(port),
      },
    });
    runtime.once("SIGINT", stop);
    runtime.once("SIGTERM", stop);
    return await application.exited;
  } finally {
    runtime.off("SIGINT", stop);
    runtime.off("SIGTERM", stop);
    stop();
    await Promise.allSettled([
      bridge.exited,
      ...(application ? [application.exited] : []),
    ]);
  }
}

const host: StorySurfaceRuntime = {
  spawn: Bun.spawn as unknown as StorySurfaceRuntime["spawn"],
  fetch,
  sleep: Bun.sleep,
  once: process.once.bind(process),
  off: process.off.bind(process),
};
const surface = process.argv[2];
const surfaceExit = import.meta.main
  ? await runStorySurface(surface, host)
  : undefined;
process.exitCode = surfaceExit ?? process.exitCode;
