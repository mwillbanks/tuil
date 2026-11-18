import { afterEach, expect, test } from "bun:test";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { Text } from "ink";
import {
  CodeViewer,
  MarkdownViewer,
  RichDiffViewer,
} from "../../../registry/data-display/rich-content";

afterEach(cleanup);
test("Markdown renders parsed links, fenced code, and tables and navigates block boundaries", async () => {
  const selected: number[] = [];
  const source =
    "# Heading\n\n[Website](https://example.test)\n\n```typescript\nconst value = 1;\n```\n\n| Name | Value |\n| --- | --- |\n| Test | 42 |";
  const view = renderTuil(
    <MarkdownViewer
      id="markdown"
      label="Document"
      autoFocus
      selectable
      source={source}
      onSelectedBlockChange={(index) => {
        selected.push(index);
      }}
    />,
  );
  await view.ready;
  await view.user.press("x");
  expect(view.screen.frame()).toContain("Website");
  expect(view.screen.frame()).toContain("https://example.test");
  expect(view.screen.frame()).toContain("Name");
  expect(view.screen.frame()).toContain("42");
  await view.user.press("arrowUp");
  await view.user.press("end");
  await view.user.press("home");
  await view.user.press("arrowDown");
  expect(selected[0]).toBe(0);
  expect(selected[1]).toBeGreaterThan(0);
  expect(selected.slice(-2)).toEqual([0, 1]);
});

test("Markdown custom block rendering supports controlled selections", async () => {
  const selected: number[] = [];
  const view = renderTuil(
    <MarkdownViewer
      id="custom-markdown"
      autoFocus
      selectable
      selectedBlock={0}
      source={"# Custom\n\nBody"}
      onSelectedBlockChange={(index) => {
        selected.push(index);
      }}
      renderBlock={(_node, index) => <Text>{"Custom block " + index}</Text>}
    />,
  );
  await view.ready;
  await view.user.press("x");
  expect(
    view.screen.getByRole("application", { name: "Markdown viewer" }).valueText,
  ).toBe("2 blocks");
  await view.user.press("arrowDown");
  await view.user.press("arrowDown");
  expect(selected).toEqual([1, 1]);
  expect(view.screen.frame()).toContain("Custom block 0");
  expect(view.screen.frame()).toContain("Custom block 1");
});

test("Code viewer navigates boundaries and copies the complete source when no match is active", async () => {
  const selected: number[] = [];
  const copied: string[] = [];
  const source = "const first = 1;\nreturn first;";
  const view = renderTuil(
    <CodeViewer
      id="code"
      label="Source"
      autoFocus
      source={source}
      onSelectedLineChange={(line) => {
        selected.push(line);
      }}
      onCopy={(value) => {
        copied.push(value);
      }}
    />,
  );
  await view.ready;
  await view.user.press("n");
  await view.user.press("home");
  await view.user.press("arrowUp");
  await view.user.press("end");
  await view.user.press("arrowDown");
  await view.user.press("x");
  await view.user.press("\u0003");
  expect(selected).toEqual([0, 0, 1, 1]);
  expect(copied).toEqual([source]);
  expect(
    view.screen.getByRole("application", { name: "Source" }).valueText,
  ).toBe("2 lines · 0 matches");
});

test("Diff hunk navigation resolves the selected hunk with exact apply and reject content", async () => {
  const resolved: { index: number; decision: string; content: string }[] = [];
  const source =
    "@@ -1 +1 @@\n-old-one\n+new-one\n@@ -3 +3 @@\n-old-two\n+new-two";
  const view = renderTuil(
    <RichDiffViewer
      id="diff"
      label="Changes"
      autoFocus
      source={source}
      onResolveHunk={(index, decision, content) => {
        resolved.push({ index, decision, content });
      }}
    />,
  );
  await view.ready;
  await view.user.press("arrowDown");
  await view.user.press("a");
  await view.user.press("k");
  await view.user.press("r");
  await view.user.press("x");
  expect(resolved).toEqual([
    { index: 1, decision: "apply", content: "new-two" },
    { index: 0, decision: "reject", content: "old-one" },
  ]);
  expect(
    view.screen.getByRole("application", { name: "Changes" }).valueText,
  ).toBe("2 hunks");
});
