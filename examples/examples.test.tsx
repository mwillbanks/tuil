import { afterEach, expect, test } from "bun:test";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createElement } from "react";
import { ExampleApplication, type ExampleKind } from "./_shared.tsx";

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
