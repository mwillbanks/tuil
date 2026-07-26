export type ColorDepth = 1 | 4 | 8 | 24;
export type RenderMode = "interactive" | "static" | "json" | "silent";

export interface TerminalCapabilities {
  readonly width: number;
  readonly height: number;
  readonly colorDepth: ColorDepth;
  readonly unicode: boolean;
  readonly hyperlinks: boolean;
  readonly interactive: boolean;
  readonly tty: boolean;
  readonly alternateScreen: boolean;
  readonly mouse: boolean;
  readonly images: boolean;
  readonly reducedMotion: boolean;
  readonly platform: NodeJS.Platform;
}

export interface TerminalCapabilityInput {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: Pick<NodeJS.ReadStream, "isTTY">;
  readonly stdout?: Pick<
    NodeJS.WriteStream,
    "isTTY" | "columns" | "rows" | "getColorDepth"
  >;
  readonly platform?: NodeJS.Platform;
}

function detectColorDepth(
  env: Readonly<Record<string, string | undefined>>,
  stdout: TerminalCapabilityInput["stdout"],
): ColorDepth {
  if (env["NO_COLOR"] !== undefined || env["TERM"] === "dumb") {
    return 1;
  }
  const detected = stdout?.getColorDepth?.();
  if (detected === 24 || detected === 8 || detected === 4 || detected === 1) {
    return detected;
  }
  if (env["COLORTERM"] === "truecolor" || env["COLORTERM"] === "24bit") {
    return 24;
  }
  if (env["TERM"]?.includes("256color")) {
    return 8;
  }
  return stdout?.isTTY ? 4 : 1;
}

export function detectTerminalCapabilities(
  input: TerminalCapabilityInput = {},
): TerminalCapabilities {
  const env = input.env ?? process.env;
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  const platform = input.platform ?? process.platform;
  const tty = Boolean(stdin.isTTY && stdout.isTTY);
  const term = env["TERM"] ?? "";
  const terminalProgram = env["TERM_PROGRAM"] ?? "";
  const unicode =
    env["TUIL_UNICODE"] === "0"
      ? false
      : platform !== "win32" ||
        Boolean(env["WT_SESSION"]) ||
        env["TERM"] === "xterm-256color";
  return Object.freeze({
    width: stdout.columns ?? 80,
    height: stdout.rows ?? 24,
    colorDepth: detectColorDepth(env, stdout),
    unicode,
    hyperlinks:
      tty &&
      (Boolean(env["FORCE_HYPERLINK"]) ||
        terminalProgram === "iTerm.app" ||
        terminalProgram === "WezTerm" ||
        Boolean(env["VTE_VERSION"])),
    interactive: tty,
    tty,
    alternateScreen: tty && term !== "dumb",
    mouse: tty && env["TUIL_MOUSE"] === "1",
    images:
      tty &&
      (terminalProgram === "iTerm.app" ||
        terminalProgram === "WezTerm" ||
        Boolean(env["KITTY_WINDOW_ID"])),
    reducedMotion: env["TUIL_REDUCED_MOTION"] === "1" || !tty,
    platform,
  });
}

export function resolveRenderMode(
  requested: RenderMode | undefined,
  capabilities: TerminalCapabilities,
): RenderMode {
  if (requested) {
    return requested;
  }
  return capabilities.interactive ? "interactive" : "static";
}
