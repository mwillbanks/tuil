import { expect, test } from "bun:test";
import { renderTuil } from "@mwillbanks/tuil-testing-ink";
import { InitSummary } from "./init-summary.tsx";

test("initializer summary renders success and failure outcomes", async () => {
  const success = renderTuil(
    <InitSummary
      name="demo"
      template="minimal"
      features={[]}
      completed={1}
      total={1}
    />,
    { terminal: { mode: "static" } },
  );
  await success.ready;
  expect(success.screen.frame()).toContain("Project ready");
  expect(success.screen.frame()).toContain("Features: none");
  await success.cleanup();

  const failure = renderTuil(
    <InitSummary
      name="demo"
      template="application"
      features={["router"]}
      completed={1}
      total={2}
      error="Generation failed"
    />,
    { terminal: { mode: "static" } },
  );
  await failure.ready;
  expect(failure.screen.frame()).toContain("Initialization failed");
  expect(failure.screen.frame()).toContain("Generation failed");
  await failure.cleanup();
});
