import { expect, test } from "bun:test";
import { defineService, useService } from "@mwillbanks/tuil";
import { Text } from "@mwillbanks/tuil-ink";
import { renderTuil } from "./index.ts";

test("testing adapter captures Ink frames and semantics", async () => {
  const view = renderTuil(<Text testId="message">Hello terminal</Text>);
  await view.ready;
  expect(view.screen.frame()).toContain("Hello terminal");
  expect(view.screen.getByTestId("message").label).toBe("Hello terminal");
  await view.cleanup();
});

test("waits for asynchronous services before rendering components", async () => {
  function ServiceView() {
    const message = useService<string>("message");
    return <Text>{message}</Text>;
  }
  const view = renderTuil(<ServiceView />, {
    services: {
      message: defineService({
        id: "message",
        async create() {
          await Bun.sleep(1);
          return "Service ready";
        },
      }),
    },
  });
  await view.ready;
  expect(view.screen.frame()).toContain("Service ready");
  await view.cleanup();
});
