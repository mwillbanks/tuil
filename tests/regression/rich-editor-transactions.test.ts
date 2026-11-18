import { expect, test } from "bun:test";
import {
  RichDocumentSession,
  RichEditorSession,
  type RichNode,
} from "../../packages/editor/src/rich";
const text = (value: string): RichNode => ({ type: "text", text: value });
const paragraph = (value: string): RichNode => ({
  type: "paragraph",
  children: [text(value)],
});
const document = (...children: RichNode[]): RichNode => ({
  type: "document",
  children,
});
test("invalid rich transactions preserve document identity and redo history", () => {
  const rich = new RichDocumentSession(
    document(paragraph("before"), paragraph("survivor")),
  );
  const before = rich.snapshot();
  rich.dispatch({ path: [0, 0], node: text("after") });
  const after = rich.snapshot();
  expect(rich.undo()).toBeTrue();
  for (const path of [
    [-1],
    [1.5],
    [Number.NaN],
    new Array<number>(1),
    [99],
    [99, 0],
    [0, 99],
  ]) {
    expect(() => rich.dispatch({ path, remove: true })).toThrow("is invalid");
    expect(rich.snapshot()).toBe(before);
  }
  expect(() => rich.dispatch({ path: [], remove: true })).toThrow("is invalid");
  expect(() => rich.dispatch({ path: [0] })).toThrow("is invalid");
  expect(() => rich.dispatch({ path: [], node: paragraph("wrong") })).toThrow(
    "document root",
  );
  expect(rich.redo()).toBeTrue();
  expect(rich.snapshot()).toBe(after);
  expect(rich.redo()).toBeFalse();
  expect(rich.undo()).toBeTrue();
  expect(rich.snapshot()).toBe(before);
  expect(rich.undo()).toBeFalse();
  rich.dispatch({ path: [0, 0], remove: true });
  expect(rich.serialize("markdown")).toBe("\n\nsurvivor\n\n");
  expect(rich.undo()).toBeTrue();
  expect(rich.snapshot()).toBe(before);
});

test("initial rich insertion creates an editable paragraph and preserves history", () => {
  for (const initial of [
    document(),
    document({ type: "paragraph", children: [] }),
    document({ type: "heading", level: 2, children: [] }),
  ]) {
    const rich = new RichEditorSession({ value: JSON.stringify(initial) });
    try {
      const before = rich.serialize("json");
      rich.dispatch({
        changes: [
          {
            range: {
              anchor: { line: 0, column: 0 },
              head: { line: 0, column: 0 },
            },
            insert: "first",
          },
        ],
      });
      expect(rich.snapshot().document.text).toBe("first\n");
      expect(rich.richSnapshot().root.children?.[0]?.children?.[0]?.text).toBe(
        "first",
      );
      expect(rich.serialize("markdown")).toBe(
        initial.children?.[0]?.type === "heading"
          ? "## first\n\n"
          : "first\n\n",
      );
      expect(rich.undo()).toBeTrue();
      expect(rich.serialize("json")).toBe(before);
      expect(rich.redo()).toBeTrue();
      expect(rich.serialize("text")).toBe("first\n");
      expect(rich.richSnapshot().root.children).toHaveLength(1);
    } finally {
      rich.dispose();
    }
  }
});

test("rejected structural text changes preserve rich content, selections, and history", () => {
  const rich = new RichEditorSession({
    value: JSON.stringify(document(paragraph("safe"))),
  });
  try {
    const before = rich.serialize("json");
    const view = rich.snapshot();
    expect(() =>
      rich.dispatch({
        changes: [
          {
            range: {
              anchor: { line: 0, column: 4 },
              head: { line: 0, column: 4 },
            },
            insert: "\n",
          },
        ],
      }),
    ).toThrow("changed document structure");
    expect(rich.serialize("json")).toBe(before);
    expect(rich.snapshot()).toEqual(view);
    expect(rich.undo()).toBeFalse();
  } finally {
    rich.dispose();
  }
});

test("empty text leaves and newline-terminated initial text retain their own projection", () => {
  for (const [root, insert, expected] of [
    [document(text("")), "first", "first"],
    [document(), "first\n", "first\n"],
  ] as const) {
    const rich = new RichEditorSession({ value: JSON.stringify(root) });
    try {
      rich.dispatch({
        changes: [
          {
            range: {
              anchor: { line: 0, column: 0 },
              head: { line: 0, column: 0 },
            },
            insert,
          },
        ],
      });
      expect(rich.serialize("text")).toBe(expected);
    } finally {
      rich.dispose();
    }
  }
});
