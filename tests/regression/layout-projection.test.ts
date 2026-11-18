import { expect, test } from "bun:test";
import {
  LayoutProjection,
  type LayoutNodeInput,
} from "../../packages/renderer/src/index.ts";

function node(id: string, parentId?: string): LayoutNodeInput {
  return {
    id,
    parentId,
    bounds: { x: 0, y: 0, width: 5, height: 5 },
    clip: { x: 0, y: 0, width: 20, height: 20 },
    zIndex: 0,
    focusable: true,
    pointerEvents: "auto",
    semantics: { role: "button", label: id },
  };
}

test("upsert rejects unrelated, missing, and omitted child metadata atomically", () => {
  const layout = new LayoutProjection();
  layout.reconcile([node("root"), node("child", "root"), node("unrelated")]);
  const before = layout.snapshot();
  for (const children of [["unrelated"], ["missing"], []]) {
    expect(() => layout.upsert({ ...node("root"), children })).toThrow(
      "children inconsistent",
    );
    expect(layout.snapshot()).toEqual(before);
  }
  layout.upsert({ ...node("root"), children: ["child", "child"] });
  expect(layout.get("root")?.children).toEqual(["child"]);
  layout.remove("root");
  expect(layout.nodes().map((item) => item.id)).toEqual(["unrelated"]);
});

test("reconcile validates child metadata against the complete incoming tree", () => {
  const layout = new LayoutProjection();
  layout.reconcile([node("stable")]);
  const before = layout.snapshot();
  for (const children of [["missing"], ["other"], []]) {
    expect(() =>
      layout.reconcile([
        { ...node("root"), children },
        node("child", "root"),
        node("other"),
      ]),
    ).toThrow("children inconsistent");
    expect(layout.snapshot()).toEqual(before);
  }
  const nodes = layout.reconcile([
    node("child", "root"),
    { ...node("root"), children: ["child"] },
  ]);
  expect(nodes[1]?.children).toEqual(["child"]);
  expect(nodes[1]).toBe(layout.get("root"));
  expect(Object.isFrozen(nodes)).toBeTrue();
  expect(Object.isFrozen(nodes[1]?.children)).toBeTrue();
});

test("reconcile reverses old parentage without transient cycles or deleted survivors", () => {
  const layout = new LayoutProjection();
  layout.reconcile([
    node("old"),
    node("parent", "old"),
    node("child", "parent"),
  ]);
  const nodes = layout.reconcile([
    node("parent", "child"),
    { ...node("child"), children: ["parent"] },
  ]);
  expect(layout.get("old")).toBeUndefined();
  expect(layout.get("parent")?.parentId).toBe("child");
  expect(layout.get("child")?.children).toEqual(["parent"]);
  expect(layout.roots().map((item) => item.id)).toEqual(["child"]);
  expect(nodes[0]).toBe(layout.get("parent"));
  layout.remove("child");
  expect(layout.nodes()).toEqual([]);
});

test("incremental child registration and reparenting derive canonical child lists", () => {
  const layout = new LayoutProjection();
  layout.upsert(node("child", "first"));
  layout.upsert({ ...node("first"), children: ["child"] });
  layout.upsert(node("second"));
  layout.upsert(node("child", "second"));
  expect(layout.get("first")?.children).toEqual([]);
  expect(layout.get("second")?.children).toEqual(["child"]);
  layout.remove("first");
  expect(layout.get("child")?.parentId).toBe("second");
  layout.remove("second");
  expect(layout.nodes()).toEqual([]);
});

test("bounds and clip validation reject non-finite coordinates and negative sizes atomically", () => {
  const layout = new LayoutProjection();
  layout.upsert(node("stable"));
  const before = layout.snapshot();
  for (const rectangle of ["bounds", "clip"] as const) {
    for (const field of ["x", "y", "width", "height"] as const) {
      for (const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ]) {
        const invalid = node("invalid");
        const input = {
          ...invalid,
          [rectangle]: { ...invalid[rectangle], [field]: value },
        };
        expect(() => layout.upsert(input)).toThrow(`invalid ${rectangle}`);
        expect(() => layout.reconcile([node("replacement"), input])).toThrow(
          `invalid ${rectangle}`,
        );
        expect(layout.snapshot()).toEqual(before);
      }
    }
    for (const field of ["width", "height"] as const) {
      const invalid = node("invalid");
      expect(() =>
        layout.upsert({
          ...invalid,
          [rectangle]: { ...invalid[rectangle], [field]: -1 },
        }),
      ).toThrow(`invalid ${rectangle}`);
      expect(layout.snapshot()).toEqual(before);
    }
  }
});

test("finite negative positions and empty clips retain half-open hit testing", () => {
  const layout = new LayoutProjection();
  const input = node("clipped");
  layout.upsert({
    ...input,
    bounds: { x: -1, y: -1, width: 5, height: 5 },
    clip: { x: 0, y: 0, width: 2, height: 2 },
  });
  expect(layout.hitTest(0, 0).map((item) => item.id)).toEqual(["clipped"]);
  expect(layout.hitTest(-1, 0)).toEqual([]);
  expect(layout.hitTest(2, 0)).toEqual([]);
  expect(layout.hitTest(0, 2)).toEqual([]);
  layout.upsert({ ...input, clip: { x: 0, y: 0, width: 0, height: 2 } });
  expect(layout.hitTest(0, 0)).toEqual([]);
});
