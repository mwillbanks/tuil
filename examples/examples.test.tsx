import { afterEach, expect, test } from "bun:test";
import { createApp } from "@mwillbanks/tuil";
import { renderStatic } from "@mwillbanks/tuil-ink";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement } from "react";
import "./ai-assistant/src/index.tsx";
import "./command-center/src/index.tsx";
import "./dashboard/src/index.tsx";
import "./file-browser/src/index.tsx";
import "./forms/src/index.tsx";
import { loadLogo } from "./full-screen/src/index.tsx";
import "./minimal/src/index.tsx";
import "./project-wizard/src/index.tsx";
import {
  ExampleApplication,
  type ExampleKind,
  runExample,
} from "./_shared.tsx";

afterEach(cleanup);

const examples = [
  ["minimal", "Hello from tuil"],
  ["forms", "Project name"],
  ["dashboard", "Delivery dashboard"],
  ["project-wizard", "tuil init"],
  ["command-center", "Command center"],
  ["file-browser", "File browser"],
  ["ai-assistant", "AI assistant"],
  ["full-screen", "Discovering workspace capabilities"],
] as const satisfies readonly (readonly [ExampleKind, string])[];

for (const [kind, expected] of examples) {
  test(`${kind} example renders a working application`, async () => {
    const instance = renderTuil(createElement(ExampleApplication, { kind }));
    await instance.ready;
    expect(instance.screen.frame()).toContain(expected);
    expect(instance.screen.snapshot().nodes.length).toBeGreaterThan(0);
    await instance.cleanup();
  });
}

test("examples execute their interactive callbacks and cleanup paths", async () => {
  const forms = renderTuil(
    createElement(ExampleApplication, { kind: "forms" }),
  );
  await forms.ready;
  await forms.user.type("x");
  await forms.app.commands.execute("profile.submit");
  await Bun.sleep(10);
  expect(forms.screen.frame()).toContain("Submitted: terminal-appx");
  await forms.cleanup();

  const commands = renderTuil(
    createElement(ExampleApplication, { kind: "command-center" }),
  );
  await commands.ready;
  await commands.user.type("build");
  await commands.user.press("enter");
  expect(commands.screen.frame()).toContain("Build started");
  await commands.app.commands.execute("project.test");
  await Bun.sleep(25);
  expect(commands.screen.frame()).toContain("Tests started");
  await commands.cleanup();

  const files = renderTuil(
    createElement(ExampleApplication, { kind: "file-browser" }),
  );
  await files.ready;
  await files.user.press("arrowRight");
  await files.user.press("enter");
  expect(files.screen.frame()).toContain("Selected: src/index");
  await files.cleanup();

  const assistant = renderTuil(
    createElement(ExampleApplication, { kind: "ai-assistant" }),
  );
  await assistant.ready;
  await assistant.user.press("unhandled");
  await assistant.user.press("r");
  expect(assistant.screen.frame()).toContain("tool: read test results");
  await assistant.cleanup();

  const wizard = renderTuil(
    createElement(ExampleApplication, { kind: "project-wizard" }),
  );
  await wizard.ready;
  expect(wizard.app.focus.focus("cancel-init")).toBeTrue();
  await wizard.user.press("enter");
  await Bun.sleep(10);
  expect(wizard.screen.frame()).toContain("cancelled");
  await wizard.cleanup();
});

test("example runner stops cleanly on interrupt", async () => {
  setTimeout(() => {
    process.emit("SIGINT", "SIGINT");
  }, 25);
  await runExample("minimal");
});

test("full-screen example transitions, handles menus, prompts, and resizes", async () => {
  const logo = await loadLogo();
  expect(logo.width).toBe(160);
  expect(logo.height).toBeGreaterThan(0);
  const fullScreen = renderTuil(
    createElement(ExampleApplication, {
      kind: "full-screen",
      logo,
      splashDurationMs: 20,
      loadingMessageIntervalMs: 5,
    }),
    {
      terminal: {
        capabilities: {
          width: 100,
          height: 30,
          alternateScreen: true,
          colorDepth: 24,
          unicode: true,
        },
      },
    },
  );
  await fullScreen.ready;
  expect(
    fullScreen.screen.getByRole("image", {
      name: "tuil terminal interface logo",
    }),
  ).toBeDefined();
  await Bun.sleep(75);
  expect(fullScreen.screen.frame()).toContain("Workspace activity");
  expect(
    fullScreen.screen.getByRole("textbox", { name: "Workspace prompt" }),
  ).toBeDefined();

  await fullScreen.app.hotkeys.dispatch(
    "f",
    { alt: true },
    { activeScopes: { application: true } },
  );
  await Bun.sleep(10);
  expect(fullScreen.screen.frame()).toContain("New session");
  await fullScreen.user.press("escape");
  await fullScreen.app.hotkeys.dispatch(
    "e",
    { alt: true },
    { activeScopes: { application: true } },
  );
  await Bun.sleep(10);
  expect(fullScreen.screen.frame()).toContain("Copy selection");
  await fullScreen.user.press("escape");
  await fullScreen.app.hotkeys.dispatch(
    "h",
    { alt: true },
    { activeScopes: { application: true } },
  );
  await Bun.sleep(10);
  expect(fullScreen.screen.frame()).toContain("Keyboard shortcuts");
  await fullScreen.user.press("escape");
  await fullScreen.app.hotkeys.dispatch(
    "f",
    { meta: true },
    { activeScopes: { application: true } },
  );
  await Bun.sleep(10);
  expect(fullScreen.screen.frame()).toContain("Open workspace");
  await fullScreen.user.press("escape");
  await fullScreen.app.hotkeys.dispatch(
    "e",
    { meta: true },
    { activeScopes: { application: true } },
  );
  await Bun.sleep(10);
  expect(fullScreen.screen.frame()).toContain("Clear activity");
  await fullScreen.user.press("escape");
  await fullScreen.user.type("Summarize this workspace");
  expect(
    fullScreen.screen.getByRole("textbox", { name: "Workspace prompt" })
      .valueText,
  ).toContain("Summarize this workspace");
  await fullScreen.user.press("enter");
  expect(fullScreen.screen.frame()).toContain("USER  Summarize this workspace");

  await fullScreen.app.commands.execute("session.new");
  await fullScreen.app.commands.execute("activity.clear");
  await fullScreen.app.commands.execute("help.about");
  await Bun.sleep(10);
  expect(fullScreen.screen.frame()).toContain("Activity cleared");
  expect(fullScreen.screen.frame()).toContain("tuil full-screen example");

  await fullScreen.app.hotkeys.dispatch(
    "h",
    { meta: true },
    { activeScopes: { application: true } },
  );
  await Bun.sleep(50);
  await fullScreen.user.press("enter");
  expect(fullScreen.screen.frame()).toContain("Selected Keyboard shortcuts");

  fullScreen.resize(48, 18);
  await Bun.sleep(25);
  expect(fullScreen.screen.frame()).not.toContain(
    "Image + hotkeys + responsive layout active",
  );
  fullScreen.resize(132, 36);
  await Bun.sleep(25);
  expect(fullScreen.screen.frame()).toContain("Context");
  await fullScreen.cleanup();
});

test("full-screen example skips animation outside interactive terminals", async () => {
  const staticView = renderTuil(
    createElement(ExampleApplication, { kind: "full-screen" }),
    {
      terminal: {
        mode: "static",
        capabilities: { interactive: false, tty: false },
      },
    },
  );
  await staticView.ready;
  await Bun.sleep(10);
  expect(staticView.screen.frame()).toContain("Workspace activity");
  await staticView.cleanup();

  const staticApp = createApp({
    component: () => createElement(ExampleApplication, { kind: "full-screen" }),
    terminal: { mode: "static" },
  });
  const frame = await renderStatic(staticApp);
  expect(frame).toContain("Workspace activity");
  expect(frame).not.toContain("Discovering workspace capabilities");
});
