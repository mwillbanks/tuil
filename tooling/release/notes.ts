import { resolve } from "node:path";

export const notesRoot = "apps/docs/content/docs/releases";
export const notesDraft = notesRoot + "/next.mdx";
export const notesManifest = "tooling/release/notes-manifest.json";
const documentationRoot = "https://mwillbanks.github.io/tuil";
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const packagePath = /^packages\/[a-z][a-z0-9-]*$/;
const componentName = /^[a-z][a-z0-9-]*$/;

export interface NoteReference {
  readonly component: string;
  readonly version: string;
  readonly path: string;
}

export type NoteManifest = Readonly<Record<string, NoteReference>>;

interface ReleaseConfiguration {
  readonly packages: Readonly<Record<string, { readonly component: string }>>;
}

export interface ReleaseNoteChanges {
  readonly additions: ReadonlyMap<string, string>;
  readonly deletions: readonly string[];
  readonly releases: NoteManifest;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid " + label);
  }
  return value as Record<string, unknown>;
}

export function releaseVersions(
  value: unknown,
): Readonly<Record<string, string>> {
  const entries = Object.entries(object(value, "release manifest"));
  for (const [path, version] of entries) {
    if (
      !packagePath.test(path) ||
      typeof version !== "string" ||
      !stableVersion.test(version)
    ) {
      throw new Error("Invalid release identity: " + path);
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function reference(
  path: string,
  version: string,
  config: ReleaseConfiguration,
): NoteReference {
  const component = config.packages[path]?.component;
  if (
    !packagePath.test(path) ||
    !component ||
    !componentName.test(component) ||
    !stableVersion.test(version)
  ) {
    throw new Error("Invalid release component: " + path);
  }
  return {
    component,
    version,
    path: notesRoot + "/" + component + "-" + version + ".mdx",
  };
}

function readBody(source: string, title: string): string {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!header) throw new Error("Release notes require MDX front matter");
  const data = object(Bun.YAML.parse(header[1]!), "release front matter");
  if (data["title"] !== title)
    throw new Error("Release notes title must match " + title);
  return source.slice(header[0].length).replaceAll("\r\n", "\n").trim();
}

interface MarkdownFence {
  readonly delimiter: string;
  readonly skip: boolean;
}

function appendFencedLine(
  line: string,
  fence: MarkdownFence,
  lines: string[],
): MarkdownFence | undefined {
  if (!fence.skip) lines.push(line);
  const closing = new RegExp(
    "^ {0,3}" +
      fence.delimiter[0] +
      "{" +
      fence.delimiter.length +
      ",}[ \\t]*$",
  );
  return closing.test(line) ? undefined : fence;
}

function portableMarkdownLine(line: string): string {
  if (/^(?:import|export)\s|<\/?[A-Z][A-Za-z0-9]*(?:\s|\/?>)/.test(line)) {
    throw new Error("Release notes must use portable Markdown");
  }
  return line.replaceAll(
    /(\]\(|^ {0,3}\[[^\]]+\]:[ \t]+)(\/docs(?:\/|(?=[)#?\s]))[^\s)>]*)/g,
    (_match, prefix: string, path: string) => prefix + documentationRoot + path,
  );
}

function renderMarkdownBody(body: string): string {
  const lines: string[] = [];
  let fence: MarkdownFence | undefined;
  for (const line of body.split("\n")) {
    if (fence) {
      fence = appendFencedLine(line, fence, lines);
      continue;
    }
    const opening = /^ {0,3}(\x60{3,}|~{3,})[ \t]*(\S*)/.exec(line);
    if (opening) {
      fence = { delimiter: opening[1]!, skip: opening[2] === "mermaid" };
      if (!fence.skip) lines.push(line);
      continue;
    }
    lines.push(portableMarkdownLine(line));
  }
  const markdown = lines.join("\n").trim();
  if (fence || !markdown || /\bNEXT_RELEASE\b/.test(markdown))
    throw new Error("Invalid release notes body");
  return markdown;
}

export function renderReleaseNotes(
  source: string,
  release: NoteReference,
): string {
  const body = readBody(source, release.component + " " + release.version);
  return (
    renderMarkdownBody(body) +
    "\n\n[Read the release notes](" +
    documentationRoot +
    "/docs/releases/" +
    release.component +
    "-" +
    release.version +
    "/).\n"
  );
}

function required(files: ReadonlyMap<string, string>, path: string): string {
  const source = files.get(path);
  if (!source) throw new Error("Missing authored release input: " + path);
  return source;
}

function authoredChangelog(changelog: string): {
  readonly summary: string;
  readonly history: string;
} {
  const heading = changelog.indexOf("\n## NEXT_RELEASE");
  const historyStart = changelog.indexOf("\n## ", heading + 1);
  const summary = changelog
    .slice(
      heading + "\n## NEXT_RELEASE".length,
      historyStart < 0 ? undefined : historyStart,
    )
    .trim();
  const history = historyStart < 0 ? "" : changelog.slice(historyStart);
  if (!summary || /\bNEXT_RELEASE\b/.test(summary + history))
    throw new Error("Invalid authored changelog summary");
  return { summary, history };
}

function authoredReleasePage(body: string, release: NoteReference): string {
  const title = release.component + " " + release.version;
  return (
    "---\ntitle: " +
    title +
    "\ndescription: Curated release notes for " +
    title +
    ".\nicon: Article\n---\n\n" +
    body +
    "\n"
  );
}

function releaseChangelogRow(release: NoteReference): string {
  return (
    "| " +
    release.component +
    " | " +
    release.version +
    " | [Notes](" +
    documentationRoot +
    "/docs/releases/" +
    release.component +
    "-" +
    release.version +
    "/) |"
  );
}

function stampAuthoredNotes(
  files: ReadonlyMap<string, string>,
  releases: NoteManifest,
  stored: Record<string, unknown>,
  draft: string,
  changelog: string,
): ReadonlyMap<string, string> {
  if (
    !/^# Changelog\r?\n/.test(changelog) ||
    !/^## NEXT_RELEASE$/m.test(changelog)
  ) {
    throw new Error("The authored changelog must contain NEXT_RELEASE");
  }
  const body = readBody(draft, "Upcoming release");
  const { summary, history } = authoredChangelog(changelog);
  const additions = new Map<string, string>();
  const rows: string[] = [];
  for (const [path, release] of Object.entries(releases)) {
    const page = authoredReleasePage(body, release);
    renderReleaseNotes(page, release);
    const existingPage = files.get(release.path);
    if (existingPage !== undefined && existingPage !== page)
      throw new Error("Release page already exists: " + release.path);
    if (existingPage === undefined) additions.set(release.path, page);
    stored[path] = release;
    rows.push(releaseChangelogRow(release));
  }
  additions.set(notesManifest, JSON.stringify(stored, null, 2) + "\n");
  // The changelog commits the stamp only after its pages and version map exist.
  const primary = releases["packages/tuil"] ?? Object.values(releases)[0]!;
  additions.set(
    "CHANGELOG.md",
    "# Changelog\n\n## " +
      primary.component +
      " " +
      primary.version +
      "\n\n" +
      summary +
      "\n\n| Package | Version | Release notes |\n| --- | --- | --- |\n" +
      rows.join("\n") +
      history +
      "\n",
  );
  return additions;
}

function verifyStampedNotes(
  files: ReadonlyMap<string, string>,
  releases: NoteManifest,
  stored: Record<string, unknown>,
  changelog: string,
): void {
  if (/\bNEXT_RELEASE\b/.test(changelog))
    throw new Error("Unresolved release changelog placeholder");
  for (const [path, release] of Object.entries(releases)) {
    if (JSON.stringify(stored[path]) !== JSON.stringify(release))
      throw new Error("Missing release map entry: " + path);
    renderReleaseNotes(required(files, release.path), release);
    if (
      !new RegExp(
        "\\|\\s*" +
          release.component +
          "\\s*\\|\\s*" +
          release.version.replaceAll(".", "\\.") +
          "\\s*\\|",
      ).test(changelog)
    ) {
      throw new Error("Missing release changelog entry: " + path);
    }
  }
}

export function prepareReleaseNotes(
  files: ReadonlyMap<string, string>,
  previousInput: unknown,
): ReleaseNoteChanges {
  const versions = releaseVersions(
    JSON.parse(required(files, ".release-please-manifest.json")),
  );
  const previous = releaseVersions(previousInput);
  const config = JSON.parse(
    required(files, "release-please-config.json"),
  ) as ReleaseConfiguration;
  object(config.packages, "release configuration");
  const releases = Object.fromEntries(
    Object.entries(versions)
      .filter(([path, version]) => previous[path] !== version)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, version]) => [path, reference(path, version, config)]),
  );
  if (Object.keys(releases).length === 0)
    throw new Error("Release candidate has no changed versions");
  const stored = object(
    JSON.parse(required(files, notesManifest)),
    "release note map",
  );
  const draft = files.get(notesDraft);
  const changelog = required(files, "CHANGELOG.md");
  if (draft !== undefined && !/^## NEXT_RELEASE$/m.test(changelog)) {
    const resumed = new Map(files);
    resumed.delete(notesDraft);
    const verified = prepareReleaseNotes(resumed, previous);
    return { ...verified, deletions: [notesDraft] };
  }
  if (draft !== undefined) {
    return {
      additions: stampAuthoredNotes(files, releases, stored, draft, changelog),
      deletions: [notesDraft],
      releases,
    };
  }
  verifyStampedNotes(files, releases, stored, changelog);
  return { additions: new Map(), deletions: [], releases };
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(stderr || "Git release input failed");
  return stdout.trim();
}

async function loadFiles(root: string): Promise<Map<string, string>> {
  const paths = [
    ".release-please-manifest.json",
    "release-please-config.json",
    "CHANGELOG.md",
    notesManifest,
    notesDraft,
  ];
  for await (const path of new Bun.Glob(notesRoot + "/*.mdx").scan(root))
    paths.push(path);
  const files = new Map<string, string>();
  for (const path of new Set(paths)) {
    const file = Bun.file(resolve(root, path));
    if (await file.exists()) files.set(path, await file.text());
  }
  return files;
}

async function editRelease(
  root: string,
  tag: string,
  markdown: string,
): Promise<number> {
  const child = Bun.spawn(["gh", "release", "edit", tag, "--notes-file", "-"], {
    cwd: root,
    stdin: new Blob([markdown]),
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

type ReleaseNotesInvocation =
  | { readonly command: "stamp" | "check"; readonly base: string }
  | { readonly command: "publish" | "verify-tags" };

function validBaseArguments(
  flag: string | undefined,
  base: string | undefined,
  extra: readonly string[],
): base is string {
  return (
    flag === "--base" &&
    Boolean(base) &&
    /^[a-f0-9]{40}$/.test(base!) &&
    extra.length === 0
  );
}

function parseInvocation(args: readonly string[]): ReleaseNotesInvocation {
  const [command, flag, base, ...extra] = args;
  if (
    (command === "stamp" || command === "check") &&
    validBaseArguments(flag, base, extra)
  ) {
    return { command, base };
  }
  if (
    (command === "publish" || command === "verify-tags") &&
    flag === undefined
  ) {
    return { command };
  }
  throw new Error(
    "Usage: notes.ts stamp|check --base <sha> | verify-tags | publish",
  );
}

async function processCandidateNotes(
  root: string,
  command: "stamp" | "check",
  base: string,
): Promise<void> {
  const previous: unknown = JSON.parse(
    await git(root, ["show", base + ":.release-please-manifest.json"]),
  );
  const changes = prepareReleaseNotes(await loadFiles(root), previous);
  if (command === "check") {
    if (changes.additions.size || changes.deletions.length)
      throw new Error("Release candidate has unstamped authored notes");
    return;
  }
  for (const [path, content] of changes.additions)
    await Bun.write(resolve(root, path), content);
  const { unlink } = await import("node:fs/promises");
  for (const path of changes.deletions) await unlink(resolve(root, path));
}

async function processTaggedNotes(
  root: string,
  command: "publish" | "verify-tags",
  options: { readonly editRelease?: typeof editRelease },
): Promise<void> {
  const sha = await git(root, ["rev-parse", "HEAD"]);
  const versions = releaseVersions(
    await Bun.file(resolve(root, ".release-please-manifest.json")).json(),
  );
  const config = (await Bun.file(
    resolve(root, "release-please-config.json"),
  ).json()) as ReleaseConfiguration;
  const mapping = object(
    await Bun.file(resolve(root, notesManifest)).json(),
    "release note map",
  );
  const tags = (await git(root, ["tag", "--points-at", sha]))
    .split("\n")
    .filter(Boolean);
  const published = new Set<string>();
  for (const [path, version] of Object.entries(versions)) {
    const release = reference(path, version, config);
    const tag = release.component + "-v" + version;
    if (!tags.includes(tag)) continue;
    if (JSON.stringify(mapping[path]) !== JSON.stringify(release))
      throw new Error("Missing release notes for " + tag);
    const markdown = renderReleaseNotes(
      await Bun.file(resolve(root, release.path)).text(),
      release,
    );
    if (command === "verify-tags") {
      published.add(tag);
      continue;
    }
    const status = await (options.editRelease ?? editRelease)(
      root,
      tag,
      markdown,
    );
    if (status !== 0)
      throw new Error("Unable to publish curated notes for " + tag);
    published.add(tag);
  }
  if (published.size === 0)
    throw new Error("Release commit has no mapped component tags");
}

export async function releaseNotesCommand(
  args: readonly string[],
  options: {
    readonly root?: string;
    readonly editRelease?: typeof editRelease;
  } = {},
): Promise<void> {
  const root = options.root ?? resolve(import.meta.dir, "../..");
  const invocation = parseInvocation(args);
  if ("base" in invocation) {
    await processCandidateNotes(root, invocation.command, invocation.base);
  } else {
    await processTaggedNotes(root, invocation.command, options);
  }
}

if (import.meta.main) await releaseNotesCommand(Bun.argv.slice(2));
