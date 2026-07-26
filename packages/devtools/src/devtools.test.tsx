import { afterEach, expect, test } from "bun:test";
import { defineCommand } from "@mwillbanks/tuil";
import { Text } from "@mwillbanks/tuil-ink";
import { createPlugin } from "@mwillbanks/tuil-plugin";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement, Fragment } from "react";
import {
  DevtoolsStore,
  devtoolsPanels,
  inspectRuntime,
  TuilDevtools,
} from "./index.tsx";

afterEach(cleanup);

test("inspects runtime panels and bounds observed events", async () => {
  const instance = renderTuil(createElement(Text, null, "application"), {
    plugins: [
      createPlugin({
        id: "inspected",
        version: "1.0.0",
        setup() {},
      }),
    ],
  });
  await instance.ready;
  instance.app.commands.register(
    defineCommand({ id: "save", title: "Save", execute() {} }),
  );
  const store = new DevtoolsStore(instance.app, { maxEvents: 2 });
  await instance.app.events.emit("app:ready", {
    appId: instance.app.id,
    state: "ready",
  });
  await instance.app.events.emit("app:mount", {
    appId: instance.app.id,
    state: "ready",
  });
  await instance.app.events.emit("app:stop", {
    appId: instance.app.id,
    state: "ready",
  });
  expect(store.inspect("Events").rows).toHaveLength(2);
  expect(inspectRuntime(instance.app, "Commands").rows[0]).toContain("save");
  expect(inspectRuntime(instance.app, "Theme").rows).toContain(
    `id: ${instance.app.theme.id}`,
  );
  instance.app.services.register("primitive", 42);
  instance.app.services.register("named", { name: "service-name" });
  const routes = instance.app.extensions["routes"];
  const workflows = instance.app.extensions["workflows"];
  const operationExecutors = instance.app.extensions["operationExecutors"];
  if (!routes || !workflows || !operationExecutors) {
    throw new Error("Expected runtime extension registries");
  }
  routes.register(null);
  routes.register("route-string");
  routes.register(function routeHandler() {});
  routes.register(() => undefined);
  routes.register(7);
  routes.register({ id: "route-id" });
  routes.register({ title: "route-title" });
  routes.register({});
  workflows.register({ status: "running" });
  operationExecutors.register({ path: "/operation" });
  instance.app.focus.registerNode({
    id: "focus-node",
    label: "Focus node",
    order: 0,
    disabled: false,
    hidden: false,
  });
  instance.app.focus.focus("focus-node");
  instance.app.hotkeys.register({
    keys: "ctrl+s",
    title: "Save handler",
    handler: () => undefined,
  });
  await instance.app.hotkeys.dispatch("s", { ctrl: true });
  expect(inspectRuntime(instance.app, "Plugins").rows[0]).toContain(
    "inspected",
  );
  for (const panel of devtoolsPanels) {
    expect(inspectRuntime(instance.app, panel).panel).toBe(panel);
  }
  expect(inspectRuntime(instance.app, "Routes").rows).toEqual([
    "null",
    "route-string",
    "routeHandler",
    "function",
    "7",
    "route-id",
    "route-title",
    "Object",
  ]);
  expect(inspectRuntime(instance.app, "Workflows").rows).toEqual(["running"]);
  expect(inspectRuntime(instance.app, "Operations").rows).toEqual([
    "/operation",
  ]);
  expect(() => new DevtoolsStore(instance.app, { maxEvents: 0 })).toThrow(
    "positive integer",
  );
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
  const version = store.version();
  store.refresh();
  expect(store.version()).toBe(version + 1);
  expect(notifications).toBe(1);
  unsubscribe();
  store.dispose();
  store.refresh();
  store.dispose();
  await instance.cleanup();
});

test("renders and toggles the optional overlay", async () => {
  const instance = renderTuil(
    createElement(
      Fragment,
      null,
      createElement(Text, null, "application"),
      createElement(TuilDevtools),
    ),
  );
  await instance.ready;
  expect(instance.screen.frame()).not.toContain("tuil Devtools");
  await instance.user.press("\u0004");
  expect(instance.screen.frame()).toContain("tuil Devtools");
  await instance.user.press("arrowRight");
  expect(instance.screen.frame()).toContain("Commands");
  await instance.user.press("arrowLeft");
  expect(instance.screen.frame()).toContain("Events");
  await instance.user.press("tab");
  expect(instance.screen.frame()).toContain("Commands");
  await instance.user.press("unhandled");
  await instance.user.press("\u0004");
  expect(instance.screen.frame()).not.toContain("tuil Devtools");
  await instance.cleanup();
});

test("refreshes an open panel when runtime registries change", async () => {
  const instance = renderTuil(
    createElement(TuilDevtools, {
      initiallyOpen: true,
      refreshIntervalMs: 16,
    }),
  );
  await instance.ready;
  await instance.user.press("arrowRight");
  expect(instance.screen.frame()).toContain("Commands");
  const registration = instance.app.commands.register(
    defineCommand({
      id: "dynamic",
      title: "Dynamic command",
      execute() {},
    }),
  );
  await Bun.sleep(20);
  expect(instance.screen.frame()).toContain("Dynamic command");
  await registration.dispose();
  await instance.cleanup();
});

test("is a hook-free no-op in production", () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = environment["NODE_ENV"];
  environment["NODE_ENV"] = "production";
  try {
    expect(TuilDevtools({})).toBeNull();
  } finally {
    if (previous === undefined) {
      delete environment["NODE_ENV"];
    } else {
      environment["NODE_ENV"] = previous;
    }
  }
});
