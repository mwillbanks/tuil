import { describe, expect, test } from "bun:test";
import {
  CommandRegistry,
  DisposableStack,
  defineCommand,
  defineService,
  detectTerminalCapabilities,
  resolveRenderMode,
  ServiceContainer,
  toDisposable,
} from "./index.ts";

test("disposable stacks release resources once in reverse order", async () => {
  const events: string[] = [];
  const stack = new DisposableStack();
  const resource = stack.use(
    toDisposable(() => {
      events.push("resource");
    }),
  );
  expect(resource.dispose).toBeFunction();
  stack.defer(async () => {
    await Promise.resolve();
    events.push("deferred");
  });
  expect(stack.disposed).toBeFalse();
  await stack.dispose();
  await stack.dispose();
  expect(stack.disposed).toBeTrue();
  expect(events).toEqual(["deferred", "resource"]);
  expect(() => stack.defer(() => undefined)).toThrow("disposed stack");
  expect(() => stack.use(toDisposable(() => undefined))).toThrow(
    "disposed stack",
  );
});

test("disposable stacks aggregate teardown failures", async () => {
  const stack = new DisposableStack();
  stack.defer(() => {
    throw new Error("first");
  });
  stack.defer(() => {
    throw new Error("second");
  });
  await expect(stack.dispose()).rejects.toBeInstanceOf(AggregateError);
});

describe("service container", () => {
  test("initializes and disposes services in reverse order", async () => {
    const events: string[] = [];
    const services = new ServiceContainer();
    services.register(
      defineService({
        id: "first",
        create() {
          events.push("create:first");
          return { name: "first" };
        },
        dispose() {
          events.push("dispose:first");
        },
      }),
    );
    services.register(
      defineService({
        id: "second",
        async create({ services }) {
          expect(services.get<{ name: string }>("first").name).toBe("first");
          events.push("create:second");
          return { name: "second" };
        },
        dispose() {
          events.push("dispose:second");
        },
      }),
    );

    await services.initialize();
    expect(services.get<{ name: string }>("second").name).toBe("second");
    await services.dispose();
    expect(events).toEqual([
      "create:first",
      "create:second",
      "dispose:second",
      "dispose:first",
    ]);
  });

  test("rejects duplicate and circular registrations", async () => {
    const services = new ServiceContainer();
    services.register("value", 1);
    expect(() => services.register("value", 2)).toThrow("already registered");
    const circular = new ServiceContainer();
    circular.register(
      defineService({
        id: "left",
        create: ({ services }) => services.resolve("right"),
      }),
    );
    circular.register(
      defineService({
        id: "right",
        create: ({ services }) => services.resolve("left"),
      }),
    );
    await expect(circular.initialize()).rejects.toThrow("Circular");
  });
});

describe("commands", () => {
  test("executes enabled commands and records outcomes", async () => {
    const services = new ServiceContainer();
    services.register("allowed", true);
    const registry = new CommandRegistry(services);
    const executions: string[] = [];
    registry.observe((execution) => executions.push(execution.status));
    registry.register(
      defineCommand({
        id: "project.create",
        title: "Create project",
        enabled: ({ services }) => services.get("allowed"),
        execute: () => "created",
      }),
    );
    await expect(registry.execute("project.create")).resolves.toBe("created");
    expect(executions).toEqual(["succeeded"]);
  });

  test("honors disabled and aborted commands", async () => {
    const registry = new CommandRegistry(new ServiceContainer());
    registry.register(
      defineCommand({
        id: "disabled",
        title: "Disabled",
        enabled: () => false,
        execute: () => {
          throw new Error("must not run");
        },
      }),
    );
    expect(await registry.execute("disabled")).toBeUndefined();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      registry.execute("disabled", { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });
});

test("terminal detection degrades non-TTY output", () => {
  const capabilities = detectTerminalCapabilities({
    env: { TERM: "dumb", NO_COLOR: "1" },
    stdin: { isTTY: false },
    stdout: {
      isTTY: false,
      columns: 120,
      rows: 40,
      getColorDepth: () => 1,
    },
    platform: "linux",
  });
  expect(capabilities).toMatchObject({
    width: 120,
    height: 40,
    colorDepth: 1,
    interactive: false,
  });
  expect(resolveRenderMode(undefined, capabilities)).toBe("static");
});
