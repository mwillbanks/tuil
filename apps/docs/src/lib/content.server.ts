import { server } from "fumadocs-mdx/runtime/server";
import { resolve } from "node:path";
import type * as Config from "../../source.config";

const directory = resolve(import.meta.dir, "../../content/docs");
const metadata: Record<string, () => Promise<unknown>> = {};
const documents: Record<string, () => Promise<unknown>> = {};
for await (const path of new Bun.Glob("**/*.{md,mdx,json}").scan({
  cwd: directory,
})) {
  const load = () => import(resolve(directory, path) + "?collection=docs");
  if (path.endsWith(".json")) metadata["./" + path] = load;
  else documents["./" + path] = load;
}
export const docs = await server<
  typeof Config,
  { DocData: Record<string, unknown> }
>().docs("docs", directory, metadata, documents);
