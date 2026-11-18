import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { getBasePath } from "../../apps/docs/src/lib/base-path";
import { createDocsHandler, startDocsDevServer } from "../../tooling/docs/dev";
import { runDocsExport } from "../../tooling/docs/export";

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "tuil-docs-server-"));
  const directory = resolve(root, "artifacts");
  await mkdir(resolve(directory, "chapter"), { recursive: true });
  await mkdir(resolve(directory, "api"), { recursive: true });
  await Bun.write(resolve(directory, "index.html"), "<h1>Documentation</h1>");
  await Bun.write(resolve(directory, "chapter/index.html"), "<h1>Chapter</h1>");
  await Bun.write(resolve(directory, "api/search"), '{"pages":["chapter"]}');
  await Bun.write(resolve(directory, "style.css"), "body{color:white}");
  await Bun.write(resolve(root, "private.txt"), "private");
  return { root, directory };
}

test("finite export delegates once and propagates failure without changing cwd", async () => {
  const { root, directory } = await fixture();
  const cwd = process.cwd();
  let calls = 0;
  try {
    await runDocsExport(async () => {
      calls++;
      await Bun.write(resolve(directory, ".nojekyll"), "");
    });
    expect(calls).toBe(1);
    expect(await Bun.file(resolve(directory, ".nojekyll")).exists()).toBeTrue();
    expect(process.cwd()).toBe(cwd);
    const error = new Error("Export failed");
    await expect(
      runDocsExport(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    await expect(
      startDocsDevServer({
        port: 0,
        directory,
        exporter: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
    expect(process.cwd()).toBe(cwd);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("static HTTP handler preserves root and Pages route/asset behavior", async () => {
  const { root, directory } = await fixture();
  try {
    for (const basePath of ["/", "/tuil/"]) {
      const prefix = basePath === "/" ? "" : "/tuil";
      const handler = createDocsHandler({ directory, basePath });
      for (const [path, text] of [
        ["", "Documentation"],
        ["/", "Documentation"],
        ["/index.html", "Documentation"],
        ["/chapter", "Chapter"],
        ["/chapter/", "Chapter"],
        ["/chapter/index.html", "Chapter"],
        ["/style.css", "color:white"],
      ]) {
        const response = await handler(
          new Request("http://docs.local" + prefix + path),
        );
        expect(response.status, prefix + path).toBe(200);
        expect(await response.text()).toContain(text!);
      }
      const search = await handler(
        new Request("http://docs.local" + prefix + "/api/search"),
      );
      expect(search.headers.get("content-type")).toBe("application/json");
      expect(await search.json()).toEqual({ pages: ["chapter"] });
    }
    const configured = createDocsHandler({ directory });
    expect(
      (await configured(new Request("http://docs.local" + getBasePath() + "/")))
        .status,
    ).toBe(200);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("static HTTP handler rejects malformed, missing, foreign-prefix and escaping paths", async () => {
  const { root, directory } = await fixture();
  try {
    const handler = createDocsHandler({ directory, basePath: "tuil" });
    for (const path of [
      "/",
      "/tuil-other",
      "/tuil-other/chapter",
      "/tuil/missing",
      "/tuil/%2e%2e%2fprivate.txt",
    ]) {
      const response = await handler(new Request("http://docs.local" + path));
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe("Not found");
    }
    const malformed = await handler(new Request("http://docs.local/tuil/%FF"));
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).toBe("Invalid path");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dev HTTP listener opens after successful export and serves its artifact root", async () => {
  const { root, directory } = await fixture();
  let complete!: () => void;
  const exported = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let started!: () => void;
  const exporting = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  let server: Awaited<ReturnType<typeof startDocsDevServer>> | undefined;
  try {
    const pending = startDocsDevServer({
      directory,
      basePath: "/tuil",
      port: 0,
      exporter: async () => {
        calls++;
        started();
        await exported;
        await Bun.write(
          resolve(directory, "chapter/index.html"),
          "<h1>Export completed</h1>",
        );
      },
    });
    let listening = false;
    void pending.then(() => {
      listening = true;
    });
    await exporting;
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(listening).toBeFalse();
    complete();
    server = await pending;
    const page = await fetch(new URL("/tuil/chapter/", server.url));
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("<h1>Export completed</h1>");
    const search = await fetch(new URL("/tuil/api/search", server.url));
    expect(await search.json()).toEqual({ pages: ["chapter"] });
    expect((await fetch(new URL("/chapter/", server.url))).status).toBe(404);
  } finally {
    await server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
