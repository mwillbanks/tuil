import { expect, spyOn, test } from "bun:test";
import {
  HttpRegistrySource,
  parseRegistryItem,
  RegistryClient,
  registryIntegrity,
} from "../../../../../packages/registry/src/index.ts";

function published(
  name = "nested/button",
  extra: Record<string, unknown> = {},
) {
  const item = parseRegistryItem({
    name,
    type: "registry:tuil-ui",
    version: "1.2.3",
    ownership: "source",
    compatibility: { tuil: "^1.0.0", renderers: ["cell", "ink"] },
    provenance: { source: "controlled-fixture", license: "MIT", mode: "adapt" },
    dependencies: ["@scope/package@^2", "kleur@4"],
    registryDependencies: ["@official/nested/base"],
    files: [
      {
        path: "button.tsx",
        target: "src/button.tsx",
        source: "original/button.tsx",
        content: "export const Button = true;\n",
      },
    ],
    ...extra,
  });
  return { ...item, integrity: registryIntegrity(item) };
}

test("HTTP descriptors strip remote identity and content while verified items retain executable inputs", async () => {
  const item = published("nested/button", {
    capabilities: ["pointer"],
    semantics: ["button"],
    slots: ["label"],
  });
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === "/registry/registry.json") {
        return Response.json({
          items: [
            { ...item, registryName: "@forged/button", sourceId: "forged" },
          ],
        });
      }
      if (path === "/registry/nested/button.json") return Response.json(item);
      return new Response(null, { status: 404 });
    },
  });
  try {
    const source = new HttpRegistrySource(
      "official",
      `http://127.0.0.1:${server.port}/registry/`,
    );
    const [entry] = await source.list();
    expect(entry).toMatchObject({
      name: item.name,
      type: "component",
      version: "1.2.3",
      dependencies: item.dependencies,
      capabilities: ["pointer"],
      semantics: ["button"],
      slots: ["label"],
    });
    expect(entry).not.toHaveProperty("sourceId");
    expect(entry).not.toHaveProperty("registryName");
    expect(entry?.files).toEqual([
      {
        path: "button.tsx",
        target: "src/button.tsx",
        source: "original/button.tsx",
      },
    ]);
    expect(entry?.files?.[0]).not.toHaveProperty("content");
    expect(Object.isFrozen(entry)).toBeTrue();
    expect(Object.isFrozen(entry?.files)).toBeTrue();
    expect(Object.isFrozen(entry?.files?.[0])).toBeTrue();
    const received = await new RegistryClient([source]).get(
      "@official/nested/button",
    );
    expect(received).toMatchObject({
      sourceId: "official",
      registryName: "@official/nested/button",
      files: item.files,
      integrity: item.integrity,
    });
    expect(registryIntegrity(received)).toBe(item.integrity);
    expect(requests).toEqual([
      "/registry/registry.json",
      "/registry/nested/button.json",
    ]);
    await expect(source.get("../outside")).rejects.toThrow(
      "Invalid registry item path",
    );
    expect(requests).toHaveLength(2);
  } finally {
    server.stop(true);
  }
});

test("HTTP item contracts reject malformed executable metadata with a diagnostic cause", async () => {
  const base = published();
  const file = base.files[0];
  const cases: [unknown, string][] = [
    [null, "must be an object"],
    [{ ...base, type: "arbitrary" }, "Unsupported registry item type"],
    [{ ...base, files: null }, "files must be an array"],
    [{ ...base, files: [null] }, "Registry file must be an object"],
    [
      { ...base, files: [{ ...file, path: "" }] },
      "path must be a nonempty string",
    ],
    [
      { ...base, files: [{ ...file, source: "../escape" }] },
      "Invalid registry file source",
    ],
    [
      { ...base, files: [{ ...file, target: "src\\..\\escape" }] },
      "Invalid registry file target",
    ],
    [
      { ...base, files: [{ ...file, content: null }] },
      "content must be a string",
    ],
    [{ ...base, name: "" }, "name cannot be empty"],
    [{ ...base, integrity: "sha256-invalid" }, "SHA-256 digest"],
    [{ ...base, tier: 5 }, "tier must be between"],
    [{ ...base, version: " 1.2.3" }, "version must be a nonempty string"],
    [{ ...base, ownership: "arbitrary" }, "ownership is unsupported"],
    [{ ...base, compatibility: false }, "compatibility must be an object"],
    [
      { ...base, compatibility: { tuil: "^1", renderers: "ink" } },
      "renderers must be an array",
    ],
    [
      { ...base, capabilities: [""] },
      "capabilities must contain nonempty strings",
    ],
    [
      { ...base, semantics: [" spaced"] },
      "semantics must contain nonempty strings",
    ],
    [{ ...base, slots: [1] }, "slots must contain nonempty strings"],
    [{ ...base, deprecated: false }, "deprecated must be an object"],
    [{ ...base, provenance: false }, "provenance must be an object"],
    [
      { ...base, provenance: { source: "fixture", mode: "download" } },
      "provenance mode is unsupported",
    ],
    [{ ...base, codemods: {} }, "codemods must be a bounded array"],
    [
      { ...base, codemods: Array(101).fill({}) },
      "codemods must be a bounded array",
    ],
    [{ ...base, codemods: [null] }, "Registry codemod must be an object"],
    [
      { ...base, codemods: [{ replacements: {} }] },
      "replacements must be bounded",
    ],
    [
      { ...base, codemods: [{ replacements: Array(101).fill({}) }] },
      "replacements must be bounded",
    ],
  ];
  const codemod = { id: "rename", description: "Rename symbol" };
  for (const [replacement, message] of [
    [null, "replacement must be an object"],
    [{ to: "next" }, "replacement source is invalid"],
    [{ from: "x".repeat(10_001), to: "next" }, "replacement source is invalid"],
    [{ from: "Old", to: 1 }, "replacement target is invalid"],
    [{ from: "Old", to: "x".repeat(10_001) }, "replacement target is invalid"],
  ] as const) {
    cases.push([
      { ...base, codemods: [{ ...codemod, replacements: [replacement] }] },
      message,
    ]);
  }
  let payload: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json(payload),
  });
  try {
    const source = new HttpRegistrySource(
      "contracts",
      `http://127.0.0.1:${server.port}`,
    );
    for (const [value, message] of cases) {
      payload = value;
      const error = await source.get("nested/button").then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain(
        'Registry "contracts" item "nested/button" is invalid',
      );
      expect((error as Error).cause).toBeInstanceOf(Error);
      expect(((error as Error).cause as Error).message).toContain(message);
    }
  } finally {
    server.stop(true);
  }
});

test("published HTTP metadata requires versions, package ownership, and authentic digests", async () => {
  let payload: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json(payload),
  });
  try {
    const source = new HttpRegistrySource(
      "published",
      `http://127.0.0.1:${server.port}`,
    );
    const base = published();
    for (const value of [
      { ...base, version: "next" },
      { ...base, compatibility: { tuil: "not a range", renderers: ["ink"] } },
    ]) {
      payload = value;
      await expect(source.get(base.name)).rejects.toThrow(
        "invalid version compatibility metadata",
      );
    }
    for (const ownership of ["package", "plugin"] as const) {
      payload = { ...base, ownership };
      await expect(source.get(base.name)).rejects.toThrow(
        `requires packageName for ${ownership} ownership`,
      );
      payload = published(base.name, {
        ownership,
        packageName: "@scope/component",
      });
      expect((await source.get(base.name))?.ownership).toBe(ownership);
    }
    for (const changes of [
      { dependencies: ["malicious@1"] },
      { registryDependencies: ["other"] },
      { provenance: { source: "changed" } },
      { compatibility: { tuil: "^1.0.0", renderers: ["cell"] } },
      { files: [{ ...base.files[0], content: "injected()" }] },
    ]) {
      payload = { ...base, ...changes };
      await expect(source.get(base.name)).rejects.toThrow(
        "failed integrity verification",
      );
    }
    payload = {
      ...base,
      version: undefined,
      ownership: undefined,
      compatibility: undefined,
      provenance: undefined,
      integrity: undefined,
    };
    await expect(source.get(base.name)).rejects.toThrow(
      "missing version, integrity, compatibility.tuil, compatibility.renderers, provenance.source, ownership",
    );
  } finally {
    server.stop(true);
  }
});

test("HTTP indexes validate descriptors independently of item downloads", async () => {
  const base = published();
  let payload: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json(payload),
  });
  try {
    const source = new HttpRegistrySource(
      "index",
      `http://127.0.0.1:${server.port}`,
    );
    for (const [entry, message] of [
      [null, "index entry must be an object"],
      [{ ...base, files: [null] }, "index file must be an object"],
      [
        { ...base, files: [{ path: "../escape" }] },
        "Invalid registry file path",
      ],
      [
        { ...base, files: [{ path: "a.ts", target: "/outside" }] },
        "Invalid registry file target",
      ],
      [
        { ...base, files: [{ path: "a.ts", source: "../outside" }] },
        "Invalid registry file source",
      ],
      [{ ...base, ownership: "package" }, "requires packageName"],
      [{ ...base, version: "wrong" }, "invalid version compatibility metadata"],
    ] as const) {
      payload = { items: [entry] };
      await expect(source.list()).rejects.toThrow(message);
    }
    payload = [{ ...base, files: [{ path: "a.ts" }] }];
    expect((await source.list())[0]?.files).toEqual([
      { path: "a.ts", target: "a.ts", source: undefined },
    ]);
    payload = [{ ...base, files: undefined }];
    expect((await source.list())[0]?.files).toEqual([]);
  } finally {
    server.stop(true);
  }
});

test("HTTP transport rejects redirects and propagates caller cancellation", async () => {
  let redirected = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/destination") {
        redirected++;
        return Response.json([]);
      }
      return new Response(null, {
        status: 302,
        headers: { location: "/destination" },
      });
    },
  });
  try {
    const source = new HttpRegistrySource(
      "redirect",
      `http://127.0.0.1:${server.port}`,
    );
    await expect(source.list()).rejects.toThrow();
    await expect(source.get("button")).rejects.toThrow();
    expect(redirected).toBe(0);
    const controller = new AbortController();
    controller.abort();
    await expect(source.list(controller.signal)).rejects.toThrow();
    await expect(source.get("button", controller.signal)).rejects.toThrow();
    expect(redirected).toBe(0);
  } finally {
    server.stop(true);
  }
});

test("HTTP byte limits handle declared, streamed, empty, and failed bodies", async () => {
  const limit = 2 * 1_024 * 1_024;
  const source = new HttpRegistrySource(
    "bytes",
    "https://registry.example.test",
  );
  const fetchMock = spyOn(globalThis, "fetch");
  let cancelled: unknown;
  try {
    fetchMock.mockResolvedValue(
      new Response("[]", { headers: { "content-length": String(limit + 1) } }),
    );
    await expect(source.list()).rejects.toThrow("response exceeds");
    fetchMock.mockResolvedValue(new Response(null));
    await expect(source.list()).rejects.toThrow("returned invalid JSON");
    const chunks = [new Uint8Array(limit), new Uint8Array(1)];
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            const chunk = chunks.shift();
            if (chunk) controller.enqueue(chunk);
          },
          cancel(reason) {
            cancelled = reason;
          },
        }),
      ),
    );
    await expect(source.list()).rejects.toThrow("response exceeds");
    expect(cancelled).toBeInstanceOf(RangeError);
    expect((cancelled as Error).message).toContain('Registry "bytes"');
    const error = new Error("connection interrupted");
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(error);
          },
        }),
      ),
    );
    await expect(source.list()).rejects.toBe(error);
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("["));
            controller.enqueue(new TextEncoder().encode("]"));
            controller.close();
          },
        }),
        { headers: { "content-length": "unknown" } },
      ),
    );
    expect(await source.list()).toEqual([]);
    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(init).toMatchObject({ redirect: "error" });
  } finally {
    fetchMock.mockRestore();
  }
});

test("registry URL policy admits HTTPS and loopback only", () => {
  for (const value of ["", " "]) {
    expect(() => new HttpRegistrySource(value, "https://example.test")).toThrow(
      "source id cannot be empty",
    );
  }
  for (const url of [
    "file:///tmp/registry",
    "ftp://example.test",
    "http://127.0.0.2",
    "http://localhost.example.test",
  ]) {
    expect(() => new HttpRegistrySource("source", url)).toThrow(
      "must use HTTPS",
    );
  }
  for (const url of [
    "https://example.test/#fragment",
    "https://example.test/?query=yes",
  ]) {
    expect(() => new HttpRegistrySource("source", url)).toThrow(
      "query or fragment",
    );
  }
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    expect(
      new HttpRegistrySource("local", `http://${host}:4317/`).baseUrl,
    ).toBe(`http://${host}:4317`);
  }
});

test("HTTP dependency plans retain source qualification and deduplicate shared leaves", async () => {
  const root = published("root", {
    registryDependencies: ["leaf", "@official/nested/base"],
    files: [
      { path: "z.ts", target: "src/z.ts", content: "last" },
      { path: "a.ts", target: "src/a.ts", content: "first" },
    ],
  });
  const leaf = published("leaf", {
    registryDependencies: ["@official/nested/base"],
  });
  const base = published("nested/base", { registryDependencies: [] });
  const items = new Map(
    [root, leaf, base].map((item) => [`/${item.name}.json`, item]),
  );
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      const item = items.get(path);
      return item ? Response.json(item) : new Response(null, { status: 404 });
    },
  });
  try {
    const source = new HttpRegistrySource(
      "official",
      `http://127.0.0.1:${server.port}`,
    );
    const plan = await new RegistryClient([source]).resolvePlan([
      "@official/root",
      "@official/leaf",
    ]);
    expect(plan.map((item) => item.registryName)).toEqual([
      "@official/nested/base",
      "@official/leaf",
      "@official/root",
    ]);
    expect(plan.every((item) => item.sourceId === "official")).toBeTrue();
    expect(requests).toEqual(["/root.json", "/leaf.json", "/nested/base.json"]);
    expect(registryIntegrity({ ...root, files: root.files.toReversed() })).toBe(
      root.integrity,
    );
  } finally {
    server.stop(true);
  }
});
