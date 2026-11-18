import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRegistryLockfile,
  FileRegistrySource,
  parseRegistryItem,
  RegistryInstaller,
  verifyRegistryLockfile,
  type RegistryLockfile,
} from "../../../../../packages/registry/src/index";

function item(name: string, files: Record<string, string>) {
  return parseRegistryItem({
    name,
    type: "component",
    files: Object.entries(files).map(([path, content]) => ({
      path,
      target: path,
      content,
    })),
  });
}
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "tuil-registry-recovery-"));
  return { root, installer: new RegistryInstaller(root) };
}
async function metadata(root: string) {
  return Promise.all(
    ["registry.json", "registry-lock.json"].map((name) =>
      fs.readFile(join(root, ".tuil", name), "utf8"),
    ),
  );
}
async function residue(root: string) {
  return (await fs.readdir(root, { recursive: true })).filter((path) =>
    /\.tuil-(?:stage|backup|remove)-|\.tmp$|\.backup$/.test(path),
  );
}
const pair = (version: string) =>
  item("pair", {
    "left.ts": "left:" + version,
    "right.ts": "right:" + version,
  });

test("failed source commit restores prior content and metadata and permits a later retry", async () => {
  const { root, installer } = await fixture();
  try {
    await installer.install(pair("one"));
    const before = await metadata(root);
    const failure = new Error("Injected staged source rename failure");
    const rename = fs.rename;
    let triggered = false;
    const interception = spyOn(fs, "rename").mockImplementation(
      async (from, to) => {
        if (!triggered && String(from).includes("right.ts.tuil-stage-")) {
          triggered = true;
          throw failure;
        }
        return rename(from, to);
      },
    );
    try {
      await expect(installer.install(pair("two"))).rejects.toBe(failure);
    } finally {
      interception.mockRestore();
    }
    expect(triggered).toBeTrue();
    expect(await fs.readFile(join(root, "left.ts"), "utf8")).toBe("left:one");
    expect(await fs.readFile(join(root, "right.ts"), "utf8")).toBe("right:one");
    expect(await metadata(root)).toEqual(before);
    expect(await residue(root)).toEqual([]);
    expect((await installer.install(pair("two"))).updated).toEqual([
      "left.ts",
      "right.ts",
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("metadata commit failures roll back updated, created, and removed source files together", async () => {
  const { root, installer } = await fixture();
  try {
    await installer.install(
      item("bundle", { "kept.ts": "old", "dropped.ts": "retained" }),
    );
    const before = await metadata(root);
    const failure = new Error("Injected lockfile commit failure");
    const rename = fs.rename;
    let triggered = false;
    const interception = spyOn(fs, "rename").mockImplementation(
      async (from, to) => {
        if (
          !triggered &&
          String(to) === join(root, ".tuil", "registry-lock.json") &&
          String(from).endsWith(".tmp")
        ) {
          triggered = true;
          throw failure;
        }
        return rename(from, to);
      },
    );
    try {
      await expect(
        installer.install(
          item("bundle", { "kept.ts": "new", "created.ts": "new file" }),
        ),
      ).rejects.toBe(failure);
    } finally {
      interception.mockRestore();
    }
    expect(triggered).toBeTrue();
    expect(await fs.readFile(join(root, "kept.ts"), "utf8")).toBe("old");
    expect(await fs.readFile(join(root, "dropped.ts"), "utf8")).toBe(
      "retained",
    );
    expect(await Bun.file(join(root, "created.ts")).exists()).toBeFalse();
    expect(await metadata(root)).toEqual(before);
    expect(await residue(root)).toEqual([]);
    await installer.install(
      item("bundle", { "kept.ts": "new", "created.ts": "new file" }),
    );
    expect(await Bun.file(join(root, "dropped.ts")).exists()).toBeFalse();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("failed removal restores already removed files and leaves ownership metadata unchanged", async () => {
  const { root, installer } = await fixture();
  try {
    await installer.install(pair("one"));
    const before = await metadata(root);
    const rename = fs.rename;
    const failure = new Error("Injected second removal failure");
    let triggered = false;
    const interception = spyOn(fs, "rename").mockImplementation(
      async (from, to) => {
        if (
          !triggered &&
          String(from) === join(root, "right.ts") &&
          String(to).includes(".tuil-remove-")
        ) {
          triggered = true;
          throw failure;
        }
        return rename(from, to);
      },
    );
    try {
      await expect(installer.remove("pair")).rejects.toBe(failure);
    } finally {
      interception.mockRestore();
    }
    expect(triggered).toBeTrue();
    expect(await fs.readFile(join(root, "left.ts"), "utf8")).toBe("left:one");
    expect(await fs.readFile(join(root, "right.ts"), "utf8")).toBe("right:one");
    expect(await metadata(root)).toEqual(before);
    expect(await residue(root)).toEqual([]);
    expect(await installer.remove("pair")).toEqual(["left.ts", "right.ts"]);
    expect(await installer.installed()).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("lock verification diagnoses every persisted executable-input mismatch", () => {
  const entry = parseRegistryItem({
    ...item("sample", {}),
    registryName: "@official/sample",
    sourceId: "official",
    packageName: "sample-package",
    version: "1.0.0",
    dependencies: ["kleur@4"],
    registryDependencies: ["base"],
  });
  const lock = createRegistryLockfile([entry]);
  expect(verifyRegistryLockfile({ version: 1, items: {} }, [entry])).toEqual([
    "@official/sample: missing",
  ]);
  const locked = lock.items["@official/sample"]!;
  const cases: [Partial<RegistryLockfile["items"][string]>, string][] = [
    [{ integrity: "sha256-" + "0".repeat(64) }, "integrity mismatch"],
    [{ version: "2.0.0" }, "version mismatch"],
    [{ source: "untrusted" }, "source mismatch"],
    [{ packageName: "other-package" }, "package mismatch"],
    [{ packageDependencies: [] }, "package dependencies mismatch"],
    [{ dependencies: ["@other/base"] }, "registry dependencies mismatch"],
  ];
  for (const [mutation, message] of cases) {
    expect(
      verifyRegistryLockfile(
        {
          version: 1,
          items: { "@official/sample": { ...locked, ...mutation } },
        },
        [entry],
      ),
    ).toEqual(["@official/sample: " + message]);
  }
  expect(verifyRegistryLockfile(lock, [entry])).toEqual([]);
});

test("installer preflight rejects duplicate and conflicting inputs before writing", async () => {
  const { root, installer } = await fixture();
  try {
    expect(await installer.installMany([])).toEqual([]);
    expect(await installer.removeMany([])).toEqual([]);
    await expect(
      installer.installMany([pair("one"), pair("two")]),
    ).rejects.toThrow("Duplicate registry item");
    await expect(
      installer.install(
        parseRegistryItem({
          ...item("duplicate", { "a.ts": "first" }),
          files: [
            { path: "a.ts", target: "a.ts", content: "first" },
            { path: "b.ts", target: "a.ts", content: "second" },
          ],
        }),
      ),
    ).rejects.toThrow("more than once");
    await expect(
      installer.installMany([
        item("first", { "a.ts": "first" }),
        item("second", { "a.ts": "second" }),
      ]),
    ).rejects.toThrow("conflicting content");
    await expect(installer.removeMany(["absent", "absent"])).rejects.toThrow(
      "Duplicate registry item",
    );
    await expect(installer.remove("absent")).rejects.toThrow("not installed");
    await expect(
      installer.verify([
        parseRegistryItem({
          ...pair("one"),
          integrity: "sha256-" + "0".repeat(64),
        }),
      ]),
    ).rejects.toThrow("failed integrity verification");
    expect(await fs.readdir(root)).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("force updates and stale source cleanup preserve surviving shared owners", async () => {
  const { root, installer } = await fixture();
  try {
    await fs.writeFile(join(root, "source.ts"), "untracked");
    const incoming = item("source", { "source.ts": "incoming" });
    await expect(installer.install(incoming)).rejects.toThrow("untracked file");
    expect(
      (await installer.install(incoming, { force: true })).updated,
    ).toEqual(["source.ts"]);
    await fs.writeFile(join(root, "source.ts"), "local edit");
    expect(
      (await installer.install(incoming, { force: true })).updated,
    ).toEqual(["source.ts"]);
    await installer.installMany([
      item("owner-a", { "shared.ts": "shared" }),
      item("owner-b", { "shared.ts": "shared" }),
    ]);
    await installer.install(item("owner-a", {}));
    expect(await fs.readFile(join(root, "shared.ts"), "utf8")).toBe("shared");
    await fs.rm(join(root, "source.ts"));
    expect((await installer.install(item("source", {}))).removed).toEqual([
      "source.ts",
    ]);
    await fs.rm(join(root, "shared.ts"));
    expect(await installer.remove("owner-b")).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("unsupported persisted state and lockfile versions fail closed before source writes", async () => {
  const { root, installer } = await fixture();
  try {
    await fs.mkdir(join(root, ".tuil"));
    await fs.writeFile(
      join(root, ".tuil", "registry.json"),
      JSON.stringify({ version: 2, items: {} }),
    );
    await expect(installer.installed()).rejects.toThrow(
      "Unsupported registry state version",
    );
    await fs.writeFile(
      join(root, ".tuil", "registry.json"),
      JSON.stringify({ version: 1, items: {} }),
    );
    await fs.writeFile(
      join(root, ".tuil", "registry-lock.json"),
      JSON.stringify({ version: 2, items: {} }),
    );
    await expect(installer.install(pair("one"))).rejects.toThrow(
      "Unsupported registry lockfile version",
    );
    expect(await Bun.file(join(root, "left.ts")).exists()).toBeFalse();
    await fs.writeFile(
      join(root, ".tuil", "registry-lock.json"),
      JSON.stringify({ version: 1, items: {} }),
    );
    expect((await installer.install(pair("one"))).created).toEqual([
      "left.ts",
      "right.ts",
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("file indexes normalize legacy types and accept an absent item list", async () => {
  const { root } = await fixture();
  try {
    const source = new FileRegistrySource("local", root);
    await fs.writeFile(
      join(root, "registry.json"),
      JSON.stringify([{ name: "invalid", type: "invalid" }]),
    );
    await expect(source.list()).rejects.toThrow(
      "Unsupported registry item type",
    );
    await fs.writeFile(join(root, "registry.json"), JSON.stringify({}));
    expect(await source.list()).toEqual([]);
    await fs.writeFile(
      join(root, "registry.json"),
      JSON.stringify([{ name: "button", type: "registry:ui" }]),
    );
    expect(await source.list()).toEqual([
      { name: "button", type: "component", title: "button", description: "" },
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
