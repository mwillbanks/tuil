import { expect, test } from "bun:test";
import type { EditorSelection } from "./index";
import {
  createRichEditorProvider,
  projectRichDocument,
  RichDocumentSession,
  RichEditorSession,
  richDocumentToMarkdown,
  type RichNode,
} from "./rich";

const text = (value: string): RichNode => ({ type: "text", text: value });
const paragraph = (value: string): RichNode => ({
  type: "paragraph",
  children: [text(value)],
});
const document = (...children: RichNode[]): RichNode => ({
  type: "document",
  children,
});
const selection = (start: number, end = start): EditorSelection => ({
  anchor: { line: 0, column: start },
  head: { line: 0, column: end },
});

test("rich node validation rejects corrupt trees and provider contracts", () => {
  for (const [node, message] of [
    [{ type: "" }, "non-empty node types"],
    [{ type: "text", text: 1 }, "contain strings"],
    [{ type: "heading", level: 7 }, "between 1 and 6"],
    [{ type: "heading", level: 1.5 }, "between 1 and 6"],
    [{ type: "paragraph", children: {} }, "children must be an array"],
    [{ type: "text", marks: {} }, "marks must be an array"],
    [{ type: "text", attributes: [] }, "attributes must be an object"],
    [{ type: "text", marks: [null] }, "non-empty marks"],
    [
      { type: "text", marks: [{ type: "bold", attributes: [] }] },
      "mark attributes must be an object",
    ],
  ] as const) {
    expect(
      () => new RichDocumentSession(document(node as unknown as RichNode)),
    ).toThrow(message);
  }
  expect(() => new RichDocumentSession(paragraph("wrong root"))).toThrow(
    "document root",
  );
  expect(() => createRichEditorProvider({ nodes: [{ type: " " }] })).toThrow(
    "non-empty type",
  );
  expect(() =>
    createRichEditorProvider({
      nodes: [{ type: "custom" }, { type: "custom" }],
    }),
  ).toThrow("duplicated");
  const provider = createRichEditorProvider({
    nodes: [
      {
        type: "mention",
        validate(node) {
          if (node.attributes?.["id"] !== "approved")
            throw new Error("Unknown mention");
        },
      },
    ],
  });
  expect(() =>
    provider.create({ value: JSON.stringify(document({ type: "mention" })) }),
  ).toThrow("Unknown mention");
});

test("rich parser handles empty, plain, wrapped, and non-document JSON inputs", () => {
  const empty = new RichEditorSession({ value: " " });
  const plain = new RichEditorSession({ value: "not JSON" });
  const wrapped = new RichEditorSession({
    value: JSON.stringify({ version: 4, root: document(paragraph("wrapped")) }),
  });
  const nonDocument = JSON.stringify(paragraph("literal"));
  const fallback = new RichEditorSession({ value: nonDocument });
  try {
    expect(empty.snapshot().document.text).toBe("");
    expect(plain.snapshot().document.text).toBe("not JSON\n");
    expect(wrapped.snapshot().document.text).toBe("wrapped\n");
    expect(fallback.snapshot().document.text).toBe(nonDocument + "\n");
    expect(JSON.parse(wrapped.rich.serialize()).root).toEqual(
      document(paragraph("wrapped")),
    );
  } finally {
    for (const session of [empty, plain, wrapped, fallback]) session.dispose();
  }
});

test("rich selections and clipboard commands preserve marks, graphemes, and history", async () => {
  let clipboard = "";
  const rich = new RichEditorSession({
    value: JSON.stringify(
      document({
        type: "paragraph",
        children: [
          { ...text("A👨‍👩‍👧‍👦B"), marks: [{ type: "bold" }] },
          text(" tail"),
        ],
      }),
    ),
    clipboard: {
      read: () => clipboard,
      write: (value) => {
        clipboard = value;
      },
    },
  });
  const observed: string[] = [];
  const unsubscribe = rich.subscribe((snapshot) =>
    observed.push(snapshot.document.text),
  );
  try {
    rich.dispatch({ selections: [selection(2, 1)] });
    expect(await rich.execute("copy")).toBeTrue();
    expect(clipboard).toBe("👨‍👩‍👧‍👦");
    expect(await rich.execute("cut")).toBeTrue();
    expect(rich.serialize("text")).toBe("AB tail\n");
    expect(
      rich.richSnapshot().root.children?.[0]?.children?.[0]?.marks,
    ).toEqual([{ type: "bold" }]);
    expect(rich.rich.undo()).toBeTrue();
    expect(rich.snapshot().selections).toMatchObject([selection(2, 1)]);
    expect(rich.rich.redo()).toBeTrue();
    expect(await rich.execute("paste", "X")).toBeTrue();
    expect(rich.serialize("text")).toBe("AXB tail\n");
    expect(
      rich.execute(
        {
          id: "replace",
          title: "Replace tail",
          execute: (session, value) =>
            session.replace("tail", String(value)) > 0,
        },
        "end",
      ),
    ).toBeTrue();
    expect(rich.serialize("text")).toBe("AXB end\n");
    expect(rich.replace("absent", "")).toBe(0);
    expect(rich.execute("unknown")).toBeFalse();
    expect(rich.execute("cursor-start")).toBeTrue();
    rich.dispatch({ selections: [selection(0, 1)] });
    expect(rich.execute("delete-selection")).toBeTrue();
    expect(rich.serialize("text")).toBe("XB end\n");
    expect(observed.length).toBeGreaterThan(0);
    unsubscribe();
    const count = observed.length;
    rich.dispatch({ selections: [selection(0)] });
    expect(observed).toHaveLength(count);
  } finally {
    unsubscribe();
    rich.dispose();
  }
  expect(rich.snapshot().canUndo).toBeFalse();
  expect(rich.snapshot().canRedo).toBeFalse();
});

test("read-only rich views allow selection while rejecting every document mutation", async () => {
  const rich = new RichEditorSession({ value: "safe", readOnly: true });
  try {
    rich.dispatch({ selections: [selection(0, 4)] });
    expect(rich.copy()).toBe("safe");
    expect(await rich.paste("unsafe")).toBeFalse();
    expect(await rich.cut()).toBe("safe");
    expect(() => rich.transact({ path: [], node: document() })).toThrow(
      "read-only",
    );
    expect(() => rich.replace("safe", "unsafe")).toThrow("read-only");
    expect(() => rich.execute("delete-selection")).toThrow("read-only");
    expect(rich.serialize("text")).toBe("safe\n");
    expect(rich.undo()).toBeFalse();
  } finally {
    rich.dispose();
  }
});

test("provider projections are visible but require rich transactions for custom text", () => {
  const rich = new RichEditorSession(
    {
      value: JSON.stringify(
        document({
          type: "mention",
          attributes: { id: "alice" },
          children: [text("ignored")],
        }),
      ),
    },
    {
      nodes: [
        { type: "mention", text: (node) => "@" + node.attributes?.["id"] },
      ],
    },
  );
  try {
    expect(rich.serialize("text")).toBe("@alice");
    expect(() => rich.replace("alice", "bob")).toThrow("editable text node");
    expect(rich.undo()).toBeFalse();
    rich.transact({
      path: [0],
      node: { type: "mention", attributes: { id: "bob" } },
    });
    expect(rich.serialize("text")).toBe("@bob");
    expect(rich.rich.undo()).toBeTrue();
    expect(rich.serialize("text")).toBe("@alice");
  } finally {
    rich.dispose();
  }
});

test("Markdown serialization retains block structure, marks, tables, and extension output", () => {
  const root = document(
    { type: "heading", children: [text("Title")] },
    {
      type: "paragraph",
      children: [
        { ...text("x"), marks: [{ type: "italic" }, { type: "strike" }] },
        { ...text("y"), marks: [{ type: "code" }] },
        {
          ...text("z"),
          marks: [
            { type: "link", attributes: { href: "https://example.test" } },
          ],
        },
        { ...text(""), marks: [{ type: "bold" }] },
        { ...text("plain"), marks: [{ type: "custom" }] },
      ],
    },
    {
      type: "bullet-list",
      children: [{ type: "list-item", children: [text("one")] }],
    },
    {
      type: "code-block",
      attributes: { language: "ts" },
      text: "const x = 1;",
    },
    { type: "code-block", children: [text("fallback")] },
    {
      type: "table",
      children: [
        {
          type: "table-row",
          children: [{ type: "table-cell", children: [text("cell")] }],
        },
      ],
    },
    { type: "extension", children: [text("extension")] },
  );
  expect(richDocumentToMarkdown(root)).toBe(
    "# Title\n\n~~_x_~~`y`[z](https://example.test)plain\n\n- one\n```ts\nconst x = 1;\n```\n\n```\nfallback\n```\n\n| cell ||\n\nextension",
  );
  expect(
    richDocumentToMarkdown({
      type: "text",
      text: "link",
      marks: [{ type: "link" }],
    }),
  ).toBe("[link]()");
  expect(projectRichDocument(document(paragraph("界界")), 2)).toEqual([
    "界",
    "界",
    "",
    "",
  ]);
  for (const width of [0, -1, 1.5, Number.NaN])
    expect(() => projectRichDocument(root, width)).toThrow("positive integer");
});

test("rich document JSON serialization preserves the immutable tree and version", () => {
  const rich = new RichDocumentSession(document(paragraph("saved")));
  expect(JSON.parse(rich.serialize())).toEqual(rich.snapshot());
  expect(Object.isFrozen(rich.snapshot().root.children)).toBeTrue();
  const restored = new RichEditorSession({ value: rich.serialize() });
  try {
    expect(restored.serialize("markdown")).toBe("saved\n\n");
  } finally {
    restored.dispose();
  }
});
