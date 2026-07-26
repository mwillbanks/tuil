import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath =
  configuredBasePath === "/"
    ? ""
    : configuredBasePath.replace(/\/+$/, "").replace(/^([^/])/, "/$1");

export default withMDX({
  assetPrefix: basePath || undefined,
  basePath,
  images: {
    unoptimized: true,
  },
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  experimental: {
    useTypeScriptCli: true,
  },
});
