import { BrowserEventEmitter } from "../emitter";

const signals = new BrowserEventEmitter();
const unavailableStream = new BrowserEventEmitter() as BrowserEventEmitter & {
  columns: number;
  rows: number;
  isTTY: boolean;
  write(data: unknown): boolean;
  read(): null;
};
unavailableStream.columns = 80;
unavailableStream.rows = 24;
unavailableStream.isTTY = false;
unavailableStream.write = () => false;
unavailableStream.read = () => null;

export const env: Record<string, string | undefined> = {
  CI: "",
  DEV: "false",
  TERM: "xterm-256color",
  TERM_PROGRAM: "ghostty",
};
export const platform = "browser";
export const stdin = unavailableStream;
export const stdout = unavailableStream;
export const stderr = unavailableStream;
export const cwd = () => "/";
export const nextTick = (
  callback: (...args: unknown[]) => void,
  ...args: unknown[]
) => queueMicrotask(() => callback(...args));
export const once = signals.once.bind(signals);
export const on = signals.on.bind(signals);
export const off = signals.off.bind(signals);
export const removeListener = signals.removeListener.bind(signals);
export const emit = signals.emit.bind(signals);

const processShim = {
  cwd,
  emit,
  env,
  nextTick,
  off,
  on,
  once,
  platform,
  removeListener,
  stderr,
  stdin,
  stdout,
};

export default processShim;
