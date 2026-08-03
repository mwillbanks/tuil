interface ConsoleWriter {
  write(data: string): unknown;
}

function format(arguments_: readonly unknown[]): string {
  return `${arguments_
    .map((value) =>
      typeof value === "string"
        ? value
        : value instanceof Error
          ? (value.stack ?? value.message)
          : JSON.stringify(value),
    )
    .join(" ")}\n`;
}

export class BrowserConsole {
  readonly #stdout: ConsoleWriter;
  readonly #stderr: ConsoleWriter;

  constructor(stdout: ConsoleWriter, stderr = stdout) {
    this.#stdout = stdout;
    this.#stderr = stderr;
  }

  log = (...arguments_: unknown[]) => this.#stdout.write(format(arguments_));
  info = this.log;
  debug = this.log;
  dir = this.log;
  dirxml = this.log;
  table = this.log;
  count = this.log;
  countReset = this.log;
  time = this.log;
  timeEnd = this.log;
  timeLog = this.log;
  group = this.log;
  groupCollapsed = this.log;
  groupEnd = () => undefined;
  warn = (...arguments_: unknown[]) => this.#stderr.write(format(arguments_));
  error = this.warn;
  trace = this.warn;
  assert = (condition?: boolean, ...arguments_: unknown[]) => {
    if (!condition)
      this.#stderr.write(format(["Assertion failed:", ...arguments_]));
  };
}
