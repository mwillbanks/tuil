import { expect, test } from "bun:test";
import {
  StreamingPipeline,
  builtInDocumentTransformers,
  builtInFormatParsers,
} from "../../packages/streaming/src/index.ts";
function parser(id: string) {
  return builtInFormatParsers.find((value) => value.id === id)!;
}
test("JSON-LD relationships omit null values and preserve ordinary object links", () => {
  const input = parser("jsonld").parse(
    '{"@id":"service","optional":null,"dependsOn":{"@id":"database"}}',
    true,
  );
  expect(
    builtInDocumentTransformers.jsonLdToRelationships
      .transform(input)
      .root.children?.map((node) => node.value),
  ).toEqual([{ from: "service", relation: "dependsOn", to: "database" }]);
});
test("format detection retains leading chunks when choosing a parser later", async () => {
  const pipeline = new StreamingPipeline();
  await pipeline.write("#");
  await pipeline.write(" title\n");
  const result = await pipeline.end();
  expect(result.format).toBe("markdown");
  expect(result.source).toBe("# title\n");
  expect(result.root.children?.[0]?.type).toBe("heading");
});
