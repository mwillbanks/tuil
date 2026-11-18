import { plugin } from "bun";
import { createMdxPlugin } from "fumadocs-mdx/bun";
await plugin(
  createMdxPlugin({ configPath: import.meta.dir + "/source.config.ts" }),
);
