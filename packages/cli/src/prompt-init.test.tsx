import { expect, test } from "bun:test";
import { createApp } from "@mwillbanks/tuil";
import type { ReactElement } from "react";
import type {
  InitAnswers,
  InitWizardProps,
} from "./generated-ui/blocks/init-wizard.tsx";
import { promptInit, renderInitializerApp } from "./prompt-init.tsx";

const answers: InitAnswers = {
  name: "demo",
  template: "application",
  features: ["router", "forms"],
};

test("interactive initialization resolves answers and disposes its runtime", async () => {
  let unmounted = false;
  const result = await promptInit("demo", async (app) => {
    await app.ready();
    const element = (app.component as () => ReactElement<InitWizardProps>)();
    expect(element.props.initialName).toBe("demo");
    element.props.onComplete(answers);
    return {
      async unmount() {
        unmounted = true;
        await app.stop();
      },
    };
  });
  expect(result).toEqual(answers);
  expect(unmounted).toBeTrue();
});

test("interactive initialization rejects cancellation and runtime errors", async () => {
  let cancellations = 0;
  await expect(
    promptInit(undefined, async (app) => {
      await app.ready();
      const element = (app.component as () => ReactElement<InitWizardProps>)();
      expect(element.props.initialName).toBe("my-tuil-app");
      element.props.onCancel();
      return {
        async unmount() {
          cancellations += 1;
          await app.stop();
        },
      };
    }),
  ).rejects.toThrow("Initialization cancelled");

  await expect(
    promptInit("failed", async (app) => {
      await app.ready();
      await app.reportError({ reason: "failed" }, "initializer");
      return {
        async unmount() {
          cancellations += 1;
          await app.stop();
        },
      };
    }),
  ).rejects.toThrow("Initialization failed");
  expect(cancellations).toBe(2);
});

test("the production initializer renderer mounts and unmounts an application", async () => {
  const app = createApp({
    component: () => null,
    terminal: { mode: "static" },
  });
  const instance = await renderInitializerApp(
    app as unknown as Parameters<typeof renderInitializerApp>[0],
  );
  await instance.unmount();
  expect(app.lifecycle.state).toBe("disposed");
});
