import { pathToFileURL } from "node:url";

type RpcValue = Record<string, unknown>;

interface RpcResponse {
  id?: number;
  method?: string;
  params?: { items?: readonly unknown[] };
  error?: unknown;
  result?: unknown;
}

export interface OxlintTransport {
  stdin: { write(value: string): unknown; flush(): unknown };
  stdout: AsyncIterable<Uint8Array>;
  kill(): unknown;
  exited: Promise<number>;
}

function readPacket(
  bytes: Buffer,
): { message: RpcResponse; end: number } | undefined {
  const headerEnd = bytes.indexOf("\r\n\r\n");
  if (headerEnd < 0) return undefined;
  const header = bytes.subarray(0, headerEnd).toString();
  const length = Number(/^Content-Length:\s*(\d+)$/im.exec(header)?.[1]);
  if (!Number.isSafeInteger(length))
    throw new Error("Invalid Oxlint LSP response");
  const end = headerEnd + 4 + length;
  if (end > bytes.length) return undefined;
  const message = JSON.parse(
    bytes.subarray(headerEnd + 4, end).toString(),
  ) as RpcResponse;
  return { message, end };
}

export class OxlintClient {
  readonly #process;
  readonly #documents = new Map<string, string>();
  readonly #requests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly #ready;
  #id = 0;
  #failure: Error | undefined;

  constructor(
    binary: string,
    readonly root: string,
    transport?: OxlintTransport,
  ) {
    this.#process =
      transport ??
      Bun.spawn([binary, "--lsp"], {
        cwd: root,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
    void this.#read().catch((cause: unknown) => {
      this.#failure = new Error("Oxlint language server disconnected", {
        cause,
      });
      for (const request of this.#requests.values())
        request.reject(this.#failure);
    });
    const rootUri = pathToFileURL(root).href;
    this.#ready = this.#request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ name: "tuil", uri: rootUri }],
      capabilities: {
        textDocument: { diagnostic: { dynamicRegistration: false } },
        workspace: { configuration: true },
      },
    }).then(() => this.#send({ method: "initialized", params: {} }));
    void this.#ready.catch(() => {});
  }

  #send(message: RpcValue) {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.#process.stdin.write(
      "Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body,
    );
    this.#process.stdin.flush();
  }

  async #request(method: string, params: RpcValue) {
    if (this.#failure) throw this.#failure;
    const id = ++this.#id;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    this.#requests.set(id, { resolve, reject });
    const timeout = setTimeout(
      () => reject(new Error("Oxlint timed out responding to " + method)),
      10_000,
    );
    try {
      this.#send({ id, method, params });
      return await promise;
    } finally {
      clearTimeout(timeout);
      this.#requests.delete(id);
    }
  }

  #handleResponse(message: RpcResponse): void {
    if (typeof message.id !== "number") return;
    if (typeof message.method === "string") {
      const result =
        message.method === "workspace/configuration"
          ? (message.params?.items?.map(() => ({})) ?? [])
          : null;
      this.#send({ id: message.id, result });
      return;
    }
    const request = this.#requests.get(message.id);
    if (message.error)
      request?.reject(new Error(JSON.stringify(message.error)));
    else request?.resolve(message.result);
  }

  async #read() {
    let bytes = Buffer.alloc(0);
    for await (const chunk of this.#process.stdout) {
      bytes = Buffer.concat([bytes, chunk]);
      for (let packet = readPacket(bytes); packet; packet = readPacket(bytes)) {
        this.#handleResponse(packet.message);
        bytes = bytes.subarray(packet.end);
      }
    }
    throw new Error("Oxlint language server exited");
  }

  async diagnose(path: string, source: string) {
    await this.#ready;
    const uri = pathToFileURL(path).href;
    const previous = this.#documents.get(uri);
    if (previous !== source) {
      const version = ++this.#id;
      if (previous === undefined) {
        this.#send({
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri,
              version,
              languageId: /\.tsx?$/.test(path) ? "typescript" : "javascript",
              text: source,
            },
          },
        });
      } else {
        this.#send({
          method: "textDocument/didChange",
          params: {
            textDocument: { uri, version },
            contentChanges: [{ text: source }],
          },
        });
      }
      this.#documents.set(uri, source);
    }
    const report = await this.#request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    if (
      !report ||
      typeof report !== "object" ||
      !("items" in report) ||
      !Array.isArray(report.items)
    ) {
      throw new Error("Oxlint did not return diagnostics for " + path);
    }
    return report.items as Array<{
      severity?: number;
      message: string;
      range: { start: { line: number; character: number } };
    }>;
  }

  async close() {
    this.#process.kill();
    await this.#process.exited;
  }
}
