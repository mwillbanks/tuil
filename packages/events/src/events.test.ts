import { describe, expect, test } from "bun:test";
import { defineEvents, EventBus, event } from "./index.ts";

type TestEvents = {
  "project:create": { name: string };
  "auth:token": { token: string };
};

describe("event bus", () => {
  test("dispatches capture, target, and bubble in order", async () => {
    const bus = new EventBus<TestEvents>(
      defineEvents({
        "project:create": event<{ name: string }>(),
        "auth:token": event<{ token: string }>(),
      }),
    );
    const calls: string[] = [];
    bus.on(
      "project:create",
      (value) => {
        calls.push(`${value.phase}:root`);
      },
      {
        phase: "capture",
        target: "root",
      },
    );
    bus.on(
      "project:create",
      (value) => {
        calls.push(`${value.phase}:button`);
      },
      {
        phase: "target",
        target: "button",
      },
    );
    bus.on(
      "project:create",
      (value) => {
        calls.push(`${value.phase}:root`);
      },
      {
        phase: "bubble",
        target: "root",
      },
    );
    await bus.emit(
      "project:create",
      { name: "demo" },
      { path: ["root", "button"] },
    );
    expect(calls).toEqual(["capture:root", "target:button", "bubble:root"]);
  });

  test("supports prevention, propagation stops, priority, and redaction", async () => {
    const bus = new EventBus<TestEvents>(
      defineEvents({
        "project:create": event<{ name: string }>(),
        "auth:token": event<{ token: string }>({
          redact: () => "[REDACTED]",
        }),
      }),
    );
    const calls: string[] = [];
    bus.on(
      "project:create",
      (value) => {
        calls.push("high");
        value.preventDefault();
        value.stopPropagation();
      },
      { priority: 10 },
    );
    bus.on("project:create", () => {
      calls.push("low");
    });
    const emitted = await bus.emit("project:create", { name: "demo" });
    expect(emitted.defaultPrevented).toBeTrue();
    expect(calls).toEqual(["high"]);
    let observed: unknown;
    bus.observe((value) => {
      observed = value.payload;
    });
    await bus.emit("auth:token", { token: "secret" });
    expect(observed).toBe("[REDACTED]");
  });

  test("retains a bounded observable history and clears it on disposal", async () => {
    const bus = new EventBus<TestEvents>(
      defineEvents({
        "project:create": event<{ name: string }>(),
        "auth:token": event<{ token: string }>(),
      }),
    );
    for (let index = 0; index < 201; index += 1) {
      await bus.emit("project:create", { name: `project-${index}` });
    }
    const history = bus.history();
    expect(history).toHaveLength(200);
    expect(history[0]?.payload).toEqual({ name: "project-1" });
    expect(history.at(-1)?.payload).toEqual({ name: "project-200" });
    bus.dispose();
    expect(bus.history()).toEqual([]);
  });

  test("manages dynamic declarations, cancellable listeners, and observers", async () => {
    const bus = new EventBus<TestEvents>();
    const unregister = bus.register(
      "project:create",
      event<{ name: string }>(),
    );
    expect(() =>
      bus.register("project:create", event<{ name: string }>()),
    ).toThrow("already declared");

    const calls: string[] = [];
    const controller = new AbortController();
    bus.on(
      "project:create",
      () => {
        calls.push("aborted");
      },
      { signal: controller.signal },
    );
    controller.abort();
    const stopListening = bus.on("project:create", () => {
      calls.push("active");
    });
    let observed = 0;
    const stopObserving = bus.observe(() => {
      observed += 1;
    });

    await bus.emit(
      "project:create",
      { name: "background" },
      { priority: "background" },
    );
    expect(calls).toEqual(["active"]);
    expect(observed).toBe(1);

    stopListening();
    stopObserving();
    await bus.emit("project:create", { name: "silent" });
    expect(calls).toEqual(["active"]);
    expect(observed).toBe(1);

    unregister();
    await expect(
      bus.emit("project:create", { name: "undeclared" }),
    ).rejects.toThrow("has not been declared");
    bus.dispose();
    expect(() =>
      bus.register("project:create", event<{ name: string }>()),
    ).toThrow("disposed");
  });

  test("keeps declaration disposers idempotent and identity safe", async () => {
    const bus = new EventBus<TestEvents>();
    const first = bus.register("project:create", event<{ name: string }>());
    first();
    const second = bus.register("project:create", event<{ name: string }>());
    first();
    await expect(
      bus.emit("project:create", { name: "still-declared" }),
    ).resolves.toMatchObject({ payload: { name: "still-declared" } });
    second();
    second();
    await expect(
      bus.emit("project:create", { name: "removed" }),
    ).rejects.toThrow("has not been declared");
  });

  test("removes abort listeners when subscriptions are manually disposed", () => {
    const bus = new EventBus<TestEvents>(
      defineEvents({
        "project:create": event<{ name: string }>(),
        "auth:token": event<{ token: string }>(),
      }),
    );
    const controller = new AbortController();
    let additions = 0;
    let removals = 0;
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(
      controller.signal,
    );
    controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
      additions += 1;
      return add(...args);
    }) as typeof controller.signal.addEventListener;
    controller.signal.removeEventListener = ((
      ...args: Parameters<typeof remove>
    ) => {
      removals += 1;
      return remove(...args);
    }) as typeof controller.signal.removeEventListener;
    const dispose = bus.on("project:create", () => {}, {
      signal: controller.signal,
    });
    dispose();
    dispose();
    expect(additions).toBe(1);
    expect(removals).toBe(1);

    const anotherController = new AbortController();
    let disposalRemovals = 0;
    const anotherRemove = anotherController.signal.removeEventListener.bind(
      anotherController.signal,
    );
    anotherController.signal.removeEventListener = ((
      ...args: Parameters<typeof anotherRemove>
    ) => {
      disposalRemovals += 1;
      return anotherRemove(...args);
    }) as typeof anotherController.signal.removeEventListener;
    bus.on("project:create", () => {}, {
      signal: anotherController.signal,
    });
    bus.dispose();
    expect(disposalRemovals).toBe(1);
  });
});
