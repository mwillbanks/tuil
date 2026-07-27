import { expect, test } from "bun:test";
import { renderTerminalImage } from "./image.tsx";

test("terminal image renderer validates RGBA sources and scales output", () => {
  const source = {
    width: 2,
    height: 4,
    data: new Uint8Array(2 * 4 * 4).fill(255),
  };
  const rendered = renderTerminalImage(source, 4, false);
  expect(rendered.split("\n")).toHaveLength(4);
  expect(rendered.split("\n").every((line) => line.length === 4)).toBeTrue();
  expect(() =>
    renderTerminalImage({ ...source, data: new Uint8Array(3) }),
  ).toThrow("width × height RGBA");
  expect(() => renderTerminalImage({ ...source, width: 0 })).toThrow(
    "width × height RGBA",
  );
  expect(() =>
    renderTerminalImage({
      ...source,
      width: 1.5,
      data: new Uint8Array(1.5 * source.height * 4),
    }),
  ).toThrow("width × height RGBA");
  expect(() => renderTerminalImage(source, Number.NaN)).toThrow(
    "finite number",
  );
});
