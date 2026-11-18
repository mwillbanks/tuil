import { createStoryHttpHandler } from "@mwillbanks/tuil-story";
import { createDefaultThemeRegistry } from "@mwillbanks/tuil-theme";
import { createShowcaseCatalog } from "./index.tsx";

export interface StoryServerOptions {
  readonly hostname?: string;
  readonly port?: number;
}

export function storyServerMessage(url: URL): string {
  return `tuil story bridge listening on ${url.toString()}\n`;
}

export function startStoryServer(
  options: StoryServerOptions = {},
): ReturnType<typeof Bun.serve> {
  const catalog = createShowcaseCatalog();
  const handleStory = createStoryHttpHandler(catalog, {
    themeRegistry: createDefaultThemeRegistry(),
  });
  const allowedOrigins = new Set([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:6006",
    "http://127.0.0.1:6006",
  ]);
  return Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? Number(process.env["TUIL_STORY_PORT"] ?? 4317),
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return Response.json({ ready: true });
      }
      if (url.pathname !== "/api/tuil-story") {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const origin = request.headers.get("origin");
      const originAllowed = origin !== null && allowedOrigins.has(origin);
      if (request.method === "OPTIONS") {
        const headers = new Headers({
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "POST, OPTIONS",
        });
        if (originAllowed) {
          headers.set("access-control-allow-origin", origin);
          headers.set("vary", "Origin");
        }
        return new Response(null, { status: 204, headers });
      }
      const response = await handleStory(request);
      if (originAllowed) {
        response.headers.set("access-control-allow-origin", origin);
        response.headers.set("vary", "Origin");
      }
      return response;
    },
  });
}

if (import.meta.main) {
  const server = startStoryServer();
  process.stdout.write(storyServerMessage(server.url));
}
