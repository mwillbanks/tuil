import { useApp } from "@mwillbanks/tuil";
import { Text, type TextProps } from "ink";
import { type ReactNode, useId, useMemo } from "react";
import { useSemanticNode } from "./semantics.ts";

export interface TerminalImageSource {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface TerminalImageProps
  extends Omit<TextProps, "children" | "width" | "height"> {
  readonly source: TerminalImageSource;
  readonly alt: string;
  readonly columns?: number;
  readonly id?: string;
  readonly testId?: string;
}

interface Pixel {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

const luminanceRamp = " .:-=+*#%@";

function pixelAt(source: TerminalImageSource, x: number, y: number): Pixel {
  const index = (y * source.width + x) * 4;
  return {
    red: source.data[index] ?? 0,
    green: source.data[index + 1] ?? 0,
    blue: source.data[index + 2] ?? 0,
    alpha: source.data[index + 3] ?? 0,
  };
}

function samplePixel(
  source: TerminalImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
): Pixel {
  const sourceX = Math.min(
    source.width - 1,
    Math.floor((x / width) * source.width),
  );
  const sourceY = Math.min(
    source.height - 1,
    Math.floor((y / height) * source.height),
  );
  return pixelAt(source, sourceX, sourceY);
}

function grayscaleCharacter(top: Pixel, bottom: Pixel): string {
  const visible = [top, bottom].filter((pixel) => pixel.alpha >= 32);
  if (visible.length === 0) return " ";
  const luminance =
    visible.reduce(
      (total, pixel) =>
        total + pixel.red * 0.2126 + pixel.green * 0.7152 + pixel.blue * 0.0722,
      0,
    ) / visible.length;
  const index = Math.min(
    luminanceRamp.length - 1,
    Math.floor((luminance / 256) * luminanceRamp.length),
  );
  return luminanceRamp[index] ?? " ";
}

function colorCell(top: Pixel, bottom: Pixel): string {
  if (top.alpha < 32 && bottom.alpha < 32) return " ";
  if (top.alpha < 32) {
    return `\u001b[38;2;${bottom.red};${bottom.green};${bottom.blue}m▄\u001b[0m`;
  }
  if (bottom.alpha < 32) {
    return `\u001b[38;2;${top.red};${top.green};${top.blue}m▀\u001b[0m`;
  }
  return `\u001b[38;2;${top.red};${top.green};${top.blue}m\u001b[48;2;${bottom.red};${bottom.green};${bottom.blue}m▀\u001b[0m`;
}

export function renderTerminalImage(
  source: TerminalImageSource,
  columns = source.width,
  color = true,
): string {
  if (
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    source.data.length !== source.width * source.height * 4
  ) {
    throw new Error(
      "TerminalImage source must contain width × height RGBA data",
    );
  }
  if (!Number.isFinite(columns)) {
    throw new Error("TerminalImage columns must be a finite number");
  }
  const targetWidth = Math.max(1, Math.floor(columns));
  const targetPixelHeight = Math.max(
    2,
    Math.round((source.height / source.width) * targetWidth),
  );
  const evenPixelHeight =
    targetPixelHeight % 2 === 0 ? targetPixelHeight : targetPixelHeight + 1;
  const lines: string[] = [];
  for (let y = 0; y < evenPixelHeight; y += 2) {
    let line = "";
    for (let x = 0; x < targetWidth; x += 1) {
      const top = samplePixel(source, x, y, targetWidth, evenPixelHeight);
      const bottom = samplePixel(
        source,
        x,
        y + 1,
        targetWidth,
        evenPixelHeight,
      );
      line += color ? colorCell(top, bottom) : grayscaleCharacter(top, bottom);
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export function TerminalImage({
  source,
  alt,
  columns,
  id: providedId,
  testId,
  ...props
}: TerminalImageProps): ReactNode {
  const app = useApp();
  const generatedId = useId();
  const id = providedId ?? generatedId;
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        testId,
        role: "image" as const,
        label: alt,
      }),
      [alt, id, testId],
    ),
  );
  const rendered = useMemo(
    () =>
      renderTerminalImage(
        source,
        columns,
        app.capabilities.colorDepth === 24 && app.capabilities.unicode,
      ),
    [app.capabilities.colorDepth, app.capabilities.unicode, columns, source],
  );
  return <Text {...props}>{rendered}</Text>;
}
