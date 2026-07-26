import { createStoryHttpHandler } from "@mwillbanks/tuil-story";
import { createDefaultThemeRegistry } from "@mwillbanks/tuil-theme";
import { createShowcaseCatalog } from "./index.tsx";

export interface StoryServerOptions {
  readonly hostname?: string;
  readonly port?: number;
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
      const corsHeaders =
        origin && allowedOrigins.has(origin)
          ? {
              "access-control-allow-origin": origin,
              vary: "Origin",
            }
          : {};
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders,
            "access-control-allow-headers": "content-type",
            "access-control-allow-methods": "POST, OPTIONS",
          },
        });
      }
      const response = await handleStory(request);
      for (const [name, value] of Object.entries(corsHeaders)) {
        response.headers.set(name, value);
      }
      return response;
    },
  });
}

if (import.meta.main) {
  const server = startStoryServer();
  process.stdout.write(
    `tuil story bridge listening on ${server.url.toString()}\n`,
  );
}
