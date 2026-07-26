import { describe, expect, test } from "bun:test";
import { createPlugin } from "@mwillbanks/tuil-plugin";
import {
  createApp,
  defineCommand,
  defineConfig,
  defineEvents,
  defineService,
  event,
} from "./index.ts";

describe("application runtime", () => {
  test("runs lifecycle, services, plugins, commands, and reverse disposal", async () => {
    const calls: string[] = [];
    const app = createApp({
      component: () => null,
      events: defineEvents({
        "project:created": event<{ name: string }>(),
      }),
      services: {
        logger: defineService({
          id: "logger",
          create() {
            calls.push("service:create");
            return { log: (value: string) => calls.push(value) };
          },
          dispose() {
            calls.push("service:dispose");
          },
        }),
      },
      plugins: [
        createPlugin({
          id: "test",
          version: "1.0.0",
          setup({ commands }) {
            calls.push("plugin:setup");
            const command = commands.register(
              defineCommand({
                id: "test.run",
                title: "Run test",
                hotkeys: ["ctrl+r"],
                execute: ({ services }) => {
                  services
                    .get<{ log(value: string): void }>("logger")
                    .log("command");
                },
              }),
            );
            return () => {
              command.dispose();
              calls.push("plugin:dispose");
            };
          },
        }),
      ],
      terminal: { mode: "silent" },
    });
    const lifecycle: string[] = [];
    app.events.observe((value) => lifecycle.push(value.type));
    await app.ready();
    await app.hotkeys.dispatch(
      "r",
      { ctrl: true },
      {
        activeScopes: { application: true },
      },
    );
    await app.events.emit("project:created", { name: "demo" });
    const extension = app.extensions["routes"]?.register({ id: "temporary" });
    expect(app.extensions["routes"]?.values()).toContainEqual({
      id: "temporary",
    });
    await extension?.dispose();
    expect(app.extensions["routes"]?.values()).toEqual([]);
    await app.stop();
    expect(app.lifecycle.state).toBe("disposed");
    expect(calls).toEqual([
      "service:create",
      "plugin:setup",
      "command",
      "plugin:dispose",
      "service:dispose",
    ]);
    expect(lifecycle).toContainAllValues([
      "app:configure",
      "app:initialize",
      "app:mount",
      "app:ready",
      "project:created",
      "app:stop",
      "app:dispose",
    ]);
  });

  test("freezes repository configuration", () => {
    const config = defineConfig({
      renderer: "ink",
      paths: { components: "components", utilities: "lib", hooks: "hooks" },
      registry: { sources: ["https://example.com"] },
      theme: { preset: "default-dark" },
      packageManager: "bun",
    });
    expect(Object.isFrozen(config)).toBeTrue();
  });

  test("exposes typed events and observable extension registries", async () => {
    type UiEvents = { "ui:save": { id: string } };
    const app = createApp<Record<string, never>, UiEvents>({
      component: () => null,
      events: defineEvents({ "ui:save": event<{ id: string }>() }),
      terminal: { mode: "silent" },
    });
    const received: string[] = [];
    app.events.on("ui:save", ({ payload }) => {
      received.push(payload.id);
    });
    let extensionChanges = 0;
    const stop = app.extensions.routes.observe(() => {
      extensionChanges += 1;
    });
    const contribution = app.extensions.routes.register({ id: "settings" });
    expect(app.extensions.routes.values()).toEqual([{ id: "settings" }]);
    const duplicate = app.extensions.routes.register(
      app.extensions.routes.values()[0],
    );
    expect(app.extensions.routes.values()).toHaveLength(2);
    await app.events.emit("ui:save", { id: "document" });
    contribution.dispose();
    expect(app.extensions.routes.values()).toEqual([{ id: "settings" }]);
    duplicate.dispose();
    stop();
    expect(received).toEqual(["document"]);
    expect(extensionChanges).toBe(4);
    expect(app.extensions.routes.values()).toEqual([]);
    await app.stop();
  });

  test("routes initialization failures through the error handler", async () => {
    const errors: string[] = [];
    const app = createApp({
      component: () => null,
      services: {
        broken: defineService({
          id: "broken",
          create() {
            throw new Error("broken service");
          },
        }),
      },
      errorHandler(error, { phase }) {
        errors.push(`${phase}:${(error as Error).message}`);
      },
    });
    await expect(app.initialize()).rejects.toThrow("broken service");
    expect(errors).toEqual(["initializing:broken service"]);
    expect(app.lifecycle.state).toBe("disposed");
  });

  test("disposes resources even when lifecycle listeners fail", async () => {
    const calls: string[] = [];
    const app = createApp({
      component: () => null,
      services: {
        resource: defineService({
          id: "resource",
          create: () => ({ active: true }),
          dispose() {
            calls.push("disposed");
          },
        }),
      },
    });
    app.events.on("app:stop", () => {
      throw new Error("stop listener failed");
    });
    await app.ready();
    await expect(app.stop()).rejects.toThrow("Application disposal failed");
    expect(calls).toEqual(["disposed"]);
    expect(app.lifecycle.state).toBe("disposed");
  });
});
