import { expect, test } from "bun:test";
import {
  notesDraft,
  notesManifest,
  prepareReleaseNotes,
  releaseVersions,
  renderReleaseNotes,
} from "./notes.ts";

function fixture() {
  return new Map([
    [
      ".release-please-manifest.json",
      JSON.stringify({
        "packages/core": "1.1.0",
        "packages/tuil": "1.2.0",
        "packages/events": "0.2.0",
      }),
    ],
    [
      "release-please-config.json",
      JSON.stringify({
        packages: {
          "packages/core": { component: "tuil-core" },
          "packages/tuil": { component: "tuil" },
          "packages/events": { component: "tuil-events" },
        },
      }),
    ],
    [notesManifest, "{}\n"],
    [
      notesDraft,
      "---\ntitle: Upcoming release\n---\n\nAuthored behavior and [guide](/docs/guides/testing/).\n",
    ],
    [
      "CHANGELOG.md",
      "# Changelog\n\n## NEXT_RELEASE\n\nAn authored summary.\n\n## Earlier\n\nPreserve this entry.\n",
    ],
  ]);
}

const previous = {
  "packages/core": "1.0.0",
  "packages/tuil": "1.1.0",
  "packages/events": "0.2.0",
};

function apply(
  files: Map<string, string>,
  changes: ReturnType<typeof prepareReleaseNotes>,
) {
  const result = new Map(files);
  for (const [path, content] of changes.additions) result.set(path, content);
  for (const path of changes.deletions) result.delete(path);
  return result;
}

test("stamp independent changed package versions and preserve history", () => {
  const files = fixture();
  const result = prepareReleaseNotes(files, previous);
  expect(Object.keys(result.releases)).toEqual([
    "packages/core",
    "packages/tuil",
  ]);
  expect(result.releases["packages/core"]?.version).toBe("1.1.0");
  expect(result.releases["packages/tuil"]?.version).toBe("1.2.0");
  expect(result.additions.get("CHANGELOG.md")).toContain(
    "An authored summary.",
  );
  expect(result.additions.get("CHANGELOG.md")).toContain(
    "| tuil-core | 1.1.0 |",
  );
  expect(result.additions.get("CHANGELOG.md")).toContain(
    "## Earlier\n\nPreserve this entry.",
  );
  expect(result.additions.has("packages/core/CHANGELOG.md")).toBe(false);
  expect(result.deletions).toEqual([notesDraft]);
  const checked = prepareReleaseNotes(apply(files, result), previous);
  expect(checked.additions.size).toBe(0);
  expect(checked.deletions).toEqual([]);
});

test("resume interrupted stamping after all additions were written", () => {
  const files = fixture();
  const result = prepareReleaseNotes(files, previous);
  const interrupted = new Map(files);
  for (const [path, content] of result.additions)
    interrupted.set(path, content);
  expect(prepareReleaseNotes(interrupted, previous).deletions).toEqual([
    notesDraft,
  ]);
});

test("resume every completed write boundary and reject conflicting recovery", () => {
  const files = fixture();
  const changes = prepareReleaseNotes(files, previous);
  const complete = apply(files, changes);
  const additions = [...changes.additions];
  expect(additions.at(-1)?.[0]).toBe("CHANGELOG.md");
  for (let written = 0; written <= additions.length; written += 1) {
    const interrupted = new Map(files);
    for (const [path, content] of additions.slice(0, written))
      interrupted.set(path, content);
    expect(
      apply(interrupted, prepareReleaseNotes(interrupted, previous)),
    ).toEqual(complete);
  }
  const interrupted = new Map(files);
  for (const [path, content] of changes.additions)
    interrupted.set(path, content);
  interrupted.set(notesManifest, "{}");
  expect(() => prepareReleaseNotes(interrupted, previous)).toThrow(
    "Missing release map entry",
  );
});

test("resume interrupted stamping after one identical note was written", () => {
  const files = fixture();
  const result = prepareReleaseNotes(files, previous);
  const [path, content] = [...result.additions][0]!;
  files.set(path, content);
  const resumed = prepareReleaseNotes(files, previous);
  expect(resumed.additions.has(path)).toBe(false);
});

test("reject conflicting existing release pages", () => {
  const files = fixture();
  files.set(
    "apps/docs/content/docs/releases/tuil-core-1.1.0.mdx",
    "Conflicting notes",
  );
  expect(() => prepareReleaseNotes(files, previous)).toThrow(
    "Release page already exists",
  );
});

test("require authored content and correct version map", () => {
  const files = fixture();
  files.delete(notesDraft);
  expect(() => prepareReleaseNotes(files, previous)).toThrow();
  const stamped = apply(fixture(), prepareReleaseNotes(fixture(), previous));
  stamped.set(notesManifest, "{}");
  expect(() => prepareReleaseNotes(stamped, previous)).toThrow(
    "Missing release map entry",
  );
});

test("reject a candidate without changed versions", () => {
  expect(() =>
    prepareReleaseNotes(fixture(), {
      "packages/core": "1.1.0",
      "packages/tuil": "1.2.0",
      "packages/events": "0.2.0",
    }),
  ).toThrow("no changed versions");
});

test("reject invalid version and path identities", () => {
  for (const value of [
    null,
    [],
    { "../outside": "1.0.0" },
    { "packages/core": "1.0.0; command" },
    { "packages/core": 1 },
  ]) {
    expect(() => releaseVersions(value)).toThrow();
  }
  const files = fixture();
  files.set(
    "release-please-config.json",
    '{"packages":{"packages/core":{"component":"../core"}}}',
  );
  expect(() => prepareReleaseNotes(files, previous)).toThrow(
    "Invalid release component",
  );
});

const release = {
  component: "tuil-core",
  version: "1.1.0",
  path: "apps/docs/content/docs/releases/tuil-core-1.1.0.mdx",
};

test("render portable Markdown with absolute docs links", () => {
  const source =
    "---\ntitle: tuil-core 1.1.0\n---\n\n[Guide](/docs/guides/testing/)\n\n~~~mermaid\nflowchart LR\nA --> B\n~~~\n\n~~~ts\nconst value = 1;\n~~~\n";
  const markdown = renderReleaseNotes(source, release);
  expect(markdown).toContain(
    "https://mwillbanks.github.io/tuil/docs/guides/testing/",
  );
  expect(markdown).toContain("const value = 1;");
  expect(markdown).not.toContain("flowchart");
  expect(markdown).toContain("/docs/releases/tuil-core-1.1.0/");
});

test("reject unresolved placeholders, MDX, empty bodies, and unclosed fences", () => {
  for (const body of [
    "NEXT_RELEASE",
    "<Widget />",
    "import Widget from './widget'",
    "",
    "~~~ts\nconst value = 1;",
  ]) {
    expect(() =>
      renderReleaseNotes(
        "---\ntitle: tuil-core 1.1.0\n---\n\n" + body,
        release,
      ),
    ).toThrow();
  }
  expect(() =>
    renderReleaseNotes("---\ntitle: Wrong version\n---\n\nBody", release),
  ).toThrow("title must match");
});
