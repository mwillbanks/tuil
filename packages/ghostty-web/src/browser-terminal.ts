const browserEnvironment = Object.freeze({
  CI: "",
  COLORTERM: "truecolor",
  TERM: "xterm-256color",
  TERM_PROGRAM: "ghostty",
  TUIL_MOUSE: "1",
});

const browserInput = Object.freeze({ isTTY: true });

export function browserTerminalProbe(width: number, height: number) {
  return {
    env: browserEnvironment,
    stdin: browserInput,
    stdout: {
      isTTY: true,
      columns: width,
      rows: height,
      getColorDepth: () => 24,
    },
    platform: "linux" as const,
  };
}
