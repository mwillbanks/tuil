import { relative, resolve, sep } from "node:path";

export function createShowcaseFileHandler(
  directory: string,
): (request: Request) => Promise<Response> {
  const root = resolve(directory);
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Invalid path", { status: 400 });
    }
    const path = resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    const target = relative(root, path);
    if (target === ".." || target.startsWith(".." + sep)) {
      return new Response("Not found", { status: 404 });
    }
    const file = Bun.file(path);
    if (!(await file.exists()))
      return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : file, {
      headers: { "content-type": file.type },
    });
  };
}

export function startShowcaseServer(
  options: {
    readonly directory?: string;
    readonly port?: number;
  } = {},
): ReturnType<typeof Bun.serve> {
  const port =
    options.port ?? Number(process.env["TUIL_SHOWCASE_PORT"] ?? 6006);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("TUIL_SHOWCASE_PORT must be a valid TCP port");
  }
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: createShowcaseFileHandler(
      options.directory ?? resolve(import.meta.dir, "../dist/browser"),
    ),
  });
}

if (import.meta.main) {
  const server = startShowcaseServer();
  process.stdout.write("TUIL showcase listening on " + server.url + "\n");
}
