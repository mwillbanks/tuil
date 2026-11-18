import { expect, test } from "bun:test";
import {
  DiffModel,
  resolveJsonPath,
  StructuredContentModel,
} from "../../packages/content/src/index.ts";

test("structured content expands shared references and cuts off real cycles", () => {
  const shared = { "quoted.key": null, label: "Same" };
  const value: Record<string, unknown> = { first: shared, second: shared };
  value["cycle"] = value;
  const model = new StructuredContentModel(value, false);
  expect(model.rows()).toHaveLength(1);
  expect(model.search(/Same/g).map((row) => row.path)).toEqual([
    "$.first.label",
    "$.second.label",
  ]);
  expect(model.rows().map((row) => row.path)).toContain(
    '$.second["quoted.key"]',
  );
  const copy = JSON.parse(model.copy("$", "json"));
  expect(copy).toEqual({ first: shared, second: shared, cycle: "[Circular]" });
  expect(model.format("$.first.label")).toBe("Same");
  expect(model.format('$.second["quoted.key"]')).toBe("null");
  expect(resolveJsonPath(value, "$.first.label.impossible")).toBeUndefined();
  expect(() => resolveJsonPath(value, "first.label")).toThrow(
    "Invalid JSON path",
  );
  model.select("$.first");
  model.select("$.second", true);
  expect(model.selected()).toEqual(["$.first", "$.second"]);
});

test("diff collapse keeps only the requested context at thresholds one and two", () => {
  const diff = new DiffModel("@@ -1,4 +1,4 @@\n A\n B\n C\n D");
  const concise = diff.render("unified", { collapseUnchangedAfter: 1 });
  expect(concise).toHaveLength(3);
  expect(concise[1]).toContain(" A");
  expect(concise[2]).toBe("… 3 unchanged lines …");
  const centered = diff.render("unified", { collapseUnchangedAfter: 2 });
  expect(centered).toHaveLength(4);
  expect(centered[3]).toContain(" D");
  expect(diff.search(/[BD]/g)).toEqual([2, 4]);
  expect(diff.hunkPatch(4)).toBe("");
  expect(new DiffModel("plain").navigate(1)).toBe(-1);
});
