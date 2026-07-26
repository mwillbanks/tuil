import { afterEach, expect, test } from "bun:test";
import { defineCommand } from "@mwillbanks/tuil";
import { Text } from "@mwillbanks/tuil-ink";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement, Fragment } from "react";
import { DevtoolsStore, inspectRuntime, TuilDevtools } from "./index.tsx";

afterEach(cleanup);

test("inspects runtime panels and bounds observed events", async () => {
  const instance = renderTuil(createElement(Text, null, "application"));
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
