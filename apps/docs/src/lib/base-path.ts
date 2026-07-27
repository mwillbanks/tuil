export function getBasePath(): string {
  const configured = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";
  if (configured === "/") return "";
  return configured.replace(/\/+$/, "").replace(/^([^/])/, "/$1");
}

function alreadyUsesBasePath(path: string, basePath: string): boolean {
  return path === basePath || path.startsWith(`${basePath}/`);
}

export function withBasePath(path: string): string {
  const basePath = getBasePath();
  if (!basePath) return path;
  if (!path.startsWith("/")) return path;
  if (alreadyUsesBasePath(path, basePath)) return path;
  return `${basePath}${path}`;
}

export function prefixMarkdownDeploymentPaths(markdown: string): string {
  if (!getBasePath()) return markdown;
  return markdown
    .replace(
      /(\]\()((?:\/)[^)\s]+)(\))/g,
      (_match, open: string, path: string, close: string) =>
        `${open}${withBasePath(path)}${close}`,
    )
    .replace(
      /(\b(?:href|src)=["'])((?:\/)[^"']+)(["'])/g,
      (_match, open: string, path: string, close: string) =>
        `${open}${withBasePath(path)}${close}`,
    );
}
