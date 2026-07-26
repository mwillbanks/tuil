import { afterEach, expect, test } from "bun:test";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement } from "react";
import "./ai-assistant/src/index.tsx";
import "./command-center/src/index.tsx";
import "./dashboard/src/index.tsx";
import "./file-browser/src/index.tsx";
import "./forms/src/index.tsx";
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
