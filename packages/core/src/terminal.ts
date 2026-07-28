export type ColorDepth = 1 | 4 | 8 | 24;
export type RenderMode = "interactive" | "static" | "json" | "silent";
export type TerminalViewport = "compact" | "regular" | "wide";
export type TerminalPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "netbsd"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin";

export interface TerminalInputProbe {
  readonly isTTY?: boolean;
}

export interface TerminalOutputProbe {
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
  getColorDepth?(): number;
}

export const terminalViewportBreakpoints = Object.freeze({
  regular: 60,
  wide: 120,
});

export function resolveTerminalViewport(width: number): TerminalViewport {
  if (width < terminalViewportBreakpoints.regular) return "compact";
  if (width < terminalViewportBreakpoints.wide) return "regular";
  return "wide";
}

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
  readonly platform: TerminalPlatform;
  readonly bracketedPaste?: boolean;
  readonly clipboard?: "osc52" | "platform" | "none";
  readonly focusReporting?: boolean;
  readonly kittyKeyboard?: boolean;
  readonly notifications?: boolean;
}

export interface TerminalCapabilityInput {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: TerminalInputProbe;
  readonly stdout?: TerminalOutputProbe;
  readonly platform?: TerminalPlatform;
}

type TerminalEnvironment = Readonly<Record<string, string | undefined>>;

function detectColorDepth(
  env: TerminalEnvironment,
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

function supportsUnicode(
  env: TerminalEnvironment,
  platform: TerminalPlatform,
): boolean {
  if (env["TUIL_UNICODE"] === "0") return false;
  return (
    platform !== "win32" ||
    Boolean(env["WT_SESSION"]) ||
    env["TERM"] === "xterm-256color"
  );
}

function supportsHyperlinks(
  env: TerminalEnvironment,
  terminalProgram: string,
  tty: boolean,
): boolean {
  return (
    tty &&
    (Boolean(env["FORCE_HYPERLINK"]) ||
      terminalProgram === "iTerm.app" ||
      terminalProgram === "WezTerm" ||
      Boolean(env["VTE_VERSION"]))
  );
}

function supportsImages(
  env: TerminalEnvironment,
  terminalProgram: string,
  tty: boolean,
): boolean {
  return (
    tty &&
    (terminalProgram === "iTerm.app" ||
      terminalProgram === "WezTerm" ||
      Boolean(env["KITTY_WINDOW_ID"]))
  );
}

function supportsKittyKeyboard(
  env: TerminalEnvironment,
  terminalProgram: string,
  tty: boolean,
): boolean {
  return (
    tty &&
    (Boolean(env["KITTY_WINDOW_ID"]) ||
      terminalProgram === "WezTerm" ||
      env["TERM"] === "xterm-kitty")
  );
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
  const advancedInput = tty && term !== "dumb";
  return Object.freeze({
    width: stdout.columns ?? 80,
    height: stdout.rows ?? 24,
    colorDepth: detectColorDepth(env, stdout),
    unicode: supportsUnicode(env, platform),
    hyperlinks: supportsHyperlinks(env, terminalProgram, tty),
    interactive: tty,
    tty,
    alternateScreen: advancedInput,
    mouse: tty && env["TUIL_MOUSE"] === "1",
    images: supportsImages(env, terminalProgram, tty),
    reducedMotion: env["TUIL_REDUCED_MOTION"] === "1" || !tty,
    platform,
    bracketedPaste: advancedInput,
    clipboard: tty ? "osc52" : "platform",
    focusReporting: advancedInput,
    kittyKeyboard: supportsKittyKeyboard(env, terminalProgram, tty),
    notifications: advancedInput,
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
