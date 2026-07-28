import { expect, test } from "bun:test";
import {
  builtInContentProjections,
  DiffModel,
  resolveJsonPath,
  StructuredContentModel,
} from "./index.ts";

test("structured content expands, searches, selects, and copies paths and values", () => {
  const value = { user: { id: 42, tags: ["admin"] } };
  const model = new StructuredContentModel(value);
  expect(model.rows()).toHaveLength(2);
  model.expandAll();
  expect(model.search("admin")[0]?.path).toBe("$.user.tags[0]");
  model.select("$.user.id");
  expect(model.selected()).toEqual(["$.user.id"]);
  expect(model.copy("$.user.id", "text")).toBe("42");
  expect(model.copy("$.user", "json")).toContain('"id": 42');
  expect(resolveJsonPath(value, "$.user.tags[0]")).toBe("admin");
  model.collapseAll();
  expect(model.rows()).toHaveLength(1);
});

test("structured content supports bounded viewports and custom type renderers", () => {
  const model = new StructuredContentModel(
    { createdAt: new Date("2026-01-01T00:00:00Z"), values: [1, 2, 3] },
    true,
    [
      {
        test: (value) => value instanceof Date,
        render: (value) => (value as Date).toISOString(),
      },
    ],
  );
  model.expandAll();
  expect(model.viewport(0, 2)).toHaveLength(2);
  expect(model.format("$.createdAt")).toBe("2026-01-01T00:00:00.000Z");
  model.toggle("$.values");
  model.toggle("$.values");
  expect(model.format("$.values[0]")).toBe("1");
  expect(model.copy("$.values[0]", "path")).toBe("$.values[0]");
  expect(model.copy("$.values[0]", "text")).toBe("1");
  expect(model.copy("$.values[0]", "json")).toBe("1");
});

test("diff model renders unified/split views, navigation, search, and patches", () => {
  const source = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n-old\n+new\n same";
  const diff = new DiffModel(source);
  expect(diff.hunks()).toEqual([2]);
  expect(diff.navigate(1)).toBe(2);
  expect(diff.search("new")).toEqual([4]);
  expect(diff.render("split")[3]).toContain("│ new");
  expect(diff.hunkPatch(0)).toContain("+new");
  expect(diff.resolveHunk(0, "apply")).toContain("new");
  expect(diff.resolveHunk(0, "reject")).toContain("old");
  expect(diff.selectLines(2, 4)).toContain("@@");
  expect(diff.copyPatch()).toBe(source);
  expect(diff.render("unified", { collapseUnchangedAfter: 1 })).toBeDefined();
  expect(diff.navigate(-1)).toBe(2);
});

test("content projections provide raw, tree, and table views", async () => {
  const document = {
    format: "jsonl",
    complete: true,
    source: '{"x":1}',
    diagnostics: [],
    root: {
      type: "records",
      children: [{ type: "record", value: { x: 1 }, raw: '{"x":1}' }],
    },
  };
  const controller = new AbortController();
  const values = await Promise.all(
    builtInContentProjections.map((projection) =>
      projection.project(document, { signal: controller.signal }),
    ),
  );
  expect(values[0]).toBe('{"x":1}');
  expect(values[1]).toEqual(["records", '  {"x":1}']);
  expect(values[2]).toEqual([
    { type: "record", value: { x: 1 }, raw: '{"x":1}' },
  ]);
  const arrayDocument = {
    ...document,
    root: { type: "records", value: [{ x: 1 }, "plain"] },
  };
  expect(
    await builtInContentProjections[2]?.project(arrayDocument, {
      signal: controller.signal,
    }),
  ).toEqual([{ x: 1 }, { value: "plain" }]);
});
