import { resolve } from "node:path";
import type { TerminalImageSource } from "@mwillbanks/tuil-ink";
import sharp from "sharp";
import { runExample as run } from "../../_shared.tsx";

export { ExampleApplication } from "../../_shared.tsx";

export async function loadLogo(): Promise<TerminalImageSource> {
  const source = resolve(import.meta.dir, "../../../logo.svg");
  const { data, info } = await sharp(source)
    .resize({ width: 160 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data),
    width: info.width,
    height: info.height,
  };
}

if (import.meta.main) await run("full-screen", { logo: await loadLogo() });
