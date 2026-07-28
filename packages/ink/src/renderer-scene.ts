import type {
  RendererColor,
  RendererScene,
  RendererTextRun,
  RendererTextStyle,
} from "@mwillbanks/tuil-renderer";

function indexedColor(index: number): RendererColor {
  return Object.freeze({
    kind: "indexed" as const,
    value: Math.max(0, Math.min(255, Math.round(index))),
  });
}

function consumeExtendedColor(
  codes: readonly number[],
  index: number,
): { readonly color?: RendererColor; readonly consumed: number } {
  const mode = codes[index + 1];
  const channels = codes.slice(index + 2, index + 5);
  if (mode === 5) {
    const color = channels[0];
    return color === undefined
      ? { consumed: 0 }
      : { color: indexedColor(color), consumed: 2 };
  }
  if (mode === 2 && channels.length === 3) {
    return {
      color: Object.freeze({
        kind: "rgb" as const,
        red: Math.max(0, Math.min(255, channels[0] ?? 0)),
        green: Math.max(0, Math.min(255, channels[1] ?? 0)),
        blue: Math.max(0, Math.min(255, channels[2] ?? 0)),
      }),
      consumed: 4,
    };
  }
  return { consumed: 0 };
}

type StyleUpdater = (style: RendererTextStyle) => RendererTextStyle;

function enable(property: keyof RendererTextStyle): StyleUpdater {
  return (style) => ({ ...style, [property]: true });
}

function disable(
  ...properties: readonly (keyof RendererTextStyle)[]
): StyleUpdater {
  return (style) => {
    const next = { ...style };
    for (const property of properties) delete next[property];
    return next;
  };
}

function setColor(
  property: "foreground" | "background",
  color: RendererColor,
): StyleUpdater {
  return (style) => ({ ...style, [property]: color });
}

const simpleStyleUpdaters: Readonly<Record<number, StyleUpdater>> =
  Object.freeze(
    Object.fromEntries([
      [0, () => ({})],
      [1, enable("bold")],
      [2, enable("dim")],
      [3, enable("italic")],
      [4, enable("underline")],
      [7, enable("inverse")],
      [9, enable("strike")],
      [22, disable("bold", "dim")],
      [23, disable("italic")],
      [24, disable("underline")],
      [27, disable("inverse")],
      [29, disable("strike")],
      [39, disable("foreground")],
      [49, disable("background")],
      ...Array.from({ length: 8 }, (_, index) => index).flatMap((index) => [
        [30 + index, setColor("foreground", indexedColor(index))],
        [40 + index, setColor("background", indexedColor(index))],
      ]),
      ...Array.from({ length: 8 }, (_, index) => index).flatMap((index) => [
        [90 + index, setColor("foreground", indexedColor(index + 8))],
        [100 + index, setColor("background", indexedColor(index + 8))],
      ]),
    ]),
  );

function applyStyleCode(
  style: RendererTextStyle,
  codes: readonly number[],
  index: number,
): { readonly style: RendererTextStyle; readonly consumed: number } {
  const code = codes[index] ?? 0;
  const update = simpleStyleUpdaters[code];
  if (update) return { style: update(style), consumed: 0 };
  if (code !== 38 && code !== 48) return { style, consumed: 0 };
  const extended = consumeExtendedColor(codes, index);
  if (!extended.color) return { style, consumed: extended.consumed };
  return {
    style: {
      ...style,
      [code === 38 ? "foreground" : "background"]: extended.color,
    },
    consumed: extended.consumed,
  };
}

function updateStyle(
  current: RendererTextStyle,
  sequence: string,
): RendererTextStyle {
  const codes = (sequence ? sequence.split(";") : ["0"]).map(Number);
  let style = { ...current };
  for (let index = 0; index < codes.length; index += 1) {
    const update = applyStyleCode(style, codes, index);
    style = update.style;
    index += update.consumed;
  }
  return Object.freeze(style);
}

export function parseInkRendererScene(
  frame: string,
  semantics: RendererScene["semantics"],
): RendererScene {
  const styledLines: RendererTextRun[][] = [[]];
  let plain = "";
  let style: RendererTextStyle = Object.freeze({});
  let link: string | undefined;
  const bell = "\u0007";
  const pattern =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI SGR and OSC 8 are the input grammar.
    /\u001b\[[0-9;]*m|\u001b\]8;;[^\u0007\u001b]*(?:\u0007|\u001b\\)|\r?\n/g;
  let offset = 0;
  const append = (text: string) => {
    if (!text) return;
    plain += text;
    styledLines.at(-1)?.push(
      Object.freeze({
        text,
        style,
        link,
      }),
    );
  };
  for (const match of frame.matchAll(pattern)) {
    append(frame.slice(offset, match.index));
    const token = match[0];
    if (token.endsWith("m")) {
      style = updateStyle(style, token.slice(2, -1));
    } else if (token === "\n" || token === "\r\n") {
      plain += "\n";
      styledLines.push([]);
    } else {
      const target = token.slice(5, token.endsWith(bell) ? -1 : -2).trim();
      link = target || undefined;
    }
    offset = (match.index ?? 0) + token.length;
  }
  append(frame.slice(offset));
  return Object.freeze({
    lines: Object.freeze(plain.split("\n")),
    styledLines: Object.freeze(styledLines.map((line) => Object.freeze(line))),
    semantics,
  });
}
