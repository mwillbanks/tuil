import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildBrowserShowcase } from "../../apps/showcase/src/build-browser.ts";
import { createBrowserShowcaseCatalog } from "../../apps/showcase/src/catalog.ts";
import {
  createShowcaseFileHandler,
  startShowcaseServer,
} from "../../apps/showcase/src/serve.ts";

async function withTemporaryDirectory<T>(
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "tuil-showcase-functional-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("browser catalog includes rendered portable stories", async () => {
  const stories = await createBrowserShowcaseCatalog();
  expect(stories.length).toBeGreaterThan(0);
  expect(
    stories.some(
      (story) => story.storyId === "foundation" && story.variant === "Running",
    ),
  ).toBe(true);
  expect(stories.every((story) => story.frame.length > 0)).toBe(true);
});

test("browser build writes its bundle and copied assets to the requested directory", async () => {
  await withTemporaryDirectory(async (temporaryDirectory) => {
    const output = resolve(temporaryDirectory, "browser");
    await buildBrowserShowcase({ outputDirectory: output });

    for (const asset of [
      "browser.js",
      "catalog.json",
      "showcase.css",
      "ghostty-vt.wasm",
      "index.html",
    ]) {
      expect(await Bun.file(resolve(output, asset)).exists()).toBe(true);
    }

    const generated = (await Bun.file(
      resolve(output, "catalog.json"),
    ).json()) as {
      readonly id: string;
      readonly frame: string;
    }[];
    expect(generated.length).toBeGreaterThan(0);
    expect(generated[0]?.frame.length).toBeGreaterThan(0);
  });
});

test("showcase file handler rejects invalid and escaping paths and serves GET and HEAD", async () => {
  await withTemporaryDirectory(async (temporaryDirectory) => {
    const root = resolve(temporaryDirectory, "site");
    await mkdir(root);
    await writeFile(resolve(root, "index.html"), "TUIL showcase");
    await writeFile(resolve(temporaryDirectory, "secret.txt"), "private");
    const handler = createShowcaseFileHandler(root);

    const get = await handler(new Request("http://localhost/"));
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("TUIL showcase");

    const head = await handler(
      new Request("http://localhost/", { method: "HEAD" }),
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    expect(
      (await handler(new Request("http://localhost/%2e%2e%2fsecret.txt")))
        .status,
    ).toBe(404);
    expect(
      (await handler(new Request("http://localhost/%E0%A4%A"))).status,
    ).toBe(400);
    expect(
      (await handler(new Request("http://localhost/missing.js"))).status,
    ).toBe(404);
    const unsupported = await handler(
      new Request("http://localhost/", { method: "POST" }),
    );
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, HEAD");

    const reservation = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("reserved"),
    });
    const port = reservation.port;
    await reservation.stop(true);
    const server = startShowcaseServer({ directory: root, port });
    try {
      const response = await fetch(new URL("/", server.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("TUIL showcase");
    } finally {
      await server.stop(true);
    }
  });
});

test("showcase server entrypoint announces readiness on its configured port", async () => {
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = reservation.port;
  await reservation.stop(true);

  const workspace = resolve(import.meta.dir, "../..");
  const child = Bun.spawn(
    [process.execPath, resolve(workspace, "apps/showcase/src/serve.ts")],
    {
      cwd: workspace,
      env: { ...process.env, TUIL_SHOWCASE_PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const firstOutput = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Showcase server did not report readiness")),
          10_000,
        );
      }),
    ]);
    expect(firstOutput.done).toBe(false);
    expect(new TextDecoder().decode(firstOutput.value)).toContain(
      "listening on http://127.0.0.1:" + port,
    );
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
    child.kill();
    await child.exited;
  }
});
