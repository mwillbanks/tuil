import { describe, expect, test } from "bun:test";
import { CommandRegistry, ServiceContainer } from "@mwillbanks/tuil-core";
import { EventBus } from "@mwillbanks/tuil-events";
import {
  createPlugin,
  type ExtensionRegistry,
  PluginManager,
  PluginRegistry,
} from "./index.ts";

const extension: ExtensionRegistry = {
  register: () => ({ dispose() {} }),
  values: () => [],
  observe: () => () => {},
};

function manager(
  capabilities: readonly ["process.execute"] | readonly [] = [],
) {
  const services = new ServiceContainer();
  return new PluginManager({
    services,
    commands: new CommandRegistry(services),
    events: new EventBus(),
    routes: extension,
    registry: extension,
    workflows: extension,
    theme: extension,
    statusBar: extension,
    appBar: extension,
    menus: extension,
    keybindings: extension,
    dataAdapters: extension,
    persistenceAdapters: extension,
    operationExecutors: extension,
    devtools: extension,
    capabilities: new Set(capabilities),
  });
}

describe("plugin manager", () => {
  test("orders setup by dependencies and disposal in reverse", async () => {
    const calls: string[] = [];
    const plugins = manager();
    plugins.register(
      createPlugin({
        id: "dependent",
        version: "1.0.0",
        dependsOn: ["base"],
        setup() {
          calls.push("setup:dependent");
          return () => {
            calls.push("dispose:dependent");
          };
        },
      }),
    );
    plugins.register(
      createPlugin({
        id: "base",
        version: "1.0.0",
        setup() {
          calls.push("setup:base");
          return () => {
            calls.push("dispose:base");
          };
        },
      }),
    );
    await plugins.initialize();
    await plugins.dispose();
    expect(calls).toEqual([
      "setup:base",
      "setup:dependent",
      "dispose:dependent",
      "dispose:base",
    ]);
  });

  test("detects missing capabilities and dependency cycles", async () => {
    const denied = manager();
    denied.register(
      createPlugin({
        id: "process",
        version: "1.0.0",
        requires: { capabilities: ["process.execute"] },
        setup() {},
      }),
    );
    await expect(denied.initialize()).rejects.toThrow(
      "unavailable capabilities",
    );

    const cyclic = manager();
    cyclic.register(
      createPlugin({
        id: "left",
        version: "1.0.0",
        dependsOn: ["right"],
        setup() {},
      }),
    );
    cyclic.register(
      createPlugin({
        id: "right",
        version: "1.0.0",
        dependsOn: ["left"],
        setup() {},
      }),
    );
    await expect(cyclic.initialize()).rejects.toThrow("cycle");
  });

  test("reports health and enforces plugin registration lifetimes", async () => {
    const plugins = manager();
    const plugin = createPlugin({
      id: "lifecycle",
      version: "1.0.0",
      setup() {
        return { dispose() {} };
      },
    });
    const unregister = plugins.register(plugin);
    expect(plugins.health()).toEqual([
      {
        id: "lifecycle",
        version: "1.0.0",
        status: "registered",
        error: undefined,
      },
    ]);
    expect(() => plugins.register(plugin)).toThrow("already registered");
    await plugins.initialize();
    expect(plugins.health()[0]?.status).toBe("healthy");
    expect(unregister).toThrow("Cannot unregister active plugin");
    await plugins.initialize();
    await plugins.dispose();
    expect(plugins.health()[0]?.status).toBe("disposed");
    expect(unregister).toThrow("disposed");
    expect(() =>
      plugins.register(
        createPlugin({
          id: "late",
          version: "1.0.0",
          setup() {},
        }),
      ),
    ).toThrow("disposed");
    await expect(plugins.initialize()).rejects.toThrow("disposed");
    await plugins.dispose();

    const fresh = manager();
    const removable = createPlugin({
      id: "removable",
      version: "1.0.0",
      setup() {},
    });
    const remove = fresh.register(removable);
    remove();
    expect(fresh.health()).toEqual([]);
  });

  test("records setup failures and aggregates disposal failures", async () => {
    const plugins = manager();
    plugins.register(
      createPlugin({
        id: "base",
        version: "1.0.0",
        setup() {
          return () => {
            throw new Error("dispose failed");
          };
        },
      }),
    );
    plugins.register(
      createPlugin({
        id: "failure",
        version: "1.0.0",
        dependsOn: ["base"],
        setup() {
          throw new Error("setup failed");
        },
      }),
    );
    await expect(plugins.initialize()).rejects.toThrow("dispose plugins");
    expect(plugins.health()).toMatchObject([
      { id: "base", status: "disposed" },
      { id: "failure", status: "failed", error: expect.any(Error) },
    ]);

    const missing = manager();
    missing.register(
      createPlugin({
        id: "dependent",
        version: "1.0.0",
        dependsOn: ["absent"],
        setup() {},
      }),
    );
    await expect(missing.initialize()).rejects.toThrow(
      'depends on missing plugin "absent"',
    );
    expect(() => createPlugin({ id: "", version: "1", setup() {} })).toThrow(
      "cannot be empty",
    );
    expect(() =>
      createPlugin({ id: "versionless", version: "", setup() {} }),
    ).toThrow("must declare a version");
  });
});

describe("plugin registry", () => {
  test("resolves dependencies and disposes catalog entries", () => {
    const registry = new PluginRegistry();
    const core = createPlugin({ id: "core", version: "1.0.0", setup() {} });
    const extensionPlugin = createPlugin({
      id: "extension",
      version: "1.0.0",
      dependsOn: ["core"],
      requires: { capabilities: ["network.request"] },
      setup() {},
    });
    const coreRegistration = registry.register({
      plugin: core,
      tags: ["official"],
    });
    registry.register({
      plugin: extensionPlugin,
      tags: ["official", "network"],
    });

    expect(registry.resolve(["extension"]).map((plugin) => plugin.id)).toEqual([
      "core",
      "extension",
    ]);
    expect(registry.list({ tag: "network" })[0]?.plugin.id).toBe("extension");
    expect(registry.list({ capability: "network.request" })[0]?.plugin.id).toBe(
      "extension",
    );
    expect(registry.get("core")?.plugin).toBe(core);
    expect(registry.list()).toHaveLength(2);

    coreRegistration.dispose();
    coreRegistration.dispose();
    expect(() => registry.resolve(["extension"])).toThrow(
      'depends on unavailable plugin "core"',
    );
  });

  test("rejects duplicate entries and dependency cycles", () => {
    const registry = new PluginRegistry();
    const first = createPlugin({
      id: "first",
      version: "1",
      dependsOn: ["second"],
      setup() {},
    });
    const second = createPlugin({
      id: "second",
      version: "1",
      dependsOn: ["first"],
      setup() {},
    });
    registry.register({ plugin: first });
    registry.register({ plugin: second });
    expect(() => registry.register({ plugin: first })).toThrow(
      "already in the registry",
    );
    expect(() => registry.resolve(["first"])).toThrow("dependency cycle");
  });
});
