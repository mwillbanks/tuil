import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRegistryCodemods,
  createRegistryLockfile,
  FileRegistrySource,
  HttpRegistrySource,
  parseRegistryItem,
  provenanceComment,
  RegistryClient,
  RegistryInstaller,
  type RegistryItem,
  type RegistrySource,
  registryCompatibilityIssues,
  registryIntegrity,
  verifyRegistryLockfile,
} from "./index.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function item(content: string): RegistryItem {
  return parseRegistryItem({
    name: "button",
    type: "registry:tuil-component",
    title: "Button",
    description: "Button",
    files: [
      {
        path: "button.tsx",
        target: "src/components/tuil/button.tsx",
        content,
      },
    ],
  });
}

function remoteIndexEntry(
  name: string,
  type: string,
  title = name,
  description = "",
) {
  return {
    name,
    type,
    title,
    description,
    version: "0.2.0",
    ownership: "source",
    integrity: `sha256-${"0".repeat(64)}`,
    compatibility: { tuil: "^0.2.0", renderers: ["ink", "cell"] },
    provenance: { source: "test", license: "MIT", mode: "replace" },
    codemods: [],
    files: [],
  };
}

function remoteRegistryResponse(
  path: string,
  remoteWithoutIntegrity: RegistryItem,
  staleIntegrity: string,
): Response {
  const fixedResponses: Readonly<Record<string, () => Response>> = {
    "/good/registry.json": () =>
      Response.json({
        items: [
          remoteIndexEntry("button", "registry:tuil-ui"),
          remoteIndexEntry(
            "workflow",
            "registry:tuil-workflow",
            "Workflow",
            "Flows",
          ),
        ],
      }),
    "/array/registry.json": () =>
      Response.json([remoteIndexEntry("field", "form", "Field")]),
    "/bad/registry.json": () => Response.json({ items: "invalid" }),
    "/oversized/registry.json": () =>
      new Response("x".repeat(2 * 1_024 * 1_024 + 1)),
    "/invalid-json/registry.json": () => new Response("{"),
    "/error/registry.json": () => new Response("failed", { status: 500 }),
    "/good/failure.json": () => new Response("failed", { status: 500 }),
    "/good/invalid.json": () =>
      Response.json({
        name: "invalid",
        type: "component",
        files: [{ path: "invalid.ts" }],
      }),
    "/good/incomplete.json": () =>
      Response.json({
        name: "incomplete",
        type: "component",
        files: [],
      }),
    "/good/tampered.json": () =>
      Response.json({
        ...remoteWithoutIntegrity,
        integrity: staleIntegrity,
        files: remoteWithoutIntegrity.files.map((file) => ({
          ...file,
          content: "tampered\n",
        })),
      }),
  };
  return fixedResponses[path]?.() ?? new Response("not found", { status: 404 });
}

describe("registry installer", () => {
  test("versions, provenance, codemods, integrity, lockfiles, compatibility, and deprecation remain inspectable", () => {
    const versioned = parseRegistryItem({
      name: "editor",
      type: "component",
      version: "2.0.0",
      provenance: {
        source: "official",
        license: "MIT",
        mode: "adapt",
      },
      compatibility: {
        tuil: ">=0.2",
        renderers: ["cell"],
        capabilities: ["pointer"],
      },
      deprecated: {
        message: "Use code-editor",
        replacement: "code-editor",
      },
      codemods: [
        {
          id: "rename",
          description: "Rename old API",
          replacements: [{ from: "Old", to: "New" }],
        },
      ],
      files: [
        {
          path: "editor.ts",
          target: "src/editor.ts",
          content: "export const Old = true;\n",
        },
      ],
    });
    expect(registryIntegrity(versioned)).toStartWith("sha256-");
    expect(provenanceComment(versioned)).toContain("editor@2.0.0");
    expect(
      applyRegistryCodemods(
        versioned.files[0]?.content ?? "",
        versioned.codemods ?? [],
      ),
    ).toEqual({
      content: "export const New = true;\n",
      applied: ["rename"],
    });
    const lock = createRegistryLockfile([versioned]);
    expect(verifyRegistryLockfile(lock, [versioned])).toEqual([]);
    expect(
      registryCompatibilityIssues(versioned, {
        renderer: "ink",
        capabilities: new Set(),
      }),
    ).toEqual([
      'renderer "ink" is unsupported',
      'missing capability "pointer"',
      'TUIL version is required to verify ">=0.2"',
      "deprecated: Use code-editor",
    ]);
    expect(
      registryCompatibilityIssues(versioned, {
        renderer: "cell",
        capabilities: new Set(["pointer"]),
        tuilVersion: "0.2.0",
      }),
    ).toEqual(["deprecated: Use code-editor"]);
  });
  test("rejects unsafe dependency and file metadata during parsing", () => {
    const base = {
      name: "safe-item",
      type: "component",
      files: [
        {
          path: "nested/source.ts",
          target: "src/components/nested/source.ts",
          content: "",
        },
      ],
    };
    expect(parseRegistryItem(base).files[0]?.target).toBe(
      "src/components/nested/source.ts",
    );
    for (const dependency of [
      "--cwd=/tmp",
      "-D",
      "package\n--production",
      "package\0name",
      " package",
    ]) {
      expect(() =>
        parseRegistryItem({ ...base, dependencies: [dependency] }),
      ).toThrow(/dependenc/);
    }
    expect(() => parseRegistryItem({ ...base, dependencies: "kleur" })).toThrow(
      "must be an array",
    );
    expect(() =>
      parseRegistryItem({ ...base, registryDependencies: ["../escape"] }),
    ).toThrow("Invalid registry item path");
    for (const metadata of [
      { provenance: {} },
      { deprecated: {} },
      {
        codemods: [
          {
            description: "Missing id",
            replacements: [{ from: "before", to: "after" }],
          },
        ],
      },
      {
        codemods: [
          {
            id: "missing-description",
            replacements: [{ from: "before", to: "after" }],
          },
        ],
      },
    ]) {
      expect(() => parseRegistryItem({ ...base, ...metadata })).toThrow(
        "must be a nonempty string",
      );
    }
    for (const target of ["../escape.ts", "/tmp/escape.ts", "src//bad.ts"]) {
      expect(() =>
        parseRegistryItem({
          ...base,
          files: [{ path: "source.ts", target, content: "" }],
        }),
      ).toThrow("file target");
    }
    expect(
      () => new HttpRegistrySource("public", "http://registry.example.com"),
    ).toThrow("must use HTTPS");
    expect(
      () => new HttpRegistrySource("private", "https://user:pass@example.com"),
    ).toThrow("cannot contain credentials");
    expect(
      () => new HttpRegistrySource("query", "https://example.com/?token=one"),
    ).toThrow("query or fragment");
    expect(
      new HttpRegistrySource("local", "http://127.0.0.1:4317/registry/")
        .baseUrl,
    ).toBe("http://127.0.0.1:4317/registry");
  });

  test("installs, diffs, updates, and removes tracked source", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const first = await installer.install(item("export const value = 1;\n"));
    expect(
      JSON.parse(await readFile(join(root, ".tuil/registry-lock.json"), "utf8"))
        .items.button.integrity,
    ).toStartWith("sha256-");
    expect(first.created).toEqual(["src/components/tuil/button.tsx"]);
    expect(
      (await installer.diff(item("export const value = 1;\n")))[0]?.status,
    ).toBe("unchanged");
    const update = await installer.install(item("export const value = 2;\n"));
    expect(update.updated).toEqual(["src/components/tuil/button.tsx"]);
    expect(
      await readFile(join(root, "src/components/tuil/button.tsx"), "utf8"),
    ).toContain("2");
    expect(await installer.remove("button")).toEqual([
      "src/components/tuil/button.tsx",
    ]);
  });

  test("enforces compatibility and frozen lockfiles before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-lock-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const compatible = parseRegistryItem({
      ...item("export const value = 1;\n"),
      version: "0.2.0",
      compatibility: { tuil: "^0.2.0", renderers: ["cell"] },
    });
    await expect(
      installer.install(compatible, {
        environment: {
          renderer: "ink",
          capabilities: new Set(),
          tuilVersion: "0.2.0",
        },
      }),
    ).rejects.toThrow("incompatible");
    await installer.install(compatible, {
      environment: {
        renderer: "cell",
        capabilities: new Set(),
        tuilVersion: "0.2.0",
      },
    });
    const updated = parseRegistryItem({
      ...compatible,
      version: "0.2.1",
      files: compatible.files.map((file) => ({
        ...file,
        content: "export const value = 2;\n",
      })),
    });
    await expect(
      installer.install(updated, {
        frozenLockfile: true,
        environment: {
          renderer: "cell",
          capabilities: new Set(),
          tuilVersion: "0.2.0",
        },
      }),
    ).rejects.toThrow("lockfile verification failed");
  });

  test("locks every executable input and escapes provenance metadata", async () => {
    const base = parseRegistryItem({
      ...item("export const value = 1;\n"),
      version: "1.0.0",
      sourceId: "official",
      dependencies: ["safe-package@1.0.0"],
      provenance: { source: "https://example.test/component" },
    });
    const lock = createRegistryLockfile([base]);
    const mutations = [
      { dependencies: ["unsafe-package@1.0.0"] },
      {
        codemods: [
          {
            id: "inject",
            description: "Inject code",
            replacements: [{ from: "1", to: "execute()" }],
          },
        ],
      },
      { sourceId: "mirror" },
      { packageName: "package-owned@2.0.0" },
      { registryDependencies: ["dialog"] },
    ];
    for (const mutation of mutations) {
      const changed = parseRegistryItem({ ...base, ...mutation });
      expect(verifyRegistryLockfile(lock, [changed])).not.toEqual([]);
      if (!("sourceId" in mutation)) {
        expect(registryIntegrity(changed)).not.toBe(registryIntegrity(base));
      }
    }
    const escaped = parseRegistryItem({
      ...base,
      provenance: { source: "trusted\nexport const compromised = true" },
    });
    expect(provenanceComment(escaped)).not.toContain("\n");
    expect(provenanceComment(escaped)).toContain("%0A");
  });

  test("install and diff share codemod and provenance transformations", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-diff-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const versioned = parseRegistryItem({
      ...item("export const Old = 1;\n"),
      version: "1.0.0",
      provenance: { source: "official" },
      codemods: [
        {
          id: "rename",
          description: "Rename symbol",
          replacements: [{ from: "Old", to: "New" }],
        },
      ],
    });
    await installer.install(versioned);
    expect((await installer.diff(versioned))[0]?.status).toBe("unchanged");
    await writeFile(
      join(root, "src/components/tuil/button.tsx"),
      `${provenanceComment(versioned)}\nexport const New = 2;\n`,
    );
    expect((await installer.diff(versioned))[0]?.status).toBe("modified");
  });

  test("protects local modifications and path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    await installer.install(item("original\n"));
    await writeFile(
      join(root, "src/components/tuil/button.tsx"),
      "local edit\n",
    );
    await expect(installer.install(item("incoming\n"))).rejects.toThrow(
      "locally modified",
    );
    expect(() =>
      parseRegistryItem({
        name: "escape",
        type: "component",
        files: [{ path: "escape.ts", target: "../escape.ts", content: "" }],
      }),
    ).toThrow("Invalid registry file target");
  });

  test("rejects targets beneath symbolic-link ancestors", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    const outside = await mkdtemp(join(tmpdir(), "tuil-outside-"));
    directories.push(root, outside);
    await mkdir(join(outside, "destination"));
    await symlink(join(outside, "destination"), join(root, "linked"));
    const installer = new RegistryInstaller(root);
    await expect(
      installer.install(
        parseRegistryItem({
          name: "escape",
          type: "component",
          files: [
            {
              path: "escape.ts",
              target: "linked/escape.ts",
              content: "escaped\n",
            },
          ],
        }),
      ),
    ).rejects.toThrow("symbolic link");
    expect(
      await Bun.file(join(outside, "destination/escape.ts")).exists(),
    ).toBeFalse();
  });

  test("preflights every write and removal before mutating files", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const pair = (left: string, right: string) =>
      parseRegistryItem({
        name: "pair",
        type: "component",
        files: [
          { path: "left.ts", target: "src/left.ts", content: left },
          { path: "right.ts", target: "src/right.ts", content: right },
        ],
      });
    await installer.install(pair("left:1\n", "right:1\n"));
    await writeFile(join(root, "src/right.ts"), "local\n");
    await expect(
      installer.install(pair("left:2\n", "right:2\n")),
    ).rejects.toThrow("locally modified");
    expect(await readFile(join(root, "src/left.ts"), "utf8")).toBe("left:1\n");
    await expect(installer.remove("pair")).rejects.toThrow("locally modified");
    expect(await readFile(join(root, "src/left.ts"), "utf8")).toBe("left:1\n");
  });

  test("removes multiple items atomically and preserves shared ownership", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const namedItem = (name: string, target: string, content: string) =>
      parseRegistryItem({
        name,
        type: "component",
        files: [{ path: target, target, content }],
      });
    await installer.installMany([
      namedItem("left", "src/left.ts", "left\n"),
      namedItem("right", "src/right.ts", "right\n"),
    ]);
    await writeFile(join(root, "src/right.ts"), "local\n");
    await expect(installer.removeMany(["left", "right"])).rejects.toThrow(
      "locally modified",
    );
    expect(await readFile(join(root, "src/left.ts"), "utf8")).toBe("left\n");

    await writeFile(join(root, "src/right.ts"), "right\n");
    await installer.installMany([
      namedItem("owner-a", "src/shared.ts", "shared\n"),
      namedItem("owner-b", "src/shared.ts", "shared\n"),
    ]);
    expect(await installer.remove("owner-a")).toEqual([]);
    expect(await readFile(join(root, "src/shared.ts"), "utf8")).toBe(
      "shared\n",
    );
    expect(await installer.remove("owner-b")).toEqual(["src/shared.ts"]);
  });

  test("prevents removal of source owners required by installed aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const owner = parseRegistryItem({
      name: "field",
      type: "form",
      files: [
        {
          path: "controls.tsx",
          target: "src/controls.tsx",
          content: "export const field = true;\n",
        },
      ],
    });
    const alias = parseRegistryItem({
      name: "text-input",
      type: "form",
      registryDependencies: ["field"],
      files: [],
    });
    await installer.installMany([owner, alias]);
    await expect(installer.remove("field")).rejects.toThrow(
      'dependent "text-input" remains installed',
    );
    expect(await Bun.file(join(root, "src/controls.tsx")).exists()).toBeTrue();
    await installer.removeMany(["text-input", "field"]);
    expect(await Bun.file(join(root, "src/controls.tsx")).exists()).toBeFalse();
  });

  test("removes files dropped by updates without orphaning local changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const version = (includeLegacy: boolean) =>
      parseRegistryItem({
        name: "evolving",
        type: "component",
        files: [
          {
            path: "current.ts",
            target: "src/current.ts",
            content: "current\n",
          },
          ...(includeLegacy
            ? [
                {
                  path: "legacy.ts",
                  target: "src/legacy.ts",
                  content: "legacy\n",
                },
              ]
            : []),
        ],
      });
    await installer.install(version(true));
    const updated = await installer.install(version(false));
    expect(updated.removed).toEqual(["src/legacy.ts"]);
    expect(await Bun.file(join(root, "src/legacy.ts")).exists()).toBeFalse();

    await installer.install(version(true));
    await writeFile(join(root, "src/legacy.ts"), "local\n");
    await expect(installer.install(version(false))).rejects.toThrow(
      "locally modified",
    );
    expect(await readFile(join(root, "src/legacy.ts"), "utf8")).toBe("local\n");
  });

  test("requires all shared owners to participate in content updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const owner = (name: string, content: string) =>
      parseRegistryItem({
        name,
        type: "component",
        files: [
          {
            path: "shared.ts",
            target: "src/shared.ts",
            content,
          },
        ],
      });
    await installer.installMany([
      owner("owner-a", "one\n"),
      owner("owner-b", "one\n"),
    ]);
    await expect(installer.install(owner("owner-a", "two\n"))).rejects.toThrow(
      'without also updating owner "owner-b"',
    );
    await installer.installMany([
      owner("owner-a", "two\n"),
      owner("owner-b", "two\n"),
    ]);
    expect(await readFile(join(root, "src/shared.ts"), "utf8")).toBe("two\n");
  });

  test("preserves qualified source identities in installation state", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const source = (id: string, target: string): RegistrySource => ({
      id,
      async get(name) {
        if (name !== "button") return undefined;
        const published = parseRegistryItem({
          name: "button",
          type: "component",
          version: "0.2.0",
          ownership: "source",
          compatibility: { tuil: "^0.2.0", renderers: ["ink", "cell"] },
          provenance: { source: id, license: "MIT", mode: "replace" },
          files: [
            {
              path: "button.ts",
              target,
              content: `export const source = "${id}";\n`,
            },
          ],
        });
        return parseRegistryItem({
          ...published,
          integrity: registryIntegrity(published),
        });
      },
      async list() {
        return [];
      },
    });
    const client = new RegistryClient([
      source("first", "src/first.ts"),
      source("second", "src/second.ts"),
    ]);
    const plan = await client.resolvePlan(["@first/button", "@second/button"]);
    const installer = new RegistryInstaller(root);
    const results = await installer.installMany(plan, {
      environment: {
        renderer: "ink",
        capabilities: new Set(),
        tuilVersion: "0.2.0",
      },
    });
    expect(results.map((result) => result.item)).toEqual([
      "@first/button",
      "@second/button",
    ]);
    expect(await installer.installed()).toEqual([
      "@first/button",
      "@second/button",
    ]);
    expect(await installer.remove("@first/button")).toEqual(["src/first.ts"]);
    expect(await Bun.file(join(root, "src/second.ts")).exists()).toBeTrue();
  });

  test("rejects registry source path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const source = new FileRegistrySource("local", root);
    await expect(source.get("../outside")).rejects.toThrow(
      "Invalid registry item path",
    );
  });

  test("reads and validates local registry items and indexes", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-local-registry-"));
    directories.push(root);
    await writeFile(
      join(root, "registry.json"),
      JSON.stringify({ items: [{ name: "button", type: "component" }] }),
    );
    await writeFile(
      join(root, "button.json"),
      JSON.stringify({
        name: "button",
        type: "component",
        files: [
          {
            path: "button.ts",
            target: "button.ts",
            content: "button\n",
          },
        ],
      }),
    );
    await writeFile(
      join(root, "invalid.json"),
      JSON.stringify({
        name: "invalid",
        type: "component",
        files: [{ path: "invalid.ts" }],
      }),
    );
    const source = new FileRegistrySource("local", root);
    expect((await source.get("button"))?.name).toBe("button");
    expect(await source.get("missing")).toBeUndefined();
    expect(await source.list()).toHaveLength(1);
    await expect(source.get("invalid")).rejects.toThrow("inline every file");
  });

  test("installs a registry item delivered over HTTP with inline content", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const itemWithoutIntegrity = parseRegistryItem({
      name: "button",
      type: "component",
      version: "0.2.0",
      ownership: "source",
      compatibility: { tuil: "^0.2.0", renderers: ["ink", "cell"] },
      provenance: { source: "test", license: "MIT", mode: "replace" },
      files: [
        {
          path: "button.ts",
          target: "src/button.ts",
          content: "export const button = true;\n",
        },
      ],
    });
    const publishedItem = {
      ...itemWithoutIntegrity,
      integrity: registryIntegrity(itemWithoutIntegrity),
    };
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/button.json") {
          return Response.json(publishedItem);
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const source = new HttpRegistrySource(
        "test",
        `http://127.0.0.1:${server.port}`,
      );
      const remote = await source.get("button");
      expect(remote).toBeDefined();
      await new RegistryInstaller(root).install(remote as RegistryItem, {
        environment: {
          renderer: "ink",
          capabilities: new Set(),
          tuilVersion: "0.2.0",
        },
      });
      expect(await readFile(join(root, "src/button.ts"), "utf8")).toContain(
        "button = true",
      );
    } finally {
      server.stop(true);
    }
  });

  test("normalizes HTTP indexes and reports malformed remote responses", async () => {
    const remoteWithoutIntegrity = parseRegistryItem({
      name: "tampered",
      type: "component",
      version: "0.2.0",
      ownership: "source",
      compatibility: { tuil: "^0.2.0", renderers: ["ink"] },
      provenance: { source: "test", license: "MIT", mode: "replace" },
      files: [
        {
          path: "tampered.ts",
          target: "tampered.ts",
          content: "safe\n",
        },
      ],
    });
    const staleIntegrity = registryIntegrity(remoteWithoutIntegrity);
    const server = Bun.serve({
      port: 0,
      fetch: (request) =>
        remoteRegistryResponse(
          new URL(request.url).pathname,
          remoteWithoutIntegrity,
          staleIntegrity,
        ),
    });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      const good = new HttpRegistrySource("good", `${origin}/good/`);
      const listed = await good.list();
      expect(
        listed.map(({ name, type, title, description }) => ({
          name,
          type,
          title,
          description,
        })),
      ).toEqual([
        {
          name: "button",
          type: "component",
          title: "button",
          description: "",
        },
        {
          name: "workflow",
          type: "workflow",
          title: "Workflow",
          description: "Flows",
        },
      ]);
      expect(listed.every((entry) => entry.version === "0.2.0")).toBeTrue();
      expect(
        listed.every((entry) => entry.integrity?.startsWith("sha256-")),
      ).toBeTrue();
      expect(listed[0]).toMatchObject({
        ownership: "source",
        compatibility: { tuil: "^0.2.0", renderers: ["ink", "cell"] },
        codemods: [],
        provenance: { source: "test", license: "MIT", mode: "replace" },
        files: [],
      });
      expect(
        await new HttpRegistrySource("array", `${origin}/array`).list(),
      ).toHaveLength(1);
      expect(await good.get("missing")).toBeUndefined();
      await expect(good.get("invalid")).rejects.toThrow("inline every file");
      await expect(good.get("incomplete")).rejects.toThrow(
        "missing version, integrity",
      );
      await expect(good.get("tampered")).rejects.toThrow(
        "failed integrity verification",
      );
      await expect(good.get("failure")).rejects.toThrow("returned 500");
      await expect(
        new HttpRegistrySource("bad", `${origin}/bad`).list(),
      ).rejects.toThrow("index must be an array");
      await expect(
        new HttpRegistrySource("error", `${origin}/error`).list(),
      ).rejects.toThrow("returned 500");
      await expect(
        new HttpRegistrySource("oversized", `${origin}/oversized`).list(),
      ).rejects.toThrow("response exceeds");
      await expect(
        new HttpRegistrySource("invalid-json", `${origin}/invalid-json`).list(),
      ).rejects.toThrow("returned invalid JSON");
    } finally {
      server.stop(true);
    }
  });

  test("combines registry sources, searches, and diagnoses dependency plans", async () => {
    const entry = {
      name: "button",
      type: "component" as const,
      title: "Button",
      description: "Interactive control",
    };
    const successful: RegistrySource = {
      id: "good",
      async get(name) {
        if (name === "missing") return undefined;
        return parseRegistryItem({
          name,
          type: "component",
          registryDependencies:
            name === "cycle-a"
              ? ["cycle-b"]
              : name === "cycle-b"
                ? ["cycle-a"]
                : [],
          files: [],
        });
      },
      async list() {
        return [entry];
      },
    };
    const duplicate: RegistrySource = {
      id: "duplicate",
      async get() {
        return undefined;
      },
      async list() {
        return [entry, { ...entry, name: "field", title: "Field" }];
      },
    };
    const failing: RegistrySource = {
      id: "failing",
      async get() {
        throw new Error("get failed");
      },
      async list() {
        throw new Error("list failed");
      },
    };
    const client = new RegistryClient([failing, successful, duplicate]);
    expect(await client.list()).toHaveLength(2);
    expect((await client.search("interactive"))[0]?.name).toBe("button");
    expect(await client.search("absent")).toEqual([]);
    expect((await client.get("@good/button")).sourceId).toBe("good");
    await expect(client.get("@unknown/button")).rejects.toThrow(
      "was not found",
    );
    await expect(
      new RegistryClient([successful]).resolvePlan(["cycle-a"]),
    ).rejects.toThrow("dependency cycle");
    expect(() => new RegistryClient([])).toThrow("at least one source");
    await expect(new RegistryClient([failing]).list()).rejects.toThrow(
      "Every registry source failed",
    );
  });

  test("transforms installed sources and renders modified and missing diffs", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-transform-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const transformed = parseRegistryItem({
      name: "transform",
      type: "component",
      files: [
        {
          path: "component.ts",
          target: "src/component.ts",
          content:
            'import "@/components/tuil/button";\nconst tone = "danger";\n',
        },
      ],
    });
    const options = {
      importAliases: { button: "control" },
      componentDirectory: "~/ui",
      themeTokens: { danger: "critical" },
      format: (content: string, target: string) =>
        `${content}// formatted ${target}\n`,
    };
    await installer.install(transformed, options);
    expect(await readFile(join(root, "src/component.ts"), "utf8")).toContain(
      'import "~/ui/control"',
    );
    const modified = await installer.diff(item("export const value = 3;\n"));
    expect(modified[0]).toMatchObject({ status: "missing" });
    await writeFile(join(root, "src/component.ts"), "local\nsecond line\n");
    const difference = await installer.diff(transformed, options);
    expect(difference[0]?.status).toBe("modified");
    expect(difference[0]?.diff).toContain("-local");
    expect(difference[0]?.diff).toContain("+import");
  });
});
