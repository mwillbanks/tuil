import { useTestClock } from "../../../tests/helpers/clock.ts";
import { describe, expect, mock, test } from "bun:test";
import {
  HotkeyManager,
  normalizeHotkeyNotation,
  normalizeTerminalKey,
} from "./index.ts";

const clock = useTestClock();

describe("hotkeys", () => {
  test("normalizes terminal keys and cross-platform mod notation", () => {
    expect(normalizeTerminalKey("k", { ctrl: true }, "linux")).toBe("ctrl+k");
    expect(normalizeHotkeyNotation("mod+k", "darwin")).toBe("meta+k");
    expect(normalizeHotkeyNotation("mod+k", "linux")).toBe("ctrl+k");
  });

  test("dispatches sequences and resolves scope precedence", async () => {
    const manager = new HotkeyManager(100);
    const calls: string[] = [];
    manager.register({
      keys: "g g",
      scope: "application",
      handler: () => {
        calls.push("sequence");
      },
    });
    await manager.dispatch("g");
    await manager.dispatch("g");
    expect(calls).toEqual(["sequence"]);

    manager.register({
      keys: "ctrl+s",
      scope: "application",
      handler: () => {
        calls.push("app");
      },
    });
    manager.register({
      keys: "ctrl+s",
      scope: "dialog",
      scopeId: "confirm",
      handler: () => {
        calls.push("dialog");
      },
    });
    await manager.dispatch(
      "s",
      { ctrl: true },
      {
        activeScopes: { application: true, dialog: "confirm" },
      },
    );
    expect(calls.at(-1)).toBe("dialog");
    expect(manager.conflicts()).toHaveLength(1);
  });

  test("defers an exact chord when it prefixes a longer sequence", async () => {
    const manager = new HotkeyManager(10);
    const calls: string[] = [];
    manager.register({
      keys: "g",
      handler() {
        calls.push("single");
      },
    });
    manager.register({
      keys: "g g",
      handler() {
        calls.push("sequence");
      },
    });
    await manager.dispatch("g");
    expect(calls).toEqual([]);
    await manager.dispatch("g");
    expect(calls).toEqual(["sequence"]);

    await manager.dispatch("g");
    await clock.advance(15);
    expect(calls).toEqual(["sequence", "single"]);
  });

  test("revalidates deferred bindings and reports asynchronous failures", async () => {
    const manager = new HotkeyManager(10);
    const calls: string[] = [];
    let activeDialog: string | undefined = "confirm";
    const unregister = manager.register({
      keys: "g",
      scope: "dialog",
      scopeId: "confirm",
      handler() {
        calls.push("stale");
      },
    });
    manager.register({
      keys: "g g",
      scope: "dialog",
      scopeId: "confirm",
      handler() {
        calls.push("sequence");
      },
    });
    await manager.dispatch(
      "g",
      {},
      {
        activeScopes: () => ({ dialog: activeDialog }),
      },
    );
    activeDialog = undefined;
    await clock.advance(15);
    expect(calls).toEqual([]);

    activeDialog = "confirm";
    await manager.dispatch(
      "g",
      {},
      {
        activeScopes: () => ({ dialog: activeDialog }),
      },
    );
    unregister();
    await clock.advance(15);
    expect(calls).toEqual([]);

    const errors: unknown[] = [];
    const failing = new HotkeyManager(5);
    failing.register({
      keys: "x",
      async handler() {
        throw new Error("deferred failure");
      },
    });
    failing.register({
      keys: "x x",
      handler() {},
    });
    await failing.dispatch(
      "x",
      {},
      {
        onError(error) {
          errors.push(error);
        },
      },
    );
    await clock.advance(10);
    expect(errors).toHaveLength(1);
    expect(failing.drainErrors()).toEqual([]);
  });

  test("expires incomplete sequences and preserves deferred reporting failures", async () => {
    const manager = new HotkeyManager(5);
    const calls: string[] = [];
    const stopObserving = manager.observe(() => {
      calls.push("observed");
    });
    manager.register({
      keys: "g g",
      handler() {
        calls.push("sequence");
      },
    });
    await manager.dispatch("g");
    await clock.advance(10);
    expect(calls).toEqual([]);

    manager.register({
      keys: "x",
      async handler() {
        throw new Error("handler failed");
      },
    });
    manager.register({ keys: "x x", handler() {} });
    await manager.dispatch(
      "x",
      {},
      {
        onError() {
          throw new Error("reporter failed");
        },
      },
    );
    await clock.advance(10);
    expect(manager.drainErrors()[0]).toBeInstanceOf(AggregateError);
    stopObserving();
  });
});

test("maps terminal navigation keys and modifier order", () => {
  expect(normalizeTerminalKey("x", { backspace: true })).toBe("backspace");
  expect(normalizeTerminalKey("x", { delete: true })).toBe("delete");
  expect(normalizeTerminalKey("x", { upArrow: true })).toBe("arrowup");
  expect(normalizeTerminalKey("x", { downArrow: true })).toBe("arrowdown");
  expect(normalizeTerminalKey("x", { pageUp: true })).toBe("pageup");
  expect(normalizeTerminalKey("x", { pageDown: true })).toBe("pagedown");
  expect(normalizeTerminalKey("x", { home: true })).toBe("home");
  expect(normalizeTerminalKey("x", { end: true })).toBe("end");
  expect(normalizeTerminalKey("x", { meta: true, shift: true }, "darwin")).toBe(
    "meta+shift+x",
  );
  expect(normalizeTerminalKey("x", { meta: true }, "linux")).toBe("alt+x");
  expect(normalizeHotkeyNotation("k+shift+ctrl", "linux")).toBe("ctrl+shift+k");
});

test("replays an unmatched chord and exposes prevention to observers", async () => {
  const manager = new HotkeyManager();
  const observe = mock();
  manager.observe(observe);
  const record = mock();
  expect(() => manager.register({ keys: " ", handler: record })).toThrow(
    "cannot be empty",
  );
  manager.register({ keys: "g", handler: record });
  manager.register({ keys: "g g", handler: record });
  manager.register({
    keys: "x",
    handler(event) {
      event.preventDefault();
    },
  });
  manager.register({ keys: "m", platforms: ["darwin"], handler: record });
  manager.register({ keys: "n", enabled: false, handler: record });
  await manager.dispatch("g");
  expect((await manager.dispatch("x"))?.keys).toBe("x");
  expect(record).toHaveBeenCalledTimes(1);
  expect(observe).toHaveBeenLastCalledWith(
    expect.objectContaining({ keys: "x", defaultPrevented: true }),
  );
  expect(
    await manager.dispatch("m", {}, { platform: "linux" }),
  ).toBeUndefined();
  expect(await manager.dispatch("n")).toBeUndefined();
});

test("retains unreported deferred handler errors for the caller", async () => {
  const manager = new HotkeyManager(5);
  const failure = new Error("deferred");
  manager.register({
    keys: "q",
    handler() {
      throw failure;
    },
  });
  manager.register({ keys: "q q", handler() {} });
  await manager.dispatch("q");
  await clock.advance(5);
  expect(manager.drainErrors()).toEqual([failure]);
});
