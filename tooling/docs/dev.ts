import { resolve, sep } from "node:path";
import {
  getBasePath,
  normalizeBasePath,
} from "../../apps/docs/src/lib/base-path";
import { type DocsExporter, runDocsExport } from "./export";

interface DocsHandlerOptions {
  readonly directory: string;
  readonly basePath?: string;
}

interface DocsDevOptions {
  readonly directory?: string;
  readonly basePath?: string;
  readonly port?: number;
  readonly exporter?: DocsExporter;
}

/** Serve only files from a completed artifact root. */
export function createDocsHandler(options: DocsHandlerOptions) {
  const directory = resolve(options.directory);
  const basePath = normalizeBasePath(options.basePath ?? getBasePath());
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      basePath &&
      url.pathname !== basePath &&
      !url.pathname.startsWith(basePath + "/")
    )
      return new Response("Not found", { status: 404 });
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname.slice(basePath.length));
    } catch {
      return new Response("Invalid path", { status: 400 });
    }
    for (const candidate of [
      pathname,
      pathname.replace(/\/?$/, "/") + "index.html",
    ]) {
      const path = resolve(directory, "." + candidate);
      if (!path.startsWith(directory + sep)) continue;
      const file = Bun.file(path);
      if (await file.exists()) {
        const headers = path.endsWith("/api/search")
          ? { "Content-Type": "application/json" }
          : undefined;
        return new Response(file, { headers });
      }
    }
    return new Response("Not found", { status: 404 });
  };
}

/** Export successfully before opening the local HTTP listener. */
export async function startDocsDevServer(options: DocsDevOptions = {}) {
  await runDocsExport(options.exporter);
  return Bun.serve({
    port: options.port ?? Number(process.env["PORT"] ?? 3000),
    fetch: createDocsHandler({
      directory:
        options.directory ?? resolve(import.meta.dir, "../../apps/docs/out"),
      basePath: options.basePath,
    }),
  });
}

if (import.meta.main) {
  const server = await startDocsDevServer();
  console.log("Documentation available at " + server.url + getBasePath());
}
