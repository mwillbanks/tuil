import { expect, test } from "bun:test";
import { startStoryServer } from "../../showcase/src/story-server.ts";
import { OPTIONS, proxyStoryRequest } from "./app/api/tuil-story/route.ts";
import { source } from "./lib/source.ts";

test("Fumadocs source exposes the documentation tree", () => {
  expect(source.getPage([])?.url).toBe("/docs");
  for (const section of [
    "guides",
    "api",
    "registry",
    "architecture",
    "examples",
    "skills",
    "migration",
  ]) {
    expect(source.getPage([section])?.url).toBe(`/docs/${section}`);
  }
  expect(source.getPage(["components", "initializer"])?.url).toBe(
    "/docs/components/initializer",
  );
});

test("documentation story endpoint renders the portable initializer", async () => {
  const server = startStoryServer({ port: 0 });
  const response = await proxyStoryRequest(
    new Request("http://localhost/api/tuil-story", {
      method: "POST",
      headers: { origin: "http://localhost:6006" },
      body: JSON.stringify({
        storyId: "init-wizard",
        variant: "StaticFallback",
      }),
    }),
    new URL("/api/tuil-story", server.url).toString(),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(
    "http://localhost:6006",
  );
  const body = (await response.json()) as {
    readonly frame: string;
    readonly controls: { readonly theme: string };
  };
  expect(body.frame).toContain("tuil init");
  expect(body.controls.theme).toBe("default-dark");
  expect(
    OPTIONS(
      new Request("http://localhost/api/tuil-story", {
        method: "OPTIONS",
        headers: { origin: "http://localhost:6006" },
      }),
    ).status,
  ).toBe(204);
  await server.stop(true);
});
