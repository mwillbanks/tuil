import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderStoryRequest } from "@mwillbanks/tuil-story";
import Convert from "ansi-to-html";
import { createEcosystemStoryCatalog } from "../../registry/stories/ecosystem.tsx";

export interface StoryPublicationDescriptor {
  readonly id: string;
  readonly storyId: string;
  readonly storyTitle: string;
  readonly variant: string;
  readonly frame: string;
  readonly ansiFrame: string;
  readonly htmlFrame: string;
  readonly description: string;
  readonly source: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly argSchema: Readonly<Record<string, string>>;
  readonly semantics: readonly Readonly<Record<string, unknown>>[];
  readonly events: readonly string[];
  readonly actions: readonly string[];
  readonly focus: readonly string[];
  readonly capabilities: readonly string[];
  readonly packageDependencies: readonly string[];
  readonly controls: {
    readonly width: number;
    readonly height: number;
    readonly theme: string;
    readonly interactive: boolean;
  };
}

export interface PublishedStoryManifest {
  readonly version: 1;
  readonly generatedBy: "tooling/docs/prepare-assets.ts";
  readonly stories: readonly StoryPublicationDescriptor[];
}

const publishedSemanticKeys = [
  "key",
  "id",
  "testId",
  "role",
  "label",
  "description",
  "text",
  "disabled",
  "readOnly",
  "selected",
  "checked",
  "expanded",
  "valueText",
  "layout",
] as const;

function serializePublishedSemantic(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object") return Object.freeze({});
  const source = value as Readonly<Record<string, unknown>>;
  return Object.freeze(
    Object.fromEntries(
      publishedSemanticKeys.flatMap((key) =>
        source[key] === undefined ? [] : [[key, source[key]]],
      ),
    ),
  );
}

export async function renderDocsStoryFrames(): Promise<
  readonly StoryPublicationDescriptor[]
> {
  const catalog = createEcosystemStoryCatalog();
  const ansi = new Convert({ escapeXML: true, newline: true });
  const frames: StoryPublicationDescriptor[] = [];
  for (const story of catalog.list()) {
    for (const variant of Object.keys(story.definition.stories)) {
      const rendered = await renderStoryRequest(catalog, {
        storyId: story.id,
        variant,
      });
      const storyVariant = story.definition.stories[variant];
      const args = (storyVariant?.args ?? {}) as Readonly<
        Record<string, unknown>
      >;
      frames.push({
        id: `${story.id}:${variant}`,
        storyId: story.id,
        storyTitle: story.title,
        variant,
        frame: rendered.frame,
        ansiFrame: rendered.ansiFrame,
        htmlFrame: ansi.toHtml(rendered.ansiFrame),
        description: `${story.title} ${variant} executable example.`,
        source: `import { createEcosystemStoryCatalog } from "./registry/stories/ecosystem";\nimport { renderStoryRequest } from "@mwillbanks/tuil-story";\n\nconst frame = await renderStoryRequest(createEcosystemStoryCatalog(), {\n  storyId: ${JSON.stringify(story.id)},\n  variant: ${JSON.stringify(variant)},\n});`,
        args,
        argSchema: Object.fromEntries(
          Object.entries(args).map(([name, value]) => [
            name,
            Array.isArray(value)
              ? "array"
              : value === null
                ? "null"
                : typeof value,
          ]),
        ),
        semantics: rendered.semantics.map(serializePublishedSemantic),
        events: rendered.events.map((event) => event.type),
        actions: rendered.actions.map((action) => action.type),
        focus: rendered.focus.nodes.map(
          (node) => `${node.label ?? node.id} (${node.role ?? "node"})`,
        ),
        capabilities: [
          "color",
          "unicode",
          ...(rendered.focus.nodes.length ? ["keyboard", "focus"] : []),
        ],
        packageDependencies: [
          "@mwillbanks/tuil",
          "@mwillbanks/tuil-ink",
          "@mwillbanks/tuil-story",
        ],
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
    storyFrames?: readonly StoryPublicationDescriptor[];
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
  await writeFile(
    resolve(publicDirectory, "integrations/story-manifest.json"),
    `${JSON.stringify({ version: 1, generatedBy: "tooling/docs/prepare-assets.ts", stories: storyFrames } satisfies PublishedStoryManifest, null, 2)}\n`,
    "utf8",
  );
  const formatter = Bun.spawn(
    [
      "bun",
      "biome",
      "format",
      "--write",
      storyFramesPath,
      resolve(publicDirectory, "integrations/story-manifest.json"),
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
