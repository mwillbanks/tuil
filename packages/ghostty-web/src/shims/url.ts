export function fileURLToPath(value: string | URL): string {
  const url = typeof value === "string" ? new URL(value) : value;
  if (url.protocol !== "file:") throw new TypeError("Expected a file URL");
  return decodeURIComponent(url.pathname);
}
