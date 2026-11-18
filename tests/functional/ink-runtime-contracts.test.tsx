import { afterEach, expect, spyOn, test } from "bun:test";
import { createApp } from "@mwillbanks/tuil";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement } from "react";
import {
  render,
  renderStatic,
  Text,
  useTerminalInput,
} from "../../packages/ink/src/index.ts";

afterEach(cleanup);
test("silent Ink adapter completes lifecycle and permits repeated unmount", async () => {
  const app = createApp({
    component: () => createElement(Text, null, "silent"),
    terminal: { mode: "silent" },
  });
  const instance = await render(app);
  expect(instance.ink).toBeUndefined();
  expect(app.lifecycle.state).toBe("ready");
  await instance.waitUntilExit();
  await instance.unmount();
  expect(app.lifecycle.state).toBe("disposed");
});
test("startup rollback preserves original failure and aggregates cleanup failure", async () => {
  const app = createApp({
    component: () => null,
    terminal: { mode: "silent" },
  });
  const mount = spyOn(app, "mount").mockRejectedValue(
    new Error("mount failed"),
  );
  const stop = spyOn(app, "stop").mockRejectedValue(new Error("stop failed"));
  try {
    const error = await render(app).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map(String)).toEqual([
      "Error: mount failed",
      "Error: stop failed",
    ]);
  } finally {
    mount.mockRestore();
    stop.mockRestore();
    await app.stop();
  }
});
test("silent cleanup failures remain observable after ready and restoration is idempotent", async () => {
  const app = createApp({
    component: () => null,
    terminal: { mode: "silent" },
  });
  const instance = await render(app);
  const stop = spyOn(app, "stop").mockRejectedValue(
    new Error("cleanup failed"),
  );
  try {
    const error = await instance.unmount().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map(String)).toEqual([
      "Error: cleanup failed",
    ]);
    await instance.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  } finally {
    stop.mockRestore();
    await app.stop();
  }
});
test("static renderer reports both rendering and cleanup errors", async () => {
  const app = createApp({
    component: () => null,
    terminal: { mode: "static" },
  });
  const mount = spyOn(app, "mount").mockRejectedValue(
    new Error("static mount failed"),
  );
  const stop = spyOn(app, "stop").mockRejectedValue(
    new Error("static stop failed"),
  );
  try {
    const error = await renderStatic(app).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map(String)).toEqual([
      "Error: static mount failed",
      "Error: static stop failed",
    ]);
  } finally {
    mount.mockRestore();
    stop.mockRestore();
    await app.stop();
  }
});
test("public input hook failures are delivered through the runtime error channel", async () => {
  function InputProbe() {
    useTerminalInput(() => {
      throw new Error("input failed");
    });
    return createElement(Text, null, "Input ready");
  }
  const instance = renderTuil(createElement(InputProbe));
  await instance.ready;
  const reported = Promise.withResolvers<{ error: unknown; phase: string }>();
  const report = spyOn(instance.app, "reportError").mockImplementation(
    async (error, phase) => {
      reported.resolve({ error, phase });
    },
  );
  try {
    await instance.user.press("x");
    const result = await reported.promise;
    expect(String(result.error)).toContain("input failed");
    expect(result.phase).toBe("terminal-input");
  } finally {
    report.mockRestore();
    await instance.cleanup();
  }
});
test("reverse tab input traverses runtime focus without an application handler", async () => {
  const instance = renderTuil(createElement(Text, null, "Focus ready"));
  await instance.ready;
  for (const id of ["first", "last"])
    instance.app.focus.registerNode({ id, disabled: false, hidden: false });
  instance.app.focus.focus("last");
  await instance.user.press("shift+tab");
  expect(instance.app.focus.focusedId).toBe("first");
  await instance.cleanup();
});
