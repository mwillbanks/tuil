import { describe, expect, test } from "bun:test";
import {
  HotkeyManager,
  normalizeHotkeyNotation,
  normalizeTerminalKey,
} from "./index.ts";

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
    await Bun.sleep(15);
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
    await Bun.sleep(15);
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
    await Bun.sleep(15);
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
    await Bun.sleep(10);
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
    await Bun.sleep(10);
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
    await Bun.sleep(10);
    expect(manager.drainErrors()[0]).toBeInstanceOf(AggregateError);
    stopObserving();
  });
});
