import { expect, test } from "bun:test";
import { type FunctionComponent, type ReactElement } from "react";
import {
  createTuilGhosttyDocumentApp,
  createTuilGhosttyDocumentSession,
  generatePlaygroundTsx,
  playgroundComponentCatalog,
  type PlaygroundDocumentV1,
  type PlaygroundNodeV1,
  validatePlaygroundDocument,
} from "./document";

const node = (
  id = "root",
  props: Record<string, unknown> = {},
): PlaygroundNodeV1 => ({ id, component: "Text", props });
function document(
  root = node(),
  terminal: Partial<PlaygroundDocumentV1["terminal"]> = {},
): PlaygroundDocumentV1 {
  return {
    version: 1,
    root,
    terminal: { width: 80, height: 24, theme: "default-dark", ...terminal },
  };
}

test("playground dimensions and version validation preserve exact supported boundaries", () => {
  for (const [width, height] of [
    [20, 8],
    [240, 100],
  ]) {
    const value = document(node(), { width, height });
    expect(validatePlaygroundDocument(value)).toBe(value);
  }
  for (const width of [19, 241, 20.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      validatePlaygroundDocument(document(node(), { width })),
    ).toThrow("Terminal width");
  }
  for (const height of [7, 101, 8.5, Number.NaN]) {
    expect(() =>
      validatePlaygroundDocument(document(node(), { height })),
    ).toThrow("Terminal height");
  }
  expect(() =>
    validatePlaygroundDocument({
      ...document(),
      version: 2,
    } as unknown as PlaygroundDocumentV1),
  ).toThrow("Unsupported playground document version");
});

test("playground tree and slot limits reject malformed relationships", () => {
  for (const id of ["Uppercase", "a".repeat(65), "", "bad/id"]) {
    expect(() => validatePlaygroundDocument(document(node(id)))).toThrow(
      "Invalid or duplicate node id",
    );
  }
  for (const slot of ["bad-slot", "statusBar"]) {
    expect(() =>
      validatePlaygroundDocument(
        document({ ...node(), slots: { [slot]: [] } }),
      ),
    ).toThrow(slot === "bad-slot" ? "Invalid slot" : "Unsupported Text slot");
  }
  let deep = node("leaf");
  for (let index = 0; index < 33; index++)
    deep = { ...node("depth-" + index), children: [deep] };
  expect(() => validatePlaygroundDocument(document(deep))).toThrow(
    "at most 32 nodes deep",
  );
  const children = Array.from({ length: 199 }, (_, index) =>
    node("child-" + index),
  );
  expect(
    validatePlaygroundDocument(document({ ...node(), children })).root.children,
  ).toHaveLength(199);
  expect(() =>
    validatePlaygroundDocument(
      document({ ...node(), children: [...children, node("too-many")] }),
    ),
  ).toThrow("at most 200 nodes");
  expect(() =>
    validatePlaygroundDocument(
      document({
        id: "shell",
        component: "AppShell",
        props: {},
        slots: { main: [node("same")], statusBar: [node("same")] },
      }),
    ),
  ).toThrow("duplicate node id");
});

test("playground JSON props accept nested data and reject unsafe values, cycles, and depth", () => {
  const shared = { value: [null, true, "text", 42] };
  const valid = document(node("root", { children: [shared, shared] }));
  expect(validatePlaygroundDocument(valid)).toBe(valid);
  for (const value of [undefined, () => "function", Symbol("symbol"), 1n]) {
    expect(() =>
      validatePlaygroundDocument(document(node("root", { children: value }))),
    ).toThrow("must be JSON-safe");
  }
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  expect(() =>
    validatePlaygroundDocument(document(node("root", { children: cyclic }))),
  ).toThrow("contains a cycle");
  let nested: unknown = "end";
  for (let index = 0; index < 33; index++) nested = [nested];
  expect(() =>
    validatePlaygroundDocument(document(node("root", { children: nested }))),
  ).toThrow("exceeds the maximum depth");
});

test("document applications render declared slots and preserve terminal configuration", async () => {
  const root: PlaygroundNodeV1 = {
    id: "shell",
    component: "AppShell",
    props: { padding: 1 },
    children: [node("direct", { children: "Direct" })],
    slots: {
      appBar: [node("title", { children: "Title" })],
      main: [{ id: "button", component: "Button", props: { label: "Run" } }],
      statusBar: [node("status", { children: "Ready" })],
    },
  };
  const value = document(root, {
    colorDepth: 4,
    unicode: false,
    reducedMotion: true,
  });
  const app = createTuilGhosttyDocumentApp(value);
  const defaults = createTuilGhosttyDocumentApp(document());
  try {
    expect(app.capabilities).toMatchObject({
      width: 80,
      height: 24,
      colorDepth: 4,
      unicode: false,
      reducedMotion: true,
    });
    expect(defaults.capabilities).toMatchObject({
      colorDepth: 24,
      unicode: true,
      reducedMotion: false,
    });
    const tree = (app.component as FunctionComponent)({}) as ReactElement<{
      id: string;
      children: ReactElement[];
    }>;
    expect(tree.props.id).toBe("shell");
    expect(tree.props.children).toHaveLength(4);
    const [bar, main, direct, status] = tree.props.children;
    expect(bar?.key).toBe("appBar");
    expect(main?.key).toBe("main");
    expect(direct?.props).toMatchObject({ id: "direct", children: "Direct" });
    expect(status?.key).toBe("statusBar");
    const mainChildren = main?.props as {
      children: ReactElement<{ children: string }>[];
    };
    expect(mainChildren.children[0]?.props.children).toBe("Run");
    const source = generatePlaygroundTsx(value);
    expect(source).toContain("<AppShell.AppBar>");
    expect(source).toContain("<AppShell.Main>");
    expect(source).toContain("<AppShell.StatusBar>");
    expect(source).toContain('label={"Run"}');
    expect(source).toContain('id="direct" children={"Direct"}');
    expect(source).toBe(generatePlaygroundTsx(value));
  } finally {
    await app.stop();
    await defaults.stop();
  }
});

test("document sessions retain the previous snapshot when updates are invalid", async () => {
  const initial = document();
  const session = createTuilGhosttyDocumentSession(initial);
  try {
    expect(session.getDocument()).toBe(initial);
    expect(session.app.capabilities).toMatchObject({
      width: 80,
      height: 24,
      colorDepth: 24,
      unicode: true,
      reducedMotion: false,
    });
    const changed = document(node("changed", { children: "Updated" }));
    session.update(changed);
    expect(session.getDocument()).toBe(changed);
    expect(() => session.update(document(node(), { width: 0 }))).toThrow(
      "Terminal width",
    );
    expect(session.getDocument()).toBe(changed);
    expect(
      playgroundComponentCatalog.find((entry) => entry.component === "AppShell")
        ?.slots,
    ).toEqual(["appBar", "main", "statusBar"]);
    expect(Object.isFrozen(playgroundComponentCatalog)).toBeTrue();
  } finally {
    await session.app.stop();
  }
});

test("document surfaces expose plain children and empty shells without phantom regions", async () => {
  const app = createTuilGhosttyDocumentApp(
    document({ id: "empty-shell", component: "AppShell", props: {} }),
  );
  const plain = createTuilGhosttyDocumentApp(document(node("plain")));
  try {
    const tree = (app.component as FunctionComponent)({}) as ReactElement<{
      children: unknown[];
    }>;
    expect(tree.props.children).toEqual([]);
    const child = (plain.component as FunctionComponent)({}) as ReactElement<{
      children: unknown[];
    }>;
    expect(child.props.children).toEqual([]);
  } finally {
    await app.stop();
    await plain.stop();
  }
});
