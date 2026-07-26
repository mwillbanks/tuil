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
});
