import { createNextStory } from "@fumadocs/story/next";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const withStory = createNextStory();
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath =
  configuredBasePath === "/"
    ? ""
    : configuredBasePath.replace(/\/+$/, "").replace(/^([^/])/, "/$1");

export default withStory(
  withMDX({
    assetPrefix: basePath || undefined,
    basePath,
    images: {
      unoptimized: true,
    },
    output: "export",
    reactStrictMode: true,
    serverExternalPackages: ["@takumi-rs/core"],
    trailingSlash: true,
    experimental: {
      useTypeScriptCli: true,
    },
  }),
);
