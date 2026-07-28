export interface InitializerProcess {
  readonly exited: Promise<number>;
}

export type InitializerSpawn = (
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly stdout: "ignore" | "inherit";
    readonly stderr: "ignore" | "inherit";
  },
) => InitializerProcess;

export interface InitializerProcessOptions {
  readonly cwd: string;
  readonly quiet: boolean;
  readonly failureMessage: string;
  readonly spawn?: InitializerSpawn;
}

export interface InitializerSetupOptions {
  readonly cwd: string;
  readonly quiet: boolean;
  readonly install: boolean;
  readonly git: boolean;
  readonly spawn?: InitializerSpawn;
}

const defaultInitializerSpawn: InitializerSpawn = (command, options) =>
  Bun.spawn([...command], options);

export async function runInitializerProcess(
  command: readonly string[],
  options: InitializerProcessOptions,
): Promise<void> {
  const output = options.quiet ? "ignore" : "inherit";
  const process = (options.spawn ?? defaultInitializerSpawn)(command, {
    cwd: options.cwd,
    stdout: output,
    stderr: output,
  });
  if ((await process.exited) !== 0) {
    throw new Error(options.failureMessage);
  }
}

export async function runInitializerSetup(
  options: InitializerSetupOptions,
): Promise<void> {
  if (options.install) {
    await runInitializerProcess(["bun", "install"], {
      ...options,
      failureMessage: "Dependency installation failed",
    });
    await runInitializerProcess(["bun", "run", "typecheck"], {
      ...options,
      failureMessage: "Generated project validation failed",
    });
  }
  if (options.git) {
    await runInitializerProcess(["git", "init"], {
      ...options,
      failureMessage: "Git initialization failed",
    });
  }
}
