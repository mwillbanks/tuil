import { afterEach, expect, test } from "bun:test";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement } from "react";
import { createPlaygroundApp, Playground } from "./index.tsx";

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
  const instance = renderTuil(
    createElement(Playground, {
      onResize: (width, height) => resizes.push({ width, height }),
      onThemeChange: (theme) => themes.push(theme),
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
  expect(resizes).toEqual([{ width: 85, height: 24 }]);
  expect(themes).toEqual(["default-light"]);
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
