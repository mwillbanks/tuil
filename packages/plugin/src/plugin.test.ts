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
  register() {},
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
