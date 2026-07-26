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
  FileRegistrySource,
  HttpRegistrySource,
  parseRegistryItem,
  RegistryClient,
  RegistryInstaller,
  type RegistryItem,
  type RegistrySource,
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

describe("registry installer", () => {
  test("installs, diffs, updates, and removes tracked source", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const installer = new RegistryInstaller(root);
    const first = await installer.install(item("export const value = 1;\n"));
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
    await expect(
      installer.install(
        parseRegistryItem({
          name: "escape",
          type: "component",
          files: [{ path: "escape.ts", target: "../escape.ts", content: "" }],
        }),
      ),
    ).rejects.toThrow("escapes project root");
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
        return parseRegistryItem({
          name: "button",
          type: "component",
          files: [
            {
              path: "button.ts",
              target,
              content: `export const source = "${id}";\n`,
            },
          ],
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
    const results = await installer.installMany(plan);
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

  test("installs a registry item delivered over HTTP with inline content", async () => {
    const root = await mkdtemp(join(tmpdir(), "tuil-registry-"));
    directories.push(root);
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/button.json") {
          return Response.json({
            name: "button",
            type: "component",
            files: [
              {
                path: "button.ts",
                target: "src/button.ts",
                content: "export const button = true;\n",
              },
            ],
          });
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
      await new RegistryInstaller(root).install(remote as RegistryItem);
      expect(await readFile(join(root, "src/button.ts"), "utf8")).toContain(
        "button = true",
      );
    } finally {
      server.stop(true);
    }
  });
});
