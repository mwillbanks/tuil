import { expect, test } from "bun:test";
import {
  CellBuffer,
  emptyCell,
  encodeCellOutput,
} from "../../packages/cell/src/index.ts";
test("split combining marks preserve the leading wide grapheme and continuation", () => {
  const buffer = new CellBuffer(4, 1);
  const next = buffer.write(0, 0, "界");
  buffer.write(next, 0, "\u0301");
  expect(buffer.get(0, 0)?.grapheme).toBe("界\u0301");
  expect(buffer.get(1, 0)?.continuation).toBe(true);
  expect(
    new TextDecoder().decode(encodeCellOutput(buffer.frame(), "static").bytes),
  ).toBe("界\u0301");
});
test("a clipped wide leading cell never creates an orphan continuation", () => {
  const buffer = new CellBuffer(4, 1);
  buffer.fill(
    { x: 0, y: 0, width: 4, height: 1 },
    { ...emptyCell, grapheme: "." },
  );
  buffer.write(0, 0, "界A", {}, { x: 1, y: 0, width: 3, height: 1 });
  expect(buffer.get(0, 0)?.grapheme).toBe(".");
  expect(buffer.get(1, 0)?.continuation).not.toBe(true);
  expect(buffer.get(1, 0)?.grapheme).toBe(".");
  expect(buffer.get(2, 0)?.grapheme).toBe("A");
});
