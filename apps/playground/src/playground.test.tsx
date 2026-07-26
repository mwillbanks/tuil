import { afterEach, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement, type ReactElement } from "react";
import {
  createPlaygroundApp,
  Playground,
  type PlaygroundProps,
  runPlayground,
} from "./index.tsx";

afterEach(cleanup);

async function waitForFrame(
  instance: ReturnType<typeof renderTuil>,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (instance.screen.frame().includes(text)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for playground frame text: ${text}`);
}

test("playground browses the portable ecosystem and real runtime inspectors", async () => {
  const resizes: Array<{ width: number; height: number }> = [];
  const themes: string[] = [];
  const stories: string[] = [];
  let exits = 0;
  const instance = renderTuil(
    createElement(Playground, {
      onResize: (width, height) => resizes.push({ width, height }),
      onThemeChange: (theme) => themes.push(theme),
      onStoryChange: (story, variant) => stories.push(`${story}:${variant}`),
      onExit: () => {
        exits += 1;
      },
    }),
  );
  await instance.ready;
  await waitForFrame(instance, "62%");
  for (const surface of [
    "Component browser",
    "Event inspector",
    "Focus inspector",
    "theme default-dark",
    "Terminal",
    "Code:",
    "Install:",
    "62%",
  ]) {
    expect(instance.screen.frame()).toContain(surface);
  }
  expect(instance.screen.frame()).toContain("app:ready");
  await instance.user.press("\u000e");
  await waitForFrame(instance, "Components/Forms");
  await waitForFrame(instance, "Project name");
  await waitForFrame(instance, "Focus inspector: story-project");
  await instance.user.type("x");
  await waitForFrame(instance, "my-appx");
  await instance.user.press("\u000e");
  await waitForFrame(instance, "Components/Navigation");
  await instance.user.press("\u000e");
  await waitForFrame(instance, "Components/Complex data");
  await instance.user.press("\u000e");
  await waitForFrame(instance, "Application/Initializer");
  await instance.user.press("\u0006");
  await waitForFrame(instance, "static · ascii");
  await instance.user.press("\u001d");
  await instance.user.press("\u0014");
  await instance.user.press("\u001c");
  await instance.user.press("\u0002");
  await instance.user.press("\u0010");
  await instance.user.press("unhandled");
  await instance.user.press("\u0011");
  expect(resizes).toEqual([
    { width: 85, height: 24 },
    { width: 75, height: 24 },
  ]);
  expect(themes).toEqual(["default-light"]);
  expect(stories.length).toBeGreaterThanOrEqual(6);
  expect(exits).toBe(1);
  await instance.cleanup();
});

test("playground runtime configuration applies actual dimensions and themes", () => {
  const app = createPlaygroundApp(
    { width: 92, height: 30, themeId: "default-light" },
    {},
  );
  expect(app.capabilities).toMatchObject({ width: 92, height: 30 });
  expect(app.theme.id).toBe("default-light");
});

test("playground runner serializes startup and shutdown", async () => {
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperties(output, {
    columns: { configurable: true, value: 100 },
    rows: { configurable: true, value: 30 },
  });
  let unmounts = 0;
  let renders = 0;
  await runPlayground({
    output,
    async renderApp(app, options) {
      renders += 1;
      expect(options.stdout.columns).toBeNumber();
      expect(options.stdout.write).toBeFunction();
      if (renders === 1) {
        const renderRoot = app.component as () => ReactElement<PlaygroundProps>;
        const root = renderRoot();
        root.props.onResize?.(90, 28);
        root.props.onThemeChange?.("default-light");
        root.props.onStoryChange?.("forms", "Default", {});
        root.props.onExit?.();
      }
      return {
        app,
        ink: undefined,
        async waitUntilExit() {},
        async unmount() {
          unmounts += 1;
          await app.stop();
        },
      };
    },
  });
  expect(unmounts).toBe(1);
});

test("playground runner applies live output dimensions", async () => {
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperties(output, {
    columns: { configurable: true, value: 100 },
    rows: { configurable: true, value: 30 },
  });
  const widths: number[] = [];
  let unmounts = 0;
  await runPlayground({
    output,
    async renderApp(app, options) {
      widths.push(options.stdout.columns ?? 0);
      if (widths.length === 1) {
        queueMicrotask(() => {
          Object.defineProperties(output, {
            columns: { configurable: true, value: 90 },
            rows: { configurable: true, value: 28 },
          });
          output.emit("resize");
        });
      } else {
        expect(app.capabilities).toMatchObject({ width: 90, height: 28 });
        const renderRoot = app.component as () => ReactElement<PlaygroundProps>;
        renderRoot().props.onExit?.();
      }
      return {
        app,
        ink: undefined,
        waitUntilExit: () => new Promise<void>(() => undefined),
        async unmount() {
          unmounts += 1;
          await app.stop();
        },
      };
    },
  });
  expect(widths).toEqual([100, 90]);
  expect(unmounts).toBe(2);
});

test("playground runner releases resize listeners after render failures", async () => {
  const initialOutput = new PassThrough() as unknown as NodeJS.WriteStream;
  await expect(
    runPlayground({
      output: initialOutput,
      renderApp: () => Promise.reject(new Error("initial render failed")),
    }),
  ).rejects.toThrow("initial render failed");
  expect(initialOutput.listenerCount("resize")).toBe(0);

  const resizeOutput = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.defineProperties(resizeOutput, {
    columns: { configurable: true, value: 100 },
    rows: { configurable: true, value: 30 },
  });
  let renders = 0;
  let unmounts = 0;
  await expect(
    runPlayground({
      output: resizeOutput,
      async renderApp(app) {
        renders += 1;
        if (renders === 2) throw new Error("resize render failed");
        queueMicrotask(() => resizeOutput.emit("resize"));
        return {
          app,
          ink: undefined,
          waitUntilExit: () => new Promise<void>(() => undefined),
          async unmount() {
            unmounts += 1;
            await app.stop();
          },
        };
      },
    }),
  ).rejects.toThrow("resize render failed");
  expect(resizeOutput.listenerCount("resize")).toBe(0);
  expect(unmounts).toBe(1);
});
