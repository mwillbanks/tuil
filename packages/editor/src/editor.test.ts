import { expect, test } from "bun:test";
import { insertText, TextBufferSession, textBufferProvider } from "./buffer.ts";
import { EditorProviderRegistry, position, selection } from "./index.ts";
import {
  createRichEditorProvider,
  projectRichDocument,
  RichDocumentSession,
  RichEditorSession,
  richEditorProvider,
} from "./rich.ts";
import {
  applyEditorTransactions,
  assertEditorInvariant,
  runEditorProviderConformance,
} from "./testing.ts";
import { VimEditorSession, vimEditorProvider } from "./vim.ts";

test("buffer edits are grapheme-safe, transactional, searchable, and reversible", () => {
  const session = new TextBufferSession({
    value: "a界e\u0301\nsecond",
  });
  session.dispatch({
    selections: [selection(position(0, 1), position(0, 2))],
  });
  insertText(session, "X");
  expect(session.serialize()).toBe("aXe\u0301\nsecond");
  expect(session.search(/e\u0301|second/u)).toHaveLength(2);
  expect(session.replace("second", "done")).toBe(1);
  expect(session.undo()).toBe(true);
  expect(session.redo()).toBe(true);
  assertEditorInvariant(session);
});

test("providers share clipboard operations and the conformance harness", async () => {
  let clipboard = "";
  const session = new TextBufferSession({
    value: "copy me",
    clipboard: {
      read: () => clipboard,
      write: (value) => {
        clipboard = value;
      },
    },
  });
  await session.execute("select-all");
  expect(await session.copy()).toBe("copy me");
  expect(clipboard).toBe("copy me");
  expect(await session.cut()).toBe("copy me");
  expect(session.serialize()).toBe("");
  expect(await session.paste()).toBe(true);
  expect(session.serialize()).toBe("copy me");
  expect(
    (await runEditorProviderConformance(textBufferProvider)).providerId,
  ).toBe("tuil-buffer");
  expect(
    (await runEditorProviderConformance(vimEditorProvider)).providerId,
  ).toBe("tuil-vim");
  expect(
    (await runEditorProviderConformance(richEditorProvider)).providerId,
  ).toBe("tuil-rich-document");
});

test("buffer supports selections, masking, read-only, diagnostics, and decorations", () => {
  let privateValue = "abcd";
  const session = new TextBufferSession({
    value: privateValue,
    masked: true,
    onDocumentChange: (value) => {
      privateValue = value;
    },
  });
  session.dispatch({
    selections: [
      selection(position(0, 0), position(0, 1)),
      selection(position(0, 2), position(0, 3), false),
    ],
  });
  insertText(session, "x");
  expect(privateValue).toBe("xbxd");
  expect(session.serialize()).toBe("••••");
  expect(session.snapshot().document.text).toBe("••••");
  session.setDecorations([
    {
      id: "match",
      range: selection(position(0, 0)),
      kind: "highlight",
    },
  ]);
  session.setDiagnostics([
    {
      range: selection(position(0, 0)),
      severity: "warning",
      message: "demo",
    },
  ]);
  expect(session.snapshot().diagnostics[0]?.message).toBe("demo");
  expect(() =>
    new TextBufferSession({ value: "x", readOnly: true }).dispatch({
      changes: [
        {
          range: selection(position(0, 0)),
          insert: "y",
        },
      ],
    }),
  ).toThrow("read-only");
});

test("multi-change transactions retain one correctly remapped cursor per edit", () => {
  const session = new TextBufferSession({ value: "abcd" });
  const snapshot = session.dispatch({
    changes: [
      { range: selection(position(0, 1)), insert: "X" },
      { range: selection(position(0, 3)), insert: "Y" },
    ],
  });
  expect(snapshot.document.text).toBe("aXbcYd");
  expect(snapshot.selections.map((item) => item.head.column)).toEqual([2, 5]);
});

test("masked snapshots preserve grapheme coordinates", () => {
  let privateValue = "";
  const session = new TextBufferSession({
    value: "🙂e\u0301\n界",
    masked: true,
    onDocumentChange: (value) => {
      privateValue = value;
    },
  });
  expect(session.snapshot().document.text).toBe("••\n•");
  session.dispatch({
    selections: [selection(position(0, 1), position(0, 2))],
  });
  insertText(session, "x");
  expect(privateValue).toBe("🙂x\n界");
  expect(session.serialize()).toBe("••\n•");
  expect(session.snapshot().document.text).toBe("••\n•");
});

test("masked sessions redact every serialization and clipboard export", async () => {
  let clipboard = "";
  let privateValue = "secret🙂";
  const session = new TextBufferSession({
    value: privateValue,
    masked: true,
    clipboard: {
      read: () => "replacement",
      write: (value) => {
        clipboard = value;
      },
    },
    onDocumentChange: (value) => {
      privateValue = value;
    },
  });

  expect(session.serialize()).toBe("•••••••");
  expect(session.serialize("markdown")).toBe("•••••••");
  expect(session.serialize("json")).not.toContain("secret");
  expect(JSON.parse(session.serialize("json"))).toEqual({
    type: "text/plain",
    text: "•••••••",
    masked: true,
  });

  session.execute("select-all");
  expect(await session.copy()).toBe("•••••••");
  expect(clipboard).toBe("•••••••");
  expect(await session.cut()).toBe("•••••••");
  expect(privateValue).toBe("");
  expect(session.serialize()).toBe("");

  expect(await session.paste()).toBe(true);
  expect(privateValue).toBe("replacement");
  expect(session.serialize()).toBe("•••••••••••");
  expect(session.snapshot().document.text).not.toContain("replacement");
});

test("editor invariant diagnostics reject invalid selection sets", () => {
  const sessionWith = (selections: readonly ReturnType<typeof selection>[]) =>
    ({
      snapshot: () => ({
        selections,
      }),
    }) as never;
  expect(() => assertEditorInvariant(sessionWith([]))).toThrow(
    "at least one selection",
  );
  expect(() =>
    assertEditorInvariant(
      sessionWith([selection(position(0, 0)), selection(position(0, 1))]),
    ),
  ).toThrow("more than one primary");
  expect(() =>
    assertEditorInvariant(
      sessionWith([
        {
          anchor: { line: -1, column: 0 },
          head: { line: 0, column: 0 },
          primary: true,
        },
      ]),
    ),
  ).toThrow("cannot be negative");
});

test("buffer transactions preserve Unicode and history properties", () => {
  let seed = 0x5eed;
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const values = ["a", "界", "e\u0301", "🙂", "\n"];
  const session = new TextBufferSession();
  const history = [""];
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const before = session.serialize();
    const graphemes = [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        before,
      ),
    ];
    const offset = Math.floor(random() * (graphemes.length + 1));
    const prefix = graphemes
      .slice(0, offset)
      .map((item) => item.segment)
      .join("");
    const suffix = graphemes
      .slice(offset)
      .map((item) => item.segment)
      .join("");
    const inserted = values[Math.floor(random() * values.length)] ?? "";
    const next = prefix + inserted + suffix;
    session.dispatch({
      changes: [
        {
          range: selection(
            position(0, 0),
            session.search(/[\s\S]*/u)[0]?.head ?? position(0, 0),
          ),
          insert: next,
        },
      ],
    });
    history.push(next);
    expect(session.serialize()).toBe(next);
    assertEditorInvariant(session);
  }
  for (let index = history.length - 2; index >= 0; index -= 1) {
    expect(session.undo()).toBe(true);
    expect(session.serialize()).toBe(history[index] ?? "");
    assertEditorInvariant(session);
  }
});

test("provider registration preserves defaults and resolves capabilities", () => {
  const registry = new EditorProviderRegistry();
  registry.register(textBufferProvider, { default: true });
  expect(registry.resolve(undefined, { capabilities: ["history"] })).toBe(
    textBufferProvider,
  );
  expect(() =>
    registry.register(
      { ...textBufferProvider, id: "other" },
      { default: true },
    ),
  ).toThrow("cannot be replaced");
});

test("buffer command, observer, serialization, viewport, provider, and disposal lifecycle", () => {
  const session = new TextBufferSession({ value: "abc" });
  let snapshots = 0;
  const unsubscribe = session.subscribe(() => {
    snapshots += 1;
  });
  expect(session.execute("cursor-end")).toBe(true);
  expect(session.execute("cursor-start")).toBe(true);
  expect(session.execute("select-all")).toBe(true);
  expect(session.execute("delete-selection")).toBe(true);
  expect(session.execute("unknown")).toBe(false);
  expect(
    session.execute({
      id: "insert",
      title: "Insert",
      execute(target) {
        insertText(target, "x");
        return true;
      },
    }),
  ).toBe(true);
  session.setViewportAnchor(position(99, 99));
  expect(session.snapshot().viewportAnchor).toEqual(position(0, 1));
  expect(session.serialize("json")).toContain('"text":"x"');
  expect(
    applyEditorTransactions(session, [
      { selections: [selection(position(0, 0))] },
    ]).selections[0]?.head,
  ).toEqual(position(0, 0));
  unsubscribe();
  expect(snapshots).toBeGreaterThan(0);
  session.dispose();
  expect(() => session.snapshot()).not.toThrow();
  expect(() => session.dispatch({})).toThrow("disposed");

  const registry = new EditorProviderRegistry();
  const registration = registry.register(textBufferProvider, { default: true });
  expect(registration.default).toBeTrue();
  expect(registry.list()).toEqual([textBufferProvider]);
  expect(registry.resolve("tuil-buffer", { documentType: "text/plain" })).toBe(
    textBufferProvider,
  );
  expect(() =>
    registry.resolve("tuil-buffer", { capabilities: ["rich-document"] }),
  ).toThrow("No compatible");
  registration.dispose();
  registration.dispose();
  expect(() => registry.resolve()).toThrow("No compatible");
});

test("vim mode supports motions, insert, operators, search, counts, and history", () => {
  const vim = new VimEditorSession({ value: "one two\nthree" });
  vim.key("w");
  vim.key("i");
  vim.key("X");
  vim.key("escape");
  expect(vim.serialize()).toContain("X");
  vim.key("0");
  vim.key("d");
  vim.key("d");
  expect(vim.serialize()).toBe("three");
  vim.key("u");
  expect(vim.serialize()).toContain("one");
  expect(vim.vimState().mode).toBe("normal");
});

test("vim mode supports named registers, marks, repeat search, leader maps, and command mode", () => {
  const vim = new VimEditorSession({
    value: "one two one",
    leader: " ",
    keymap: { " x": "i" },
  });
  vim.key('"');
  vim.key("a");
  vim.key("y");
  vim.key("w");
  expect(vim.vimState().registers["a"]).toBe("one ");
  vim.key("$");
  vim.key("m");
  vim.key("z");
  vim.key("0");
  vim.key("'");
  vim.key("z");
  expect(vim.snapshot().selections[0]?.head.column).toBe(11);
  vim.key("p");
  expect(vim.serialize()).toBe("one two oneone ");
  vim.key("/");
  for (const key of "one") vim.key(key);
  vim.key("enter");
  vim.key("n");
  expect(vim.snapshot().selections[0]?.head.line).toBe(0);
  vim.key(" ");
  vim.key("x");
  expect(vim.vimState().mode).toBe("insert");
});

test("vim backward and Unicode operators preserve exact registers", () => {
  const backward = new VimEditorSession({ value: "one two three" });
  backward.key("$");
  backward.key("d");
  backward.key("b");
  expect(backward.vimState().registers['"']).toBe("three");
  expect(backward.serialize()).toBe("one two ");

  const unicode = new VimEditorSession({ value: "🙂e\u0301界" });
  unicode.key("$");
  unicode.key("d");
  unicode.key("h");
  expect(unicode.vimState().registers['"']).toBe("界");
  expect(unicode.serialize()).toBe("🙂e\u0301");

  const multiline = new VimEditorSession({ value: "alpha\nbeta\ngamma" });
  multiline.key("j");
  multiline.key("d");
  multiline.key("k");
  expect(multiline.vimState().registers['"']).toBe("alpha\n");
  expect(multiline.serialize()).toBe("beta\ngamma");
});

test("vim cancellation, backspace, change, visual, counts, and command history are deterministic", () => {
  const vim = new VimEditorSession({ value: "alpha beta\ngamma" });
  vim.key("i");
  expect(vim.key("backspace")).toBe(false);
  vim.key("X");
  expect(vim.key("backspace")).toBe(true);
  vim.key("escape");
  vim.key("2");
  vim.key("l");
  vim.key("b");
  vim.key("v");
  vim.key("w");
  vim.key("escape");
  vim.key("c");
  vim.key("w");
  expect(vim.vimState().mode).toBe("insert");
  vim.key("Z");
  vim.key("escape");
  vim.key(":");
  for (const key of "undo") vim.key(key);
  vim.key("enter");
  vim.key(":");
  for (const key of "redo") vim.key(key);
  vim.key("enter");
  expect(vim.key("escape")).toBe(true);
  expect(vim.serialize()).toContain("Z");
  expect(vimEditorProvider.create({ value: "provider" }).serialize()).toBe(
    "provider",
  );
});

test("vim visual and visual-line operators update registers and modes", () => {
  const deleted = new VimEditorSession({ value: "alpha beta" });
  deleted.key("v");
  deleted.key("w");
  deleted.key("d");
  expect(deleted.serialize()).toBe("beta");
  expect(deleted.vimState().registers['"']).toBe("alpha ");
  expect(deleted.vimState().mode).toBe("normal");

  const yanked = new VimEditorSession({ value: "one two" });
  yanked.key('"');
  yanked.key("a");
  yanked.key("v");
  yanked.key("w");
  yanked.key("y");
  expect(yanked.serialize()).toBe("one two");
  expect(yanked.vimState().registers["a"]).toBe("one ");
  expect(yanked.vimState().mode).toBe("normal");

  const changed = new VimEditorSession({ value: "one two" });
  changed.key("v");
  changed.key("w");
  changed.key("c");
  expect(changed.vimState().registers['"']).toBe("one ");
  expect(changed.vimState().mode).toBe("insert");
  changed.key("🙂");
  changed.key("escape");
  expect(changed.serialize()).toBe("🙂two");

  const linewise = new VimEditorSession({ value: "first\nsecond" });
  linewise.key("V");
  linewise.key("y");
  expect(linewise.vimState().registers['"']).toBe("first\n");
  expect(linewise.serialize()).toBe("first\nsecond");
  linewise.key("V");
  linewise.key("d");
  expect(linewise.serialize()).toBe("second");
});

test("vim repeat records insert backspace by grapheme", () => {
  const vim = new VimEditorSession();
  vim.key("i");
  vim.key("🙂");
  vim.key("e\u0301");
  vim.key("backspace");
  vim.key("escape");
  expect(vim.serialize()).toBe("🙂");

  vim.key(".");
  expect(vim.serialize()).toBe("🙂🙂");
  expect(vim.serialize()).not.toContain("\uFFFD");
});

test("rich documents transact, serialize, project, and preserve history", () => {
  const rich = new RichDocumentSession({
    type: "document",
    children: [
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "hello",
            marks: [{ type: "bold" }],
          },
        ],
      },
    ],
  });
  expect(rich.serialize("markdown")).toBe("**hello**\n\n");
  rich.dispatch({
    path: [0],
    node: {
      type: "heading",
      level: 2,
      children: [{ type: "text", text: "Title" }],
    },
  });
  expect(projectRichDocument(rich.snapshot().root, 10)[0]).toBe("## Title");
  expect(rich.undo()).toBe(true);
  expect(rich.redo()).toBe(true);
  expect(rich.undo()).toBe(true);
  rich.dispatch({
    path: [],
    node: { type: "document", children: [{ type: "text", text: "branch" }] },
  });
  expect(rich.redo()).toBe(false);
});

test("rich provider returns a rich transactional session", () => {
  const session = richEditorProvider.create({
    id: "rich-provider",
    value: JSON.stringify({
      type: "document",
      children: [{ type: "paragraph", children: [] }],
    }),
  });
  expect(session).toBeInstanceOf(RichEditorSession);
  const rich = session as RichEditorSession;
  rich.transact({
    path: [0],
    node: {
      type: "heading",
      level: 2,
      children: [
        { type: "text", text: "Architecture", marks: [{ type: "bold" }] },
      ],
    },
  });
  expect(rich.richSnapshot().root.children?.[0]?.type).toBe("heading");
  expect(rich.serialize("markdown")).toContain("## **Architecture**");
  expect(rich.serialize("json")).toContain('"heading"');
  session.dispose();
});

test("rich editor keeps transactions, projections, and history in one state", () => {
  const rich = new RichEditorSession({
    value: JSON.stringify({
      type: "document",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "before" }],
        },
      ],
    }),
  });
  const initial = rich.serialize("json");
  rich.rich.dispatch({
    path: [0],
    node: {
      type: "heading",
      level: 1,
      children: [{ type: "text", text: "after" }],
    },
  });
  expect(rich.richSnapshot().root.children?.[0]?.type).toBe("heading");
  expect(rich.serialize("markdown")).toBe("# after\n\n");
  expect(rich.snapshot().document.text).toBe("after\n");
  expect(rich.undo()).toBeTrue();
  expect(rich.serialize("json")).toBe(initial);
  expect(rich.serialize("markdown")).toBe("before\n\n");
  expect(rich.redo()).toBeTrue();
  expect(rich.serialize("markdown")).toBe("# after\n\n");

  rich.replace("after", "final");
  expect(rich.richSnapshot().root.children?.[0]?.children?.[0]?.text).toBe(
    "final",
  );
  expect(rich.undo()).toBeTrue();
  expect(rich.serialize("markdown")).toBe("# after\n\n");
  expect(rich.redo()).toBeTrue();
  expect(rich.serialize("markdown")).toBe("# final\n\n");
});

test("rich editor rejects shared edits across structural separators", () => {
  const rich = new RichEditorSession({
    value: JSON.stringify({
      type: "document",
      children: [
        { type: "paragraph", children: [{ type: "text", text: "safe" }] },
        { type: "paragraph", children: [{ type: "text", text: "next" }] },
      ],
    }),
  });
  const before = rich.snapshot();
  expect(() =>
    rich.dispatch({
      changes: [
        {
          range: {
            anchor: { line: 0, column: 0 },
            head: { line: 1, column: 1 },
          },
          insert: "",
        },
      ],
    }),
  ).toThrow("structural separators");
  expect(rich.snapshot()).toEqual(before);
  expect(rich.undo()).toBeFalse();
});

test("rich editor searches and replaces document text without matching JSON metadata", () => {
  const rich = new RichEditorSession({
    value: JSON.stringify({
      type: "document",
      attributes: { searchableMetadata: "metadata-only" },
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", text: "hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
          ],
        },
      ],
    }),
  });
  expect(rich.search("metadata-only")).toEqual([]);
  expect(rich.search("hello world")).toHaveLength(1);
  expect(rich.replace("hello world", "welcome")).toBe(1);
  expect(rich.snapshot().document.text).toBe("welcome\n");
  expect(rich.serialize("markdown")).toBe("welcome\n\n");
  expect(rich.undo()).toBeTrue();
  expect(rich.snapshot().document.text).toBe("hello world\n");
});

test("unknown plugin nodes round-trip losslessly and opt into provider behavior", () => {
  const source = {
    type: "document",
    children: [
      {
        type: "callout",
        attributes: { tone: "warning" },
        pluginData: { revision: 2 },
        children: [{ type: "text", text: "Caution" }],
      },
    ],
  };
  const provider = createRichEditorProvider({
    nodes: [
      {
        type: "callout",
        validate(node) {
          if (node.attributes?.["tone"] !== "warning") {
            throw new Error("Callout tone is invalid");
          }
        },
        markdown: (_node, children) => `> [!WARNING] ${children}\n`,
      },
    ],
  });
  const rich = provider.create({
    value: JSON.stringify(source),
  }) as RichEditorSession;
  expect(JSON.parse(rich.serialize("json")).root).toEqual(source);
  expect(rich.serialize("markdown")).toBe("> [!WARNING] Caution\n");
  rich.replace("Caution", "Stop");
  expect(
    JSON.parse(rich.serialize("json")).root.children[0].pluginData,
  ).toEqual({ revision: 2 });
  expect(rich.serialize("markdown")).toBe("> [!WARNING] Stop\n");

  const generic = new RichEditorSession({ value: JSON.stringify(source) });
  expect(JSON.parse(generic.serialize("json")).root).toEqual(source);
  expect(generic.snapshot().document.text).toBe("Caution");
});

test("rich text projection preserves empty block boundaries", () => {
  const rich = new RichEditorSession({
    value: JSON.stringify({
      type: "document",
      children: [
        { type: "paragraph", children: [] },
        { type: "paragraph", children: [] },
        { type: "paragraph", children: [{ type: "text", text: "after" }] },
      ],
    }),
  });
  expect(rich.snapshot().document.text).toBe("\n\nafter\n");
  expect(() =>
    createRichEditorProvider({
      nodes: [{ type: "paragraph" }],
    }),
  ).toThrow("cannot replace a built-in node");
});

test("large editor buffers remain responsive and stable across widths", () => {
  const value = Array.from(
    { length: 10_000 },
    (_, index) => `line ${index}`,
  ).join("\n");
  const started = performance.now();
  const session = new TextBufferSession({ value });
  session.dispatch({
    selections: [selection(position(9_999, 9))],
  });
  insertText(session, "!");
  expect(session.serialize()).toEndWith("line 9999!");
  expect(performance.now() - started).toBeLessThan(250);
});
