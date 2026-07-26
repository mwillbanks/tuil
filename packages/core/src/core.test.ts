import { describe, expect, test } from "bun:test";
import {
  CommandRegistry,
  DisposableStack,
  defineCommand,
  defineService,
  deleteOnDispose,
  detectTerminalCapabilities,
  Lifecycle,
  resolveRenderMode,
  resolveTerminalViewport,
  ServiceContainer,
  terminalViewportBreakpoints,
  toDisposable,
} from "./index.ts";

test("disposable stacks release resources once in reverse order", async () => {
  const events: string[] = [];
  const values = new Set(["active"]);
  deleteOnDispose(values, "active", () => events.push("deleted"))();
  expect(values.size).toBe(0);
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
  expect(events).toEqual(["deleted", "deferred", "resource"]);
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
    expect(services.entries().map(([id]) => id)).toEqual(["first", "second"]);
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

  test("unregisters values and preserves failed initialization errors", async () => {
    const services = new ServiceContainer();
    const valueRegistration = services.register("value", 1);
    expect(services.has("value")).toBeTrue();
    await valueRegistration.dispose();
    expect(services.has("value")).toBeFalse();

    const failure = new Error("service failed");
    services.register(
      defineService({
        id: "failure",
        create() {
          throw failure;
        },
      }),
    );
    await expect(services.resolve("failure")).rejects.toBe(failure);
    expect(() => services.get("failure")).toThrow(failure);
    await expect(services.resolve("failure")).rejects.toBe(failure);
    await services.dispose();
    expect(() => services.get("failure")).toThrow("disposed");
    expect(() => services.register("late", true)).toThrow("disposed");
  });

  test("does not unregister a service while its factory is active", async () => {
    const services = new ServiceContainer();
    let release: (() => void) | undefined;
    const registration = services.register(
      defineService({
        id: "slow",
        create: () =>
          new Promise<string>((resolve) => {
            release = () => resolve("ready");
          }),
      }),
    );
    const resolving = services.resolve("slow");
    await Bun.sleep(0);
    expect(() => registration.dispose()).toThrow("while it initializes");
    release?.();
    expect(await resolving).toBe("ready");
    await registration.dispose();
    expect(services.has("slow")).toBeFalse();
  });
});

describe("commands", () => {
  test("executes enabled commands and records outcomes", async () => {
    const services = new ServiceContainer();
    services.register("allowed", true);
    const registry = new CommandRegistry(services);
    const executions: string[] = [];
    const registryChanges: string[] = [];
    const executionObserver = registry.observe((execution) =>
      executions.push(execution.status),
    );
    const registryObserver = registry.observeRegistry((change) =>
      registryChanges.push(change.type),
    );
    const registration = registry.register(
      defineCommand({
        id: "project.create",
        title: "Create project",
        enabled: ({ services }) => services.get("allowed"),
        execute: () => "created",
      }),
    );
    await expect(registry.execute("project.create")).resolves.toBe("created");
    expect(executions).toEqual(["succeeded"]);
    expect(registry.get("project.create")?.title).toBe("Create project");
    await registration.dispose();
    expect(registryChanges).toEqual(["registered", "unregistered"]);
    await executionObserver.dispose();
    await registryObserver.dispose();
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

    const registration = registry.register(
      defineCommand({
        id: "temporary",
        title: "Temporary",
        execute: () => undefined,
      }),
    );
    await registration.dispose();
    expect(registry.list()).toHaveLength(1);
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

test("terminal viewport policy uses shared compact and wide breakpoints", () => {
  expect(resolveTerminalViewport(0)).toBe("compact");
  expect(resolveTerminalViewport(terminalViewportBreakpoints.regular - 1)).toBe(
    "compact",
  );
  expect(resolveTerminalViewport(terminalViewportBreakpoints.regular)).toBe(
    "regular",
  );
  expect(resolveTerminalViewport(terminalViewportBreakpoints.wide - 1)).toBe(
    "regular",
  );
  expect(resolveTerminalViewport(terminalViewportBreakpoints.wide)).toBe(
    "wide",
  );
});

test("lifecycle observers and terminal capabilities cover interactive variants", () => {
  const lifecycle = new Lifecycle();
  const transitions: string[] = [];
  const stopObserving = lifecycle.observe((state, previous) =>
    transitions.push(`${previous}:${state}`),
  );
  lifecycle.transition("configuring");
  stopObserving();
  lifecycle.transition("initializing");
  expect(transitions).toEqual(["created:configuring"]);
  expect(() => lifecycle.transition("ready")).toThrow("Invalid lifecycle");

  const capabilities = detectTerminalCapabilities({
    env: {
      COLORTERM: "truecolor",
      FORCE_HYPERLINK: "1",
      KITTY_WINDOW_ID: "1",
      TERM: "xterm-256color",
      TUIL_MOUSE: "1",
      TUIL_REDUCED_MOTION: "1",
      TUIL_UNICODE: "0",
    },
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      columns: 100,
      rows: 30,
      getColorDepth: () => 24,
    },
    platform: "darwin",
  });
  expect(capabilities).toMatchObject({
    alternateScreen: true,
    colorDepth: 24,
    hyperlinks: true,
    images: true,
    interactive: true,
    mouse: true,
    reducedMotion: true,
    unicode: false,
  });
  expect(resolveRenderMode("json", capabilities)).toBe("json");

  const stdout = {
    isTTY: true,
    columns: 80,
    rows: 24,
    getColorDepth: () => 2,
  };
  expect(
    detectTerminalCapabilities({
      env: { COLORTERM: "24bit" },
      stdin: { isTTY: true },
      stdout,
      platform: "linux",
    }).colorDepth,
  ).toBe(24);
  expect(
    detectTerminalCapabilities({
      env: { TERM: "screen-256color" },
      stdin: { isTTY: true },
      stdout,
      platform: "linux",
    }).colorDepth,
  ).toBe(8);
  expect(
    detectTerminalCapabilities({
      env: {},
      stdin: { isTTY: true },
      stdout,
      platform: "linux",
    }).colorDepth,
  ).toBe(4);
});
