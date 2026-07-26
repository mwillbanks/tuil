import { expect, test } from "bun:test";
import {
  defaultTerminalStoryControls,
  defineTuilStories,
  normalizeTerminalFrame,
  SemanticScreen,
} from "./index.ts";

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

test("portable story definitions preserve typed, immutable variants", () => {
  function Example(props: { readonly label: string }) {
    return props.label;
  }
  const stories = defineTuilStories({
    component: Example,
    stories: {
      Default: {
        args: { label: "Ready" },
        terminal: { width: 80, unicode: true },
      },
    },
  });
  expect(stories.stories.Default.args.label).toBe("Ready");
  expect(Object.isFrozen(stories.stories.Default)).toBeTrue();
  expect(Object.isFrozen(stories.stories.Default.args)).toBeTrue();
  expect(defaultTerminalStoryControls.colorDepth).toBe(24);
  expect(Object.isFrozen(defaultTerminalStoryControls)).toBeTrue();
});
