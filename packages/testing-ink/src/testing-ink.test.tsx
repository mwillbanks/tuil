import { afterEach, expect, test } from "bun:test";
import { defineService, useService } from "@mwillbanks/tuil";
import { Box, Text } from "@mwillbanks/tuil-ink";
import { cleanup, renderTuil, screen, TuilUser, user } from "./index.ts";

afterEach(cleanup);

test("testing adapter captures Ink frames and semantics", async () => {
  const view = renderTuil(<Text testId="message">Hello terminal</Text>);
  await view.ready;
  expect(view.screen.frame()).toContain("Hello terminal");
  expect(view.screen.getByTestId("message").label).toBe("Hello terminal");
  await view.cleanup();
});

test("global queries, input, rerenders, and resizes follow the active render", async () => {
  expect(() => screen.frame()).toThrow("No active tuil render");
  expect(() => screen.getByRole("text")).toThrow("No active tuil render");
  expect(() => screen.getAllByRole("text")).toThrow("No active tuil render");
  expect(() => screen.getByLabelText("message")).toThrow(
    "No active tuil render",
  );
  expect(() => screen.getByText("message")).toThrow("No active tuil render");
  expect(() => screen.getByTestId("message")).toThrow("No active tuil render");
  await expect(user.press("enter")).rejects.toThrow("No active tuil render");
  await expect(user.type("message")).rejects.toThrow("No active tuil render");

  const inputs: string[] = [];
  const directUser = new TuilUser(
    (input) => inputs.push(input),
    Promise.resolve(),
  );
  await directUser.press("enter");
  await directUser.press("raw");
  await directUser.type("ok");
  expect(inputs).toEqual(["\r", "raw", "o", "k"]);

  const view = renderTuil(
    <Box>
      <Text testId="message">First</Text>
    </Box>,
  );
  await view.ready;
  expect(screen.frame()).toContain("First");
  expect(screen.getByRole("text").label).toBe("First");
  expect(screen.getAllByRole("text")).toHaveLength(1);
  expect(screen.getByLabelText("First").testId).toBe("message");
  expect(screen.getByText("First").testId).toBe("message");
  expect(screen.getByTestId("message").label).toBe("First");
  await user.press("enter");
  await user.type("ok");
  view.resize(100, 30);
  view.rerender(<Text testId="message">Second</Text>);
  await Bun.sleep(10);
  expect(screen.frame()).toContain("Second");
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

test("cleanup reports asynchronous startup failures after releasing renders", async () => {
  const view = renderTuil(<Text>Never rendered</Text>, {
    services: {
      failure: defineService({
        id: "failure",
        create() {
          throw new Error("startup failed");
        },
      }),
    },
  });
  await expect(view.ready).rejects.toThrow("startup failed");
  await expect(cleanup()).rejects.toThrow(
    "Failed to clean up tuil test renders",
  );
  expect(() => screen.frame()).toThrow("No active tuil render");
});
