import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderStoryRequest } from "@mwillbanks/tuil-story";
import { createEcosystemStoryCatalog } from "../../registry/stories/ecosystem.tsx";

export interface DocsStoryFrame {
  readonly id: string;
  readonly storyId: string;
  readonly storyTitle: string;
  readonly variant: string;
  readonly frame: string;
  readonly events: readonly string[];
  readonly focus: readonly string[];
  readonly controls: {
    readonly width: number;
    readonly height: number;
    readonly theme: string;
    readonly interactive: boolean;
  };
}

export async function renderDocsStoryFrames(): Promise<
  readonly DocsStoryFrame[]
> {
  const catalog = createEcosystemStoryCatalog();
  const frames: DocsStoryFrame[] = [];
  for (const story of catalog.list()) {
    for (const variant of Object.keys(story.definition.stories)) {
      const rendered = await renderStoryRequest(catalog, {
        storyId: story.id,
        variant,
      });
      frames.push({
        id: `${story.id}:${variant}`,
        storyId: story.id,
        storyTitle: story.title,
        variant,
        frame: rendered.frame,
        events: rendered.events.map((event) => event.type),
        focus: rendered.focus.nodes.map(
          (node) => `${node.label ?? node.id} (${node.role ?? "node"})`,
        ),
        controls: {
          width: rendered.controls.width,
          height: rendered.controls.height,
          theme: rendered.controls.theme,
          interactive: rendered.controls.interactive,
        },
      });
    }
  }
  return Object.freeze(frames);
}

export async function prepareDocsAssets(
  options: Readonly<{
    logoSource?: string;
    publicDirectory?: string;
    storyFrames?: readonly DocsStoryFrame[];
  }> = {},
): Promise<void> {
  const workspace = resolve(import.meta.dir, "../..");
  const publicDirectory =
    options.publicDirectory ?? resolve(workspace, "apps/docs/public");
  const logoSource = options.logoSource ?? resolve(workspace, "logo.svg");

  await mkdir(publicDirectory, { recursive: true });
  await mkdir(resolve(publicDirectory, "integrations"), { recursive: true });
  await copyFile(logoSource, resolve(publicDirectory, "logo.svg"));
  await writeFile(resolve(publicDirectory, ".nojekyll"), "", "utf8");
  const storyFrames = options.storyFrames ?? (await renderDocsStoryFrames());
  const storyFramesPath = resolve(
    publicDirectory,
    "integrations/story-frames.json",
  );
  await writeFile(
    storyFramesPath,
    `${JSON.stringify(storyFrames, null, 2)}\n`,
    "utf8",
  );
  const formatter = Bun.spawn(
    [
      "bun",
      "biome",
      "format",
      "--write",
      storyFramesPath,
      "--reporter",
      "concise",
    ],
    {
      cwd: workspace,
      stderr: "pipe",
      stdout: "ignore",
    },
  );
  if ((await formatter.exited) !== 0) {
    throw new Error(await new Response(formatter.stderr).text());
  }
}

await (import.meta.main ? prepareDocsAssets() : undefined);
