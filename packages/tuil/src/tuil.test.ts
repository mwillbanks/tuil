import { describe, expect, test } from "bun:test";
import type {
  EditorProviderOptions,
  EditorSession,
} from "@mwillbanks/tuil-editor";
import { TextBufferSession } from "@mwillbanks/tuil-editor/buffer";
import { createPlugin } from "@mwillbanks/tuil-plugin";
import type { RendererBackend } from "@mwillbanks/tuil-renderer";
import type { PartialDocument } from "@mwillbanks/tuil-streaming";
import { defaultTheme } from "@mwillbanks/tuil-theme";
import {
  createApp,
  defineCommand,
  defineConfig,
  defineEvents,
  defineService,
  event,
} from "./index.ts";

describe("application runtime", () => {
  test("terminal output ownership is explicit and defaults by render mode", () => {
    expect(
      createApp({
        component: () => null,
        terminal: { mode: "static" },
      }).outputOwnership,
    ).toBe("inline");
    expect(
      createApp({
        component: () => null,
        terminal: { mode: "interactive", ownership: "split-footer" },
      }).outputOwnership,
    ).toBe("split-footer");
  });

  test("theme contribution removal recomputes from base without leaked overrides", async () => {
    const app = createApp({
      component: () => null,
      theme: defaultTheme,
      terminal: { mode: "silent" },
    });
    const first = app.extensions.themes.register((theme) => ({
      ...theme,
      spacing: { ...theme.spacing, sm: 7 },
    }));
    const second = app.extensions.themes.register((theme) => ({
      ...theme,
      spacing: { ...theme.spacing, md: 9 },
    }));
    expect(app.theme.spacing).toMatchObject({ sm: 7, md: 9 });
    second.dispose();
    expect(app.theme.spacing.sm).toBe(7);
    expect(app.theme.spacing.md).toBe(defaultTheme.spacing.md);
    first.dispose();
    expect(app.theme.spacing).toEqual(defaultTheme.spacing);
    await app.stop();
  });

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

  test("executes editor commands contributed by plugins", async () => {
    const app = createApp({
      component: () => null,
      plugins: [
        createPlugin({
          id: "editor-command",
          version: "1.0.0",
          setup({ editorCommands }) {
            return editorCommands.register({
              id: "insert-ready",
              title: "Insert ready",
              execute(session: EditorSession) {
                session.dispatch({
                  changes: [
                    {
                      range: {
                        anchor: { line: 0, column: 0 },
                        head: { line: 0, column: 0 },
                      },
                      insert: "ready",
                    },
                  ],
                  annotations: { origin: "plugin" },
                });
                return true;
              },
            });
          },
        }),
      ],
      terminal: { mode: "silent" },
    });
    await app.ready();
    const session = app.createEditorSession();
    expect(await app.executeEditorCommand(session, "insert-ready")).toBeTrue();
    expect(session.snapshot().document.text).toBe("ready");
    session.dispose();
    await app.stop();
  });

  test("tracks runtime-created editor and log resources through disposal", async () => {
    const app = createApp({
      component: () => null,
      terminal: { mode: "silent" },
    });
    const firstEditor = app.createEditorSession({ value: "first" });
    const secondEditor = app.createEditorSession({ value: "second" });
    const logs = app.createLogPipeline();
    logs.ingest("runtime log");

    expect(app.editorSessions.entries().map(({ id }) => id)).toEqual([
      "editor-session-1",
      "editor-session-2",
    ]);
    expect(app.logPipelines.entries()[0]?.value).toBe(logs);

    firstEditor.dispose();
    firstEditor.dispose();
    expect(app.editorSessions.values()).toEqual([secondEditor]);

    await app.stop();
    expect(app.editorSessions.values()).toEqual([]);
    expect(app.logPipelines.values()).toEqual([]);
    expect(app.streamingPipelines.values()).toEqual([]);
  });

  test("configures runtime-owned log and streaming pipeline factories", async () => {
    const app = createApp({
      component: () => null,
      terminal: { mode: "silent" },
    });
    const logs = app.createLogPipeline({ capacity: 1 });
    logs.ingest("first");
    logs.ingest("second");
    expect(logs.buffer.records().map((record) => record.body)).toEqual([
      "second",
    ]);
    expect(app.logPipelines.values()).toEqual([logs]);

    const streaming = app.createStreamingPipeline({
      format: "json",
      transformers: [
        {
          id: "runtime-transformer",
          transform(document) {
            return {
              ...document,
              root: {
                ...document.root,
                attributes: {
                  ...document.root.attributes,
                  runtimeTransformer: true,
                },
              },
            };
          },
        },
      ],
    });
    expect(app.streamingPipelines.values()).toEqual([streaming]);
    await streaming.write('{"ready":true}');
    const transformed = await streaming.end();
    expect(transformed.root.attributes?.["runtimeTransformer"]).toBeTrue();
    app.releaseStreamingPipeline(streaming);
    app.releaseLogPipeline(logs);
    expect(app.streamingPipelines.values()).toEqual([]);
    expect(app.logPipelines.values()).toEqual([]);
    await app.stop();
  });

  test("isolates resource observer failures from registry mutations", async () => {
    const app = createApp({
      component: () => null,
      terminal: { mode: "silent" },
    });
    let healthyNotifications = 0;
    const stopFailingObserver = app.editorSessions.observe(() => {
      throw new Error("observer failed");
    });
    const stopHealthyObserver = app.editorSessions.observe(() => {
      healthyNotifications += 1;
    });

    const session = app.createEditorSession({ value: "tracked" });
    expect(app.editorSessions.values()).toEqual([session]);
    expect(healthyNotifications).toBe(1);

    session.dispose();
    expect(app.editorSessions.values()).toEqual([]);
    expect(healthyNotifications).toBe(2);

    stopFailingObserver();
    stopHealthyObserver();
    await app.stop();
  });

  test("continues runtime resource teardown after a disposer fails", async () => {
    let created = 0;
    let laterSessionDisposed = false;
    const app = createApp({
      component: () => null,
      plugins: [
        createPlugin({
          id: "failing-editor-disposal",
          version: "1.0.0",
          setup({ editorProviders }) {
            return editorProviders.register({
              id: "failing-disposal",
              version: "1.0.0",
              capabilities: new Set(["text"]),
              documentTypes: ["text/plain"],
              create(options: EditorProviderOptions) {
                const session = new TextBufferSession(options);
                created += 1;
                if (created === 1) {
                  session.dispose = () => {
                    throw new Error("first session failed to dispose");
                  };
                } else {
                  const dispose = session.dispose.bind(session);
                  session.dispose = () => {
                    laterSessionDisposed = true;
                    dispose();
                  };
                }
                return session;
              },
            });
          },
        }),
      ],
      terminal: { mode: "silent" },
    });
    await app.ready();
    app.createEditorSession({}, "failing-disposal");
    app.createEditorSession({}, "failing-disposal");

    await expect(app.stop()).rejects.toThrow("Application disposal failed");
    expect(app.lifecycle.state).toBe("disposed");
    expect(laterSessionDisposed).toBeTrue();
    expect(app.editorSessions.values()).toEqual([]);
    expect(app.logPipelines.values()).toEqual([]);
    expect(app.streamingPipelines.values()).toEqual([]);
  });

  test("consumes and cleans every runtime plugin contribution", async () => {
    const PluginComponent = () => null;
    const pluginRenderer: RendererBackend = {
      id: "plugin-renderer",
      capabilities: new Set(["static"]),
      render: () => ({
        width: 1,
        height: 1,
        sequence: 1,
        timestamp: 1,
        payload: "plugin",
      }),
      diff: () => ({
        bytes: new Uint8Array(),
        changedCells: 0,
        changedRows: [],
        dirtyRects: [],
      }),
    };
    const app = createApp({
      component: () => null,
      plugins: [
        createPlugin({
          id: "all-contributions",
          version: "1.0.0",
          setup(context) {
            const registrations = [
              context.components.register({
                id: "plugin-component",
                component: PluginComponent,
              }),
              context.editorProviders.register({
                id: "plugin-editor",
                version: "1.0.0",
                capabilities: new Set(["text"]),
                documentTypes: ["text/plugin"],
                create: (options: EditorProviderOptions) =>
                  new TextBufferSession(options),
              }),
              context.logParsers.register({
                id: "plugin-log",
                detect: (input: string) =>
                  input.startsWith("PLUGIN ") ? 1 : 0,
                parse: () => [],
              }),
              context.themes.register({
                ...defaultTheme,
                id: "plugin-theme",
              }),
              context.formatAdapters.register({
                id: "plugin-format",
                mediaTypes: ["text/plugin"],
                detect: () => 1,
                parse: (source: string, complete: boolean) => ({
                  format: "plugin-format",
                  source,
                  complete,
                  nodes: [],
                  diagnostics: [],
                }),
              }),
              context.renderProjections.register({
                id: "plugin-projection",
                project: (document: PartialDocument) => document.source,
              }),
              context.renderers.register(pluginRenderer),
              context.devtoolsPanels.register({
                id: "plugin-panel",
                title: "Plugin",
                inspect: () => "ready",
              }),
            ];
            return () => {
              for (const registration of registrations.reverse()) {
                registration.dispose();
              }
            };
          },
        }),
      ],
      terminal: { mode: "silent" },
    });
    await app.ready();
    expect(app.resolveComponent("plugin-component")).toBe(PluginComponent);
    expect(app.editorProviders.resolve("plugin-editor").id).toBe(
      "plugin-editor",
    );
    expect(app.createLogPipeline().ingest("PLUGIN value")).toEqual([]);
    const streaming = app.createStreamingPipeline();
    const pluginDocument = await streaming.write("plugin value");
    expect(pluginDocument.format).toBe("plugin-format");
    expect(
      await streaming.project<string>("plugin-projection", pluginDocument),
    ).toBe("plugin value");
    expect(app.renderers.list().map((renderer) => renderer.id)).toContain(
      "plugin-renderer",
    );
    expect(app.theme.id).toBe("plugin-theme");
    expect(app.extensions.devtoolsPanels.values()).toHaveLength(1);
    await app.stop();
    expect(app.resolveComponent("plugin-component")).toBeUndefined();
    expect(app.theme.id).toBe(defaultTheme.id);
    expect(app.renderers.list().map((renderer) => renderer.id)).not.toContain(
      "plugin-renderer",
    );
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
