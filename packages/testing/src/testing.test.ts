import { expect, test } from "bun:test";
import { normalizeTerminalFrame, SemanticScreen } from "./index.ts";

test("semantic screen provides stable queries and normalized frames", () => {
  const screen = new SemanticScreen(() => ({
    nodes: [
      {
        key: "button",
        role: "button",
        label: "Create project",
        testId: "create",
      },
    ],
    frame: "\u001b[31mCreate project\u001b[0m  \r\n",
  }));
  expect(screen.getByRole("button", { name: "Create project" }).testId).toBe(
    "create",
  );
  expect(screen.getByLabelText("Create project").role).toBe("button");
  expect(normalizeTerminalFrame(screen.frame())).toBe("Create project");
});

test("text queries do not duplicate a frame match across semantic nodes", () => {
  const screen = new SemanticScreen(() => ({
    nodes: [
      { key: "first", role: "text", text: "First" },
      { key: "second", role: "text", text: "Second" },
    ],
    frame: "First\nSecond",
  }));
  expect(screen.getByText("Second").key).toBe("second");
  expect(() => screen.getByText("Missing")).toThrow("Unable to find");
});
