import { afterEach, expect, test } from "bun:test";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { InitWizard } from "./blocks/init-wizard.tsx";

afterEach(cleanup);

async function waitForText(
  view: ReturnType<typeof renderTuil>,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (view.screen.frame().includes(text)) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for init wizard text: ${text}`);
}

test("initializer completes the routed workflow with selected answers", async () => {
  const completed: unknown[] = [];
  const view = renderTuil(
    <InitWizard
      initialName="terminal-app"
      onComplete={(answers) => completed.push(answers)}
      onCancel={() => {
        throw new Error("unexpected cancellation");
      }}
    />,
  );
  await view.ready;
  await waitForText(view, "Route: name");

  expect(view.app.focus.focus("init-project-name")).toBeTrue();
  await view.app.commands.execute("init-form.submit");
  await waitForText(view, "Application template");

  expect(view.app.focus.focus("init-template")).toBeTrue();
  await view.user.press("arrowDown");
  await view.user.press("enter");
  await waitForText(view, "Optional features");

  expect(view.app.focus.focus("init-features")).toBeTrue();
  await view.user.press("space");
  expect(view.app.focus.focus("review-project")).toBeTrue();
  await view.user.press("enter");
  await waitForText(view, "Create this project?");

  const confirm = view.screen.getByRole("button", { name: "Create project" });
  if (!confirm.id) throw new Error("Create button is missing an id");
  expect(view.app.focus.focus(confirm.id)).toBeTrue();
  await view.user.press("enter");
  await Bun.sleep(20);
  expect(completed).toEqual([
    {
      name: "terminal-app",
      template: "application",
      features: ["router"],
    },
  ]);
});

test("initializer can revise a confirmation and cancel deterministically", async () => {
  let cancelled = 0;
  const view = renderTuil(
    <InitWizard
      initialName="cancelled-app"
      onComplete={() => {
        throw new Error("unexpected completion");
      }}
      onCancel={() => {
        cancelled += 1;
      }}
    />,
  );
  await view.ready;
  await waitForText(view, "Route: name");
  expect(view.app.focus.focus("init-project-name")).toBeTrue();
  await view.user.press("enter");
  await waitForText(view, "Application template");
  expect(view.app.focus.focus("init-template")).toBeTrue();
  await view.user.press("arrowDown");
  await view.user.press("enter");
  await waitForText(view, "Optional features");
  expect(view.app.focus.focus("review-project")).toBeTrue();
  await view.user.press("enter");
  await waitForText(view, "Create this project?");

  const revise = view.screen.getByRole("button", { name: "Revise selections" });
  if (!revise.id) throw new Error("Revise button is missing an id");
  expect(view.app.focus.focus(revise.id)).toBeTrue();
  await view.user.press("enter");
  await waitForText(view, "Optional features");

  expect(view.app.focus.focus("cancel-init")).toBeTrue();
  await view.user.press("enter");
  expect(cancelled).toBe(1);
});

test("initializer surfaces callback failures through workflow feedback", async () => {
  const view = renderTuil(
    <InitWizard
      initialName="failure-app"
      onComplete={() => undefined}
      onCancel={() => {
        throw new Error("cancel callback failed");
      }}
    />,
  );
  await view.ready;
  await waitForText(view, "Route: name");
  expect(view.app.focus.focus("cancel-init")).toBeTrue();
  await view.user.press("enter");
  await waitForText(view, "Initialization failed");
  expect(view.screen.frame()).toContain("cancel callback failed");
});
