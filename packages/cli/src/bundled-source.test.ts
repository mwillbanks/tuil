import { expect, test } from "bun:test";
import { BundledRegistrySource } from "./bundled-source.ts";

test("bundled registry source lists and resolves source-owned items", async () => {
  const source = new BundledRegistrySource();
  const items = await source.list();
  expect(items.length).toBeGreaterThan(0);
  const first = items[0];
  if (!first) throw new Error("Bundled registry is empty");
  expect(await source.get(first.name)).toMatchObject({
    name: first.name,
    type: first.type,
  });
  expect(await source.get("missing-item")).toBeUndefined();
});
