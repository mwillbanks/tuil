import { describe, expect, test } from "bun:test";
import { parseInkRendererScene } from "./renderer-scene.ts";

describe("Ink renderer scene projection", () => {
  test("projects SGR attributes, palette colors, resets, and newlines", () => {
    const scene = parseInkRendererScene(
      [
        "\u001b[1;2;3;4;7;9;31;44mstyled",
        "\u001b[22;23;24;27;29;39;49mplain",
        "\n\u001b[91;104mbright",
      ].join(""),
      [{ role: "status", label: "Scene" }],
    );

    expect(scene.lines).toEqual(["styledplain", "bright"]);
    expect(scene.semantics).toEqual([{ role: "status", label: "Scene" }]);
    expect(scene.styledLines?.[0]?.[0]).toEqual({
      text: "styled",
      style: {
        bold: true,
        dim: true,
        italic: true,
        underline: true,
        inverse: true,
        strike: true,
        foreground: { kind: "indexed", value: 1 },
        background: { kind: "indexed", value: 4 },
      },
      link: undefined,
    });
    expect(scene.styledLines?.[0]?.[1]).toEqual({
      text: "plain",
      style: {},
      link: undefined,
    });
    expect(scene.styledLines?.[1]?.[0]?.style).toEqual({
      foreground: { kind: "indexed", value: 9 },
      background: { kind: "indexed", value: 12 },
    });
  });

  test("projects indexed, grayscale, RGB, and reset color sequences", () => {
    const scene = parseInkRendererScene(
      [
        "\u001b[38;5;0mansi",
        "\u001b[38;5;16m cube",
        "\u001b[38;5;232m gray",
        "\u001b[48;2;300;16;999m rgb",
        "\u001b[38;6m ignored",
        "\u001b[0m reset",
      ].join(""),
      [],
    );
    const runs = scene.styledLines?.[0] ?? [];

    expect(runs.map((run) => run.style)).toEqual([
      { foreground: { kind: "indexed", value: 0 } },
      { foreground: { kind: "indexed", value: 16 } },
      { foreground: { kind: "indexed", value: 232 } },
      {
        foreground: { kind: "indexed", value: 232 },
        background: { kind: "rgb", red: 255, green: 16, blue: 255 },
      },
      {
        foreground: { kind: "indexed", value: 232 },
        background: { kind: "rgb", red: 255, green: 16, blue: 255 },
      },
      {},
    ]);
  });

  test("projects OSC 8 hyperlinks with BEL and string terminators", () => {
    const scene = parseInkRendererScene(
      [
        "\u001b]8;;https://example.test\u0007linked\u001b]8;;\u0007",
        " plain ",
        "\u001b]8;;mailto:test@example.test\u001b\\mail\u001b]8;;\u001b\\",
      ].join(""),
      [],
    );
    const runs = scene.styledLines?.[0] ?? [];

    expect(runs.map((run) => [run.text, run.link])).toEqual([
      ["linked", "https://example.test"],
      [" plain ", undefined],
      ["mail", "mailto:test@example.test"],
    ]);
  });

  test("keeps carriage-return newlines and unstyled frames deterministic", () => {
    const scene = parseInkRendererScene("first\r\nsecond", []);
    expect(scene.lines).toEqual(["first", "second"]);
    expect(scene.styledLines).toEqual([
      [{ text: "first", style: {}, link: undefined }],
      [{ text: "second", style: {}, link: undefined }],
    ]);
    expect(parseInkRendererScene("", []).styledLines).toEqual([[]]);
  });
});
