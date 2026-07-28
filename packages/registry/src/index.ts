import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { satisfies, valid, validRange } from "semver";

export type RegistryItemType =
  | "primitive"
  | "component"
  | "layout"
  | "form"
  | "navigation"
  | "feedback"
  | "data-display"
  | "workflow"
  | "block"
  | "hook"
  | "theme"
  | "plugin";

export interface RegistryFile {
  readonly path: string;
  readonly target: string;
  readonly source?: string;
  readonly content: string;
}

export interface RegistryItem {
  readonly name: string;
  readonly registryName?: string;
  readonly sourceId?: string;
  readonly type: RegistryItemType;
  readonly tier?: 1 | 2 | 3 | 4;
  readonly version?: string;
  readonly packageName?: string;
  readonly ownership?: "source" | "package" | "plugin";
  readonly integrity?: string;
  readonly compatibility?: {
    readonly tuil?: string;
    readonly renderers?: readonly string[];
    readonly capabilities?: readonly string[];
  };
  readonly deprecated?: {
    readonly message: string;
    readonly replacement?: string;
    readonly since?: string;
  };
  readonly codemods?: readonly RegistryCodemod[];
  readonly title: string;
  readonly description: string;
  readonly renderer?: string;
  readonly capabilities?: readonly string[];
  readonly semantics?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly registryDependencies?: readonly string[];
  readonly slots?: readonly string[];
  readonly provenance?: {
    readonly source: string;
    readonly license?: string;
    readonly mode?: "use" | "wrap" | "adapt" | "replace" | "reference";
  };
  readonly files: readonly RegistryFile[];
}

export interface RegistryCodemod {
  readonly id: string;
  readonly description: string;
  readonly replacements: readonly {
    readonly from: string;
    readonly to: string;
  }[];
}

export interface RegistryIndexEntry {
  readonly name: string;
  readonly type: RegistryItemType;
  readonly title: string;
  readonly description: string;
  readonly tier?: 1 | 2 | 3 | 4;
  readonly version?: string;
  readonly packageName?: string;
  readonly ownership?: RegistryItem["ownership"];
  readonly integrity?: string;
  readonly compatibility?: RegistryItem["compatibility"];
  readonly deprecated?: RegistryItem["deprecated"];
  readonly codemods?: RegistryItem["codemods"];
  readonly renderer?: string;
  readonly capabilities?: readonly string[];
  readonly semantics?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly registryDependencies?: readonly string[];
  readonly slots?: readonly string[];
  readonly provenance?: RegistryItem["provenance"];
  readonly files?: readonly Pick<RegistryFile, "path" | "target" | "source">[];
}

export interface RegistrySource {
  readonly id: string;
  get(name: string, signal?: AbortSignal): Promise<RegistryItem | undefined>;
  list(signal?: AbortSignal): Promise<readonly RegistryIndexEntry[]>;
}

const itemTypes = new Set<RegistryItemType>([
  "primitive",
  "component",
  "layout",
  "form",
  "navigation",
  "feedback",
  "data-display",
  "workflow",
  "block",
  "hook",
  "theme",
  "plugin",
]);

function validateRegistryPath(name: string): string {
  const segments = name.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[a-zA-Z0-9._-]+$/.test(segment),
    )
  ) {
    throw new Error(`Invalid registry item path "${name}"`);
  }
  return name;
}

function validateRelativeFilePath(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Registry file ${field} must be a nonempty string`);
  }
  if (
    isAbsolute(value) ||
    value.includes("\0") ||
    /[\r\n]/.test(value) ||
    value
      .split(/[\\/]/)
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError(`Invalid registry file ${field} "${value}"`);
  }
  return value;
}

function validateStringArray(
  value: unknown,
  field: string,
  validate: (entry: string) => string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError(`Registry item ${field} must be an array`);
  }
  return Object.freeze(
    value.map((entry) => {
      if (typeof entry !== "string" || !entry || entry !== entry.trim()) {
        throw new TypeError(
          `Registry item ${field} must contain nonempty strings`,
        );
      }
      return validate(entry);
    }),
  );
}

function validatePackageSpecifier(specifier: string): string {
  const packageSpecifier =
    /^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@([a-zA-Z0-9@._~^*+=:/#%?|-]+))?$/.exec(
      specifier,
    );
  if (
    specifier.startsWith("-") ||
    /[\s\0]/.test(specifier) ||
    specifier === "." ||
    specifier === ".." ||
    !packageSpecifier
  ) {
    throw new TypeError(`Invalid registry package dependency "${specifier}"`);
  }
  return specifier;
}

function validateRegistryDependency(dependency: string): string {
  const qualified = dependency.match(/^@([^/]+)\/(.+)$/);
  if (qualified) {
    validateRegistryPath(qualified[1] as string);
    validateRegistryPath(qualified[2] as string);
    return dependency;
  }
  return validateRegistryPath(dependency);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new TypeError(`Registry item ${field} must be a nonempty string`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);
  if (!parsed) {
    throw new TypeError(`Registry item ${field} must be a nonempty string`);
  }
  return parsed;
}

function parseCompatibility(value: unknown): RegistryItem["compatibility"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new TypeError("Registry item compatibility must be an object");
  }
  const candidate = value as Record<string, unknown>;
  return Object.freeze({
    tuil: optionalString(candidate["tuil"], "compatibility.tuil"),
    renderers: validateStringArray(
      candidate["renderers"],
      "compatibility.renderers",
      (entry) => entry,
    ),
    capabilities: validateStringArray(
      candidate["capabilities"],
      "compatibility.capabilities",
      (entry) => entry,
    ),
  });
}

function parseCodemods(value: unknown): readonly RegistryCodemod[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("Registry item codemods must be a bounded array");
  }
  return Object.freeze(
    value.map((entry) => {
      if (!entry || typeof entry !== "object") {
        throw new TypeError("Registry codemod must be an object");
      }
      const codemod = entry as Record<string, unknown>;
      if (
        !Array.isArray(codemod["replacements"]) ||
        codemod["replacements"].length > 100
      ) {
        throw new TypeError("Registry codemod replacements must be bounded");
      }
      return Object.freeze({
        id: requiredString(codemod["id"], "codemod.id"),
        description: requiredString(
          codemod["description"],
          "codemod.description",
        ),
        replacements: Object.freeze(
          codemod["replacements"].map((replacement) => {
            if (!replacement || typeof replacement !== "object") {
              throw new TypeError(
                "Registry codemod replacement must be an object",
              );
            }
            const pair = replacement as Record<string, unknown>;
            const from = optionalString(
              pair["from"],
              "codemod.replacement.from",
            );
            if (!from || from.length > 10_000) {
              throw new TypeError(
                "Registry codemod replacement source is invalid",
              );
            }
            const to = pair["to"];
            if (typeof to !== "string" || to.length > 10_000) {
              throw new TypeError(
                "Registry codemod replacement target is invalid",
              );
            }
            return Object.freeze({ from, to });
          }),
        ),
      });
    }),
  );
}

function parseDeprecated(value: unknown): RegistryItem["deprecated"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new TypeError("Registry item deprecated must be an object");
  }
  const candidate = value as Record<string, unknown>;
  return Object.freeze({
    message: requiredString(candidate["message"], "deprecated.message"),
    replacement: optionalString(
      candidate["replacement"],
      "deprecated.replacement",
    ),
    since: optionalString(candidate["since"], "deprecated.since"),
  });
}

function parseProvenance(value: unknown): RegistryItem["provenance"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new TypeError("Registry item provenance must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const mode = candidate["mode"];
  if (
    mode !== undefined &&
    !["use", "wrap", "adapt", "replace", "reference"].includes(mode as string)
  ) {
    throw new TypeError("Registry item provenance mode is unsupported");
  }
  return Object.freeze({
    source: requiredString(candidate["source"], "provenance.source"),
    license: optionalString(candidate["license"], "provenance.license"),
    mode: mode as
      | "use"
      | "wrap"
      | "adapt"
      | "replace"
      | "reference"
      | undefined,
  });
}

function parseOwnership(value: unknown): RegistryItem["ownership"] {
  if (value === undefined) return undefined;
  if (value !== "source" && value !== "package" && value !== "plugin") {
    throw new TypeError("Registry item ownership is unsupported");
  }
  return value;
}

export function parseRegistryItem(value: unknown): RegistryItem {
  if (!value || typeof value !== "object") {
    throw new TypeError("Registry item must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const rawType = String(candidate["type"] ?? "")
    .replace(/^registry:tuil-/, "")
    .replace(/^registry:/, "");
  const type = rawType === "ui" ? "component" : (rawType as RegistryItemType);
  if (!itemTypes.has(type)) {
    throw new TypeError(`Unsupported registry item type "${rawType}"`);
  }
  if (!Array.isArray(candidate["files"])) {
    throw new TypeError("Registry item files must be an array");
  }
  const files = candidate["files"].map((value) => {
    if (!value || typeof value !== "object") {
      throw new TypeError("Registry file must be an object");
    }
    const file = value as Record<string, unknown>;
    const path = validateRelativeFilePath(file["path"], "path");
    const target = validateRelativeFilePath(
      file["target"] === undefined ? path : file["target"],
      "target",
    );
    const source =
      file["source"] === undefined
        ? undefined
        : validateRelativeFilePath(file["source"], "source");
    if (typeof file["content"] !== "string") {
      throw new TypeError("Registry file content must be a string");
    }
    const content = file["content"];
    return { path, target, source, content };
  });
  if (typeof candidate["name"] !== "string" || !candidate["name"]) {
    throw new TypeError("Registry item name cannot be empty");
  }
  const name = validateRegistryPath(candidate["name"]);
  const dependencies = validateStringArray(
    candidate["dependencies"],
    "dependencies",
    validatePackageSpecifier,
  );
  const registryDependencies = validateStringArray(
    candidate["registryDependencies"],
    "registryDependencies",
    validateRegistryDependency,
  );
  const integrity = optionalString(candidate["integrity"], "integrity");
  if (integrity && !/^sha256-[a-f0-9]{64}$/.test(integrity)) {
    throw new TypeError("Registry item integrity must be a SHA-256 digest");
  }
  const tier = candidate["tier"];
  if (tier !== undefined && ![1, 2, 3, 4].includes(tier as number)) {
    throw new TypeError("Registry item tier must be between 1 and 4");
  }
  return Object.freeze({
    name,
    registryName: optionalString(candidate["registryName"], "registryName"),
    sourceId: optionalString(candidate["sourceId"], "sourceId"),
    type,
    tier: tier as RegistryItem["tier"],
    version: optionalString(candidate["version"], "version"),
    packageName: optionalString(candidate["packageName"], "packageName"),
    ownership: parseOwnership(candidate["ownership"]),
    integrity,
    compatibility: parseCompatibility(candidate["compatibility"]),
    deprecated: parseDeprecated(candidate["deprecated"]),
    codemods: parseCodemods(candidate["codemods"]),
    title: String(candidate["title"] ?? name),
    description: String(candidate["description"] ?? ""),
    renderer: optionalString(candidate["renderer"], "renderer"),
    capabilities: validateStringArray(
      candidate["capabilities"],
      "capabilities",
      (entry) => entry,
    ),
    semantics: validateStringArray(
      candidate["semantics"],
      "semantics",
      (entry) => entry,
    ),
    dependencies,
    registryDependencies,
    slots: validateStringArray(candidate["slots"], "slots", (entry) => entry),
    provenance: parseProvenance(candidate["provenance"]),
    files,
  }) as RegistryItem;
}

function missingPublishedMetadata(item: RegistryItem): readonly string[] {
  const required = [
    ["version", item.version],
    ["integrity", item.integrity],
    ["compatibility.tuil", item.compatibility?.tuil],
    ["compatibility.renderers", item.compatibility?.renderers?.length],
    ["provenance.source", item.provenance?.source],
    ["ownership", item.ownership],
  ] as const;
  return required.flatMap(([field, value]) => (value ? [] : [field]));
}

function requiresPublishedPackageName(item: RegistryItem): boolean {
  return (
    (item.ownership === "package" || item.ownership === "plugin") &&
    !item.packageName
  );
}

function publishedMetadataError(
  source: string,
  item: RegistryItem,
  message: string,
): TypeError {
  return new TypeError(
    `Published registry "${source}" item "${item.name}" ${message}`,
  );
}

function assertPublishedRegistryMetadata(
  item: RegistryItem,
  source: string,
  verifyIntegrity = true,
): void {
  const missing = missingPublishedMetadata(item);
  if (missing.length > 0) {
    throw publishedMetadataError(
      source,
      item,
      `is missing ${missing.join(", ")}`,
    );
  }
  if (!valid(item.version) || !validRange(item.compatibility?.tuil)) {
    throw publishedMetadataError(
      source,
      item,
      "has invalid version compatibility metadata",
    );
  }
  if (requiresPublishedPackageName(item)) {
    throw publishedMetadataError(
      source,
      item,
      `requires packageName for ${item.ownership} ownership`,
    );
  }
  if (verifyIntegrity && item.integrity !== registryIntegrity(item)) {
    throw publishedMetadataError(source, item, "failed integrity verification");
  }
}

function parseRegistryIndexEntry(
  value: unknown,
  source: string,
): RegistryIndexEntry {
  if (!value || typeof value !== "object") {
    throw new TypeError(`Registry "${source}" index entry must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const files = Array.isArray(candidate["files"])
    ? candidate["files"].map((file) => {
        if (!file || typeof file !== "object") {
          throw new TypeError(
            `Registry "${source}" index file must be an object`,
          );
        }
        const descriptor = file as Record<string, unknown>;
        return {
          path: descriptor["path"],
          target: descriptor["target"],
          source: descriptor["source"],
          content: "",
        };
      })
    : [];
  const item = parseRegistryItem({ ...candidate, files });
  assertPublishedRegistryMetadata(item, source, false);
  const {
    registryName: _registryName,
    sourceId: _sourceId,
    ...metadata
  } = item;
  return Object.freeze({
    ...metadata,
    files: Object.freeze(
      item.files.map(({ path, target, source }) =>
        Object.freeze({ path, target, source }),
      ),
    ),
  });
}

function parseRegistrySourceItem(
  value: unknown,
  source: string,
  name: string,
): RegistryItem {
  try {
    return parseRegistryItem(value);
  } catch (error) {
    throw new TypeError(
      `Registry "${source}" item "${name}" is invalid and must inline every file's content`,
      { cause: error },
    );
  }
}

function hasPublishedIndexMetadata(
  candidate: Partial<RegistryIndexEntry>,
): boolean {
  const metadata = [
    candidate.version,
    candidate.integrity,
    candidate.compatibility,
    candidate.provenance,
    candidate.ownership,
  ];
  return metadata.every(Boolean);
}

function parseLegacyRegistryIndexEntry(
  candidate: Partial<RegistryIndexEntry>,
): RegistryIndexEntry {
  const type = String(candidate.type ?? "component")
    .replace(/^registry:tuil-/, "")
    .replace(/^registry:/, "");
  const normalizedType =
    type === "ui" ? "component" : (type as RegistryItemType);
  if (!itemTypes.has(normalizedType)) {
    throw new TypeError(`Unsupported registry item type "${type}"`);
  }
  return Object.freeze({
    name: validateRegistryPath(String(candidate.name)),
    type: normalizedType,
    title: String(candidate.title ?? candidate.name),
    description: String(candidate.description ?? ""),
  });
}

function parseFileRegistryIndexEntry(
  entry: RegistryIndexEntry,
  source: string,
): RegistryIndexEntry {
  const candidate = entry as Partial<RegistryIndexEntry>;
  return hasPublishedIndexMetadata(candidate)
    ? parseRegistryIndexEntry(entry, source)
    : parseLegacyRegistryIndexEntry(candidate);
}

const loopbackRegistryHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const maximumRegistryResponseBytes = 2 * 1_024 * 1_024;

function validateRegistryBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback = loopbackRegistryHosts.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError(
      "Registry URLs must use HTTPS, except for loopback development servers",
    );
  }
  if (url.username || url.password) {
    throw new TypeError("Registry URLs cannot contain credentials");
  }
  if (url.search || url.hash) {
    throw new TypeError(
      "Registry base URLs cannot contain a query or fragment",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function assertRegistryResponseSize(size: number, sourceId: string): void {
  if (size > maximumRegistryResponseBytes) {
    throw new RangeError(
      `Registry "${sourceId}" response exceeds ${maximumRegistryResponseBytes} bytes`,
    );
  }
}

async function readRegistryResponseBytes(
  response: Response,
  sourceId: string,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength)) {
    assertRegistryResponseSize(declaredLength, sourceId);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    try {
      assertRegistryResponseSize(total, sourceId);
    } catch (error) {
      await reader.cancel(error);
      throw error;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readRegistryResponseJson(
  response: Response,
  sourceId: string,
): Promise<unknown> {
  const bytes = await readRegistryResponseBytes(response, sourceId);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new TypeError(`Registry "${sourceId}" returned invalid JSON`, {
      cause: error,
    });
  }
}

export class HttpRegistrySource implements RegistrySource {
  readonly id: string;
  readonly baseUrl: string;

  constructor(id: string, baseUrl: string) {
    if (!id.trim()) {
      throw new TypeError("Registry source id cannot be empty");
    }
    this.id = id;
    this.baseUrl = validateRegistryBaseUrl(baseUrl);
  }

  async get(
    name: string,
    signal?: AbortSignal,
  ): Promise<RegistryItem | undefined> {
    const itemPath = validateRegistryPath(name)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const response = await fetch(`${this.baseUrl}/${itemPath}.json`, {
      redirect: "error",
      signal,
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(
        `Registry "${this.id}" returned ${response.status} for "${name}"`,
      );
    }
    const item = parseRegistrySourceItem(
      await readRegistryResponseJson(response, this.id),
      this.id,
      name,
    );
    assertPublishedRegistryMetadata(item, this.id);
    return item;
  }

  async list(signal?: AbortSignal): Promise<readonly RegistryIndexEntry[]> {
    const response = await fetch(`${this.baseUrl}/registry.json`, {
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      throw new Error(`Registry "${this.id}" returned ${response.status}`);
    }
    const value = await readRegistryResponseJson(response, this.id);
    const items =
      value && typeof value === "object" && "items" in value
        ? (value as { items: unknown }).items
        : value;
    if (!Array.isArray(items)) {
      throw new TypeError(`Registry "${this.id}" index must be an array`);
    }
    return items.map((entry) => parseRegistryIndexEntry(entry, this.id));
  }
}

export class FileRegistrySource implements RegistrySource {
  constructor(
    readonly id: string,
    readonly directory: string,
  ) {}

  async get(name: string): Promise<RegistryItem | undefined> {
    try {
      const itemPath = validateRegistryPath(name);
      const value = JSON.parse(
        await readFile(join(this.directory, `${itemPath}.json`), "utf8"),
      ) as unknown;
      return parseRegistrySourceItem(value, this.id, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async list(): Promise<readonly RegistryIndexEntry[]> {
    const value = JSON.parse(
      await readFile(join(this.directory, "registry.json"), "utf8"),
    ) as { items?: RegistryIndexEntry[] } | RegistryIndexEntry[];
    const items = Array.isArray(value) ? value : (value.items ?? []);
    return items.map((entry) => parseFileRegistryIndexEntry(entry, this.id));
  }
}

export class RegistryClient {
  constructor(readonly sources: readonly RegistrySource[]) {
    if (sources.length === 0) {
      throw new Error("Registry client requires at least one source");
    }
  }

  async get(name: string, signal?: AbortSignal): Promise<RegistryItem> {
    const qualified = name.match(/^@([^/]+)\/(.+)$/);
    const selectedSources = qualified
      ? this.sources.filter((source) => source.id === qualified[1])
      : this.sources;
    const itemName = qualified?.[2] ?? name;
    for (const source of selectedSources) {
      const item = await source.get(itemName, signal);
      if (item) {
        return Object.freeze({
          ...item,
          registryName: qualified ? name : item.name,
          sourceId: source.id,
        });
      }
    }
    throw new Error(`Registry item "${name}" was not found`);
  }

  async list(signal?: AbortSignal): Promise<readonly RegistryIndexEntry[]> {
    const results = await Promise.allSettled(
      this.sources.map((source) => source.list(signal)),
    );
    const entries = results
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<readonly RegistryIndexEntry[]> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
    if (entries.length === 0) {
      throw new AggregateError(
        results
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          )
          .map((result) => result.reason),
        "Every registry source failed",
      );
    }
    const unique = new Map<string, RegistryIndexEntry>();
    for (const entry of entries.flat()) {
      if (!unique.has(entry.name)) {
        unique.set(entry.name, entry);
      }
    }
    return [...unique.values()];
  }

  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly RegistryIndexEntry[]> {
    const normalized = query.trim().toLowerCase();
    return (await this.list(signal)).filter((entry) =>
      `${entry.name} ${entry.title} ${entry.description}`
        .toLowerCase()
        .includes(normalized),
    );
  }

  async resolvePlan(
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly RegistryItem[]> {
    const visiting = new Set<string>();
    const resolved = new Map<string, RegistryItem>();
    const visit = async (
      name: string,
      path: readonly string[],
    ): Promise<void> => {
      if (resolved.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(
          `Registry dependency cycle: ${[...path, name].join(" → ")}`,
        );
      }
      visiting.add(name);
      const item = await this.get(name, signal);
      const source = name.match(/^@([^/]+)\//)?.[1];
      for (const dependency of item.registryDependencies ?? []) {
        const qualified =
          source && !dependency.startsWith("@")
            ? `@${source}/${dependency}`
            : dependency;
        await visit(qualified, [...path, name]);
      }
      visiting.delete(name);
      resolved.set(name, item);
    };
    for (const name of names) {
      await visit(name, []);
    }
    return [...resolved.values()];
  }
}

interface InstallState {
  readonly version: 1;
  readonly items: Record<
    string,
    {
      readonly files: Record<string, string>;
      readonly dependencies?: readonly string[];
      readonly installedAt: string;
    }
  >;
}

export interface RegistryTransformOptions {
  readonly importAliases?: Readonly<Record<string, string>>;
  readonly componentDirectory?: string;
  readonly themeTokens?: Readonly<Record<string, string>>;
  readonly format?: (
    content: string,
    target: string,
  ) => string | Promise<string>;
}

export interface RegistryInstallOptions extends RegistryTransformOptions {
  readonly force?: boolean;
  readonly frozenLockfile?: boolean;
  readonly environment?: {
    readonly renderer: string;
    readonly capabilities: ReadonlySet<string>;
    readonly tuilVersion: string;
  };
}

export interface InstallResult {
  readonly item: string;
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly unchanged: readonly string[];
  readonly removed: readonly string[];
}

export interface RemoveResult {
  readonly item: string;
  readonly removed: readonly string[];
}

export interface RegistryDiff {
  readonly path: string;
  readonly status: "missing" | "unchanged" | "modified";
  readonly diff: string;
}

function hash(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

function canonicalCompatibility(item: RegistryItem) {
  if (!item.compatibility) return null;
  return {
    tuil: item.compatibility.tuil ?? null,
    renderers: (item.compatibility.renderers ?? []).toSorted(),
    capabilities: (item.compatibility.capabilities ?? []).toSorted(),
  };
}

function canonicalFiles(item: RegistryItem) {
  return item.files
    .map(({ path, target, source, content }) => ({
      path,
      target,
      source: source ?? null,
      content,
    }))
    .toSorted(
      (left, right) =>
        left.target.localeCompare(right.target) ||
        left.path.localeCompare(right.path),
    );
}

function canonicalRegistryItem(item: RegistryItem): string {
  const sorted = (values: readonly string[] | undefined) =>
    values ? values.toSorted() : [];
  return JSON.stringify({
    name: item.name,
    type: item.type,
    tier: item.tier ?? null,
    version: item.version ?? null,
    packageName: item.packageName ?? null,
    ownership: item.ownership ?? null,
    compatibility: canonicalCompatibility(item),
    deprecated: item.deprecated ?? null,
    codemods: item.codemods ?? [],
    title: item.title,
    description: item.description,
    renderer: item.renderer ?? null,
    capabilities: sorted(item.capabilities),
    semantics: sorted(item.semantics),
    dependencies: sorted(item.dependencies),
    registryDependencies: sorted(item.registryDependencies),
    slots: sorted(item.slots),
    provenance: item.provenance ?? null,
    files: canonicalFiles(item),
  });
}

export function registryIntegrity(item: RegistryItem): string {
  return `sha256-${hash(canonicalRegistryItem(item))}`;
}

export function provenanceComment(item: RegistryItem, prefix = "//"): string {
  const source = item.provenance?.source ?? item.sourceId ?? "tuil";
  const safe = (value: string) => encodeURIComponent(value);
  return `${prefix} @tuil-registry ${safe(registryIdentity(item))}${item.version ? `@${safe(item.version)}` : ""} source=${safe(source)} integrity=${registryIntegrity(item)}`;
}

export function applyRegistryCodemods(
  content: string,
  codemods: readonly RegistryCodemod[],
): {
  readonly content: string;
  readonly applied: readonly string[];
} {
  let transformed = content;
  const applied: string[] = [];
  for (const codemod of codemods) {
    const before = transformed;
    for (const replacement of codemod.replacements) {
      transformed = transformed.replaceAll(replacement.from, replacement.to);
    }
    if (before !== transformed) applied.push(codemod.id);
  }
  return Object.freeze({
    content: transformed,
    applied: Object.freeze(applied),
  });
}

export interface RegistryLockfile {
  readonly version: 1;
  readonly items: Readonly<
    Record<
      string,
      {
        readonly version?: string;
        readonly source?: string;
        readonly packageName?: string;
        readonly integrity: string;
        readonly packageDependencies: readonly string[];
        readonly dependencies: readonly string[];
      }
    >
  >;
}

export function createRegistryLockfile(
  items: readonly RegistryItem[],
): RegistryLockfile {
  return Object.freeze({
    version: 1,
    items: Object.freeze(
      Object.fromEntries(
        items.map((item) => [
          registryIdentity(item),
          Object.freeze({
            version: item.version,
            source: item.sourceId,
            packageName: item.packageName,
            integrity: registryIntegrity(item),
            packageDependencies: Object.freeze(
              (item.dependencies ?? []).toSorted(),
            ),
            dependencies: Object.freeze(
              registryDependencyIdentities(item).toSorted(),
            ),
          }),
        ]),
      ),
    ),
  });
}

export function verifyRegistryLockfile(
  lockfile: RegistryLockfile,
  items: readonly RegistryItem[],
): readonly string[] {
  const failures: string[] = [];
  for (const item of items) {
    const identity = registryIdentity(item);
    const locked = lockfile.items[identity];
    if (!locked) failures.push(`${identity}: missing`);
    else if (locked.integrity !== registryIntegrity(item)) {
      failures.push(`${identity}: integrity mismatch`);
    } else if (locked.version !== item.version) {
      failures.push(`${identity}: version mismatch`);
    } else if (locked.source !== item.sourceId) {
      failures.push(`${identity}: source mismatch`);
    } else if (locked.packageName !== item.packageName) {
      failures.push(`${identity}: package mismatch`);
    } else if (
      JSON.stringify(locked.packageDependencies) !==
      JSON.stringify((item.dependencies ?? []).toSorted())
    ) {
      failures.push(`${identity}: package dependencies mismatch`);
    } else if (
      JSON.stringify(locked.dependencies) !==
      JSON.stringify(registryDependencyIdentities(item).toSorted())
    ) {
      failures.push(`${identity}: registry dependencies mismatch`);
    }
  }
  return Object.freeze(failures);
}

export function registryCompatibilityIssues(
  item: RegistryItem,
  environment: {
    readonly renderer: string;
    readonly capabilities: ReadonlySet<string>;
    readonly tuilVersion?: string;
  },
): readonly string[] {
  const issues: string[] = [];
  if (
    item.compatibility?.renderers &&
    !item.compatibility.renderers.includes(environment.renderer)
  ) {
    issues.push(`renderer "${environment.renderer}" is unsupported`);
  }
  for (const capability of item.compatibility?.capabilities ?? []) {
    if (!environment.capabilities.has(capability)) {
      issues.push(`missing capability "${capability}"`);
    }
  }
  if (
    item.compatibility?.tuil &&
    (!environment.tuilVersion ||
      !satisfies(environment.tuilVersion, item.compatibility.tuil))
  ) {
    issues.push(
      environment.tuilVersion
        ? `TUIL ${environment.tuilVersion} does not satisfy "${item.compatibility.tuil}"`
        : `TUIL version is required to verify "${item.compatibility.tuil}"`,
    );
  }
  if (item.deprecated) {
    const replacement =
      item.deprecated.replacement &&
      !item.deprecated.message.includes(item.deprecated.replacement)
        ? `; use ${item.deprecated.replacement}`
        : "";
    issues.push(`deprecated: ${item.deprecated.message}${replacement}`);
  }
  return Object.freeze(issues);
}

function registryIdentity(item: RegistryItem): string {
  return item.registryName ?? item.name;
}

function registryDependencyIdentities(item: RegistryItem): readonly string[] {
  const source = item.registryName?.match(/^@([^/]+)\//)?.[1];
  return (item.registryDependencies ?? []).map((dependency) =>
    source && !dependency.startsWith("@")
      ? `@${source}/${dependency}`
      : dependency,
  );
}

async function transformSource(
  content: string,
  target: string,
  options: RegistryTransformOptions,
): Promise<string> {
  let transformed = content;
  for (const [from, to] of Object.entries(options.importAliases ?? {})) {
    transformed = transformed.replaceAll(from, to);
  }
  if (options.componentDirectory) {
    transformed = transformed.replaceAll(
      "@/components/tuil",
      options.componentDirectory,
    );
  }
  for (const [from, to] of Object.entries(options.themeTokens ?? {})) {
    transformed = transformed.replaceAll(`"${from}"`, `"${to}"`);
  }
  return options.format
    ? await options.format(transformed, target)
    : transformed;
}

async function prepareRegistryFile(
  item: RegistryItem,
  file: RegistryFile,
  options: RegistryTransformOptions,
): Promise<string> {
  let content = await transformSource(file.content, file.target, options);
  if (item.codemods) {
    content = applyRegistryCodemods(content, item.codemods).content;
  }
  if (
    (item.version || item.provenance || item.sourceId) &&
    !content.startsWith("// @tuil-registry")
  ) {
    content = `${provenanceComment(item)}\n${content}`;
  }
  return content;
}

function simpleDiff(local: string, incoming: string): string {
  const localLines = local.split("\n");
  const incomingLines = incoming.split("\n");
  const lines: string[] = [];
  const length = Math.max(localLines.length, incomingLines.length);
  for (let index = 0; index < length; index += 1) {
    const left = localLines[index];
    const right = incomingLines[index];
    if (left === right) {
      if (left !== undefined) lines.push(` ${left}`);
    } else {
      if (left !== undefined) lines.push(`-${left}`);
      if (right !== undefined) lines.push(`+${right}`);
    }
  }
  return lines.join("\n");
}

export class RegistryInstaller {
  readonly #statePath: string;
  readonly #lockPath: string;

  constructor(readonly root: string) {
    this.root = resolve(root);
    this.#statePath = join(this.root, ".tuil", "registry.json");
    this.#lockPath = join(this.root, ".tuil", "registry-lock.json");
  }

  async install(
    item: RegistryItem,
    options: RegistryInstallOptions = {},
  ): Promise<InstallResult> {
    return (await this.installMany([item], options))[0] as InstallResult;
  }

  async verify(
    items: readonly RegistryItem[],
    options: RegistryInstallOptions = {},
  ): Promise<void> {
    if (options.frozenLockfile) {
      const failures = verifyRegistryLockfile(
        await this.#readLockfile(),
        items,
      );
      if (failures.length > 0) {
        throw new Error(
          `Registry lockfile verification failed:\n${failures.join("\n")}`,
        );
      }
    }
    for (const item of items) {
      if (item.integrity && item.integrity !== registryIntegrity(item)) {
        throw new Error(
          `Registry item "${registryIdentity(item)}" failed integrity verification`,
        );
      }
      const compatibility = registryCompatibilityIssues(
        item,
        options.environment ?? {
          renderer: "unknown",
          capabilities: new Set(),
        },
      ).filter((issue) => !issue.startsWith("deprecated:"));
      if (compatibility.length > 0) {
        throw new Error(
          `Registry item "${registryIdentity(item)}" is incompatible: ${compatibility.join("; ")}`,
        );
      }
    }
  }

  async installMany(
    items: readonly RegistryItem[],
    options: RegistryInstallOptions = {},
  ): Promise<readonly InstallResult[]> {
    if (items.length === 0) {
      return [];
    }
    const [state, lockfile] = await Promise.all([
      this.#readState(),
      this.#readLockfile(),
    ]);
    await this.verify(items, options);
    interface MutableInstallResult {
      readonly created: string[];
      readonly updated: string[];
      readonly unchanged: string[];
      readonly removed: string[];
      readonly hashes: Record<string, string>;
    }
    interface IncomingPlan {
      readonly target: string;
      readonly relativeTarget: string;
      readonly content: string;
      readonly incomingHash: string;
      readonly owners: Set<string>;
      local?: string;
    }
    const results = new Map<string, MutableInstallResult>();
    const plans = new Map<string, IncomingPlan>();
    for (const item of items) {
      const identity = registryIdentity(item);
      if (results.has(identity)) {
        throw new Error(`Duplicate registry item "${identity}" in transaction`);
      }
      const result: MutableInstallResult = {
        created: [] as string[],
        updated: [] as string[],
        unchanged: [] as string[],
        removed: [] as string[],
        hashes: {} as Record<string, string>,
      };
      results.set(identity, result);
      for (const file of item.files) {
        if (file.target in result.hashes) {
          throw new Error(
            `Registry item "${identity}" declares "${file.target}" more than once`,
          );
        }
        const target = await this.#secureTarget(file.target);
        const content = await prepareRegistryFile(item, file, options);
        const incomingHash = hash(content);
        result.hashes[file.target] = incomingHash;
        const existingPlan = plans.get(target);
        if (existingPlan && existingPlan.content !== content) {
          throw new Error(
            `Registry items provide conflicting content for "${file.target}"`,
          );
        }
        if (existingPlan) {
          existingPlan.owners.add(identity);
        } else {
          plans.set(target, {
            target,
            relativeTarget: file.target,
            content,
            incomingHash,
            owners: new Set([identity]),
          });
        }
      }
    }
    const transactionItems = new Set(results.keys());
    for (const plan of plans.values()) {
      try {
        plan.local = await readFile(plan.target, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const existingOwners = Object.entries(state.items).flatMap(
        ([owner, record]) => {
          const ownerHash = record.files[plan.relativeTarget];
          return ownerHash ? [{ owner, ownerHash }] : [];
        },
      );
      for (const { owner, ownerHash } of existingOwners) {
        const ownerResult = results.get(owner);
        const nextOwnerHash = ownerResult?.hashes[plan.relativeTarget];
        if (!transactionItems.has(owner) && ownerHash !== plan.incomingHash) {
          throw new Error(
            `Cannot update shared registry file "${plan.relativeTarget}" without also updating owner "${owner}"`,
          );
        }
        if (
          nextOwnerHash !== undefined &&
          nextOwnerHash !== plan.incomingHash
        ) {
          throw new Error(
            `Registry owners provide conflicting updates for "${plan.relativeTarget}"`,
          );
        }
      }
      const localHash = plan.local === undefined ? undefined : hash(plan.local);
      if (
        localHash !== undefined &&
        localHash !== plan.incomingHash &&
        !options.force
      ) {
        if (existingOwners.length === 0) {
          throw new Error(
            `Refusing to overwrite untracked file "${plan.relativeTarget}". Use force explicitly.`,
          );
        }
        if (existingOwners.some(({ ownerHash }) => ownerHash !== localHash)) {
          throw new Error(
            `Refusing to overwrite locally modified registry file "${plan.relativeTarget}". Run diff first or use force explicitly.`,
          );
        }
      }
      for (const owner of plan.owners) {
        const result = results.get(owner);
        if (!result) continue;
        if (plan.local === undefined) {
          result.created.push(plan.relativeTarget);
        } else if (localHash === plan.incomingHash) {
          result.unchanged.push(plan.relativeTarget);
        } else {
          result.updated.push(plan.relativeTarget);
        }
      }
    }
    const removalPlans = new Map<
      string,
      {
        readonly file: string;
        readonly target: string;
        readonly local: string;
      }
    >();
    for (const [identity, result] of results) {
      const previous = state.items[identity];
      for (const [file, installedHash] of Object.entries(
        previous?.files ?? {},
      )) {
        if (file in result.hashes) continue;
        result.removed.push(file);
        if ([...plans.values()].some((plan) => plan.relativeTarget === file)) {
          continue;
        }
        const survivingOwners = Object.entries(state.items).flatMap(
          ([owner, record]) => {
            if (owner === identity) return [];
            const ownerResult = results.get(owner);
            const nextHash = ownerResult
              ? ownerResult.hashes[file]
              : record.files[file];
            return nextHash ? [{ owner, ownerHash: nextHash }] : [];
          },
        );
        if (survivingOwners.length > 0) {
          if (
            survivingOwners.some(({ ownerHash }) => ownerHash !== installedHash)
          ) {
            throw new Error(
              `Registry state has conflicting owners for "${file}"`,
            );
          }
          continue;
        }
        const target = await this.#secureTarget(file);
        try {
          const local = await readFile(target, "utf8");
          if (!options.force && hash(local) !== installedHash) {
            throw new Error(
              `Refusing to remove locally modified registry file "${file}"`,
            );
          }
          removalPlans.set(target, { file, target, local });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    const nextState: InstallState = {
      version: 1,
      items: { ...state.items },
    };
    const incomingLock = createRegistryLockfile(items);
    const nextLock: RegistryLockfile = {
      version: 1,
      items: { ...lockfile.items, ...incomingLock.items },
    };
    for (const item of items) {
      const identity = registryIdentity(item);
      const result = results.get(identity);
      if (result) {
        nextState.items[identity] = {
          files: result.hashes,
          dependencies: registryDependencyIdentities(item),
          installedAt: new Date().toISOString(),
        };
      }
    }

    const transaction = crypto.randomUUID();
    const staged: {
      readonly target: string;
      readonly stage: string;
      readonly backup: string;
      readonly existed: boolean;
    }[] = [];
    const removed: {
      readonly target: string;
      readonly backup: string;
    }[] = [];
    try {
      for (const plan of plans.values()) {
        if (plan.local === plan.content) continue;
        await mkdir(dirname(plan.target), { recursive: true });
        await this.#secureTarget(plan.relativeTarget);
        const stage = `${plan.target}.tuil-stage-${transaction}`;
        const backup = `${plan.target}.tuil-backup-${transaction}`;
        await writeFile(stage, plan.content, { encoding: "utf8", flag: "wx" });
        staged.push({
          target: plan.target,
          stage,
          backup,
          existed: plan.local !== undefined,
        });
      }
      for (const file of staged) {
        await this.#secureAbsoluteTarget(file.target);
        if (file.existed) {
          await rename(file.target, file.backup);
        }
        await rename(file.stage, file.target);
      }
      for (const plan of removalPlans.values()) {
        await this.#secureAbsoluteTarget(plan.target);
        const backup = `${plan.target}.tuil-remove-${transaction}`;
        await rename(plan.target, backup);
        removed.push({ target: plan.target, backup });
      }
      await this.#writeMetadata(nextState, nextLock);
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const file of [...removed].reverse()) {
        try {
          if (await this.#exists(file.backup)) {
            await rename(file.backup, file.target);
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      for (const file of [...staged].reverse()) {
        try {
          await rm(file.stage, { force: true });
          if (await this.#exists(file.backup)) {
            await rm(file.target, { force: true });
            await rename(file.backup, file.target);
          } else if (!file.existed) {
            await rm(file.target, { force: true });
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Registry transaction and rollback failed",
        );
      }
      throw error;
    }
    await Promise.allSettled(
      [
        ...staged.flatMap((file) => (file.existed ? [file.backup] : [])),
        ...removed.map((file) => file.backup),
      ].map((backup) => rm(backup, { force: true })),
    );
    return items.map((item) => {
      const identity = registryIdentity(item);
      const result = results.get(identity);
      if (!result) {
        throw new Error(`Missing install result for "${identity}"`);
      }
      return {
        item: identity,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
        removed: result.removed,
      };
    });
  }

  async diff(
    item: RegistryItem,
    options: RegistryTransformOptions = {},
  ): Promise<readonly RegistryDiff[]> {
    return Promise.all(
      item.files.map(async (file) => {
        const incoming = await prepareRegistryFile(item, file, options);
        try {
          const local = await readFile(
            await this.#secureTarget(file.target),
            "utf8",
          );
          return {
            path: file.target,
            status: local === incoming ? "unchanged" : "modified",
            diff: local === incoming ? "" : simpleDiff(local, incoming),
          } as RegistryDiff;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return {
              path: file.target,
              status: "missing",
              diff: simpleDiff("", incoming),
            } as RegistryDiff;
          }
          throw error;
        }
      }),
    );
  }

  async remove(name: string, force = false): Promise<readonly string[]> {
    return (await this.removeMany([name], force))[0]?.removed ?? [];
  }

  async removeMany(
    names: readonly string[],
    force = false,
  ): Promise<readonly RemoveResult[]> {
    if (names.length === 0) return [];
    const uniqueNames = [...new Set(names)];
    if (uniqueNames.length !== names.length) {
      throw new Error("Duplicate registry item in removal transaction");
    }
    const [state, lockfile] = await Promise.all([
      this.#readState(),
      this.#readLockfile(),
    ]);
    for (const name of names) {
      if (!state.items[name]) {
        throw new Error(`Registry item "${name}" is not installed`);
      }
    }
    const removalSet = new Set(names);
    for (const [survivor, installed] of Object.entries(state.items)) {
      if (removalSet.has(survivor)) continue;
      const removedDependency = (installed.dependencies ?? []).find(
        (dependency) => removalSet.has(dependency),
      );
      if (removedDependency) {
        throw new Error(
          `Cannot remove registry item "${removedDependency}" while dependent "${survivor}" remains installed`,
        );
      }
    }
    const results = new Map<string, string[]>(names.map((name) => [name, []]));
    const planned: {
      readonly file: string;
      readonly target: string;
      readonly backup: string;
    }[] = [];
    const plannedTargets = new Set<string>();
    const transaction = crypto.randomUUID();
    for (const name of names) {
      const item = state.items[name];
      if (!item) continue;
      for (const [file, installedHash] of Object.entries(item.files)) {
        const survivingHashes = Object.entries(state.items).flatMap(
          ([owner, installed]) => {
            if (removalSet.has(owner)) return [];
            const ownerHash = installed.files[file];
            return ownerHash ? [ownerHash] : [];
          },
        );
        if (survivingHashes.length > 0) {
          if (
            survivingHashes.some((ownerHash) => ownerHash !== installedHash)
          ) {
            throw new Error(
              `Registry state has conflicting owners for "${file}"`,
            );
          }
          continue;
        }
        const target = await this.#secureTarget(file);
        try {
          const local = await readFile(target, "utf8");
          if (!force && hash(local) !== installedHash) {
            throw new Error(
              `Refusing to remove locally modified registry file "${file}"`,
            );
          }
          results.get(name)?.push(file);
          if (!plannedTargets.has(target)) {
            plannedTargets.add(target);
            planned.push({
              file,
              target,
              backup: `${target}.tuil-remove-${transaction}`,
            });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    const nextItems = { ...state.items };
    const nextLockItems = { ...lockfile.items };
    for (const name of names) delete nextItems[name];
    for (const name of names) delete nextLockItems[name];
    const moved: typeof planned = [];
    try {
      for (const file of planned) {
        await this.#secureAbsoluteTarget(file.target);
        await rename(file.target, file.backup);
        moved.push(file);
      }
      await this.#writeMetadata(
        { version: 1, items: nextItems },
        { version: 1, items: nextLockItems },
      );
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const file of [...moved].reverse()) {
        try {
          if (await this.#exists(file.backup)) {
            await rename(file.backup, file.target);
          }
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Registry removal and rollback failed",
        );
      }
      throw error;
    }
    await Promise.allSettled(
      moved.map((file) => rm(file.backup, { force: true })),
    );
    return names.map((name) => ({
      item: name,
      removed: results.get(name) ?? [],
    }));
  }

  async installed(): Promise<readonly string[]> {
    return Object.keys((await this.#readState()).items).sort();
  }

  #resolveTarget(target: string): string {
    if (isAbsolute(target)) {
      throw new Error(`Registry target must be relative: "${target}"`);
    }
    const resolved = resolve(this.root, target);
    const relativeTarget = relative(resolve(this.root), resolved);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${sep}`) ||
      isAbsolute(relativeTarget)
    ) {
      throw new Error(`Registry target escapes project root: "${target}"`);
    }
    return resolved;
  }

  async #secureTarget(target: string): Promise<string> {
    return this.#secureAbsoluteTarget(this.#resolveTarget(target));
  }

  async #secureAbsoluteTarget(target: string): Promise<string> {
    const rootInfo = await lstat(this.root);
    if (rootInfo.isSymbolicLink()) {
      throw new Error(
        `Registry project root cannot be a symbolic link: "${this.root}"`,
      );
    }
    const rootReal = await realpath(this.root);
    const relativeTarget = relative(this.root, target);
    let current = this.root;
    for (const segment of relativeTarget.split(sep).filter(Boolean)) {
      current = join(current, segment);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) {
          throw new Error(
            `Registry target contains symbolic link "${relative(this.root, current)}"`,
          );
        }
        const currentReal = await realpath(current);
        const fromRoot = relative(rootReal, currentReal);
        if (
          fromRoot === ".." ||
          fromRoot.startsWith(`..${sep}`) ||
          isAbsolute(fromRoot)
        ) {
          throw new Error(
            `Registry target resolves outside project root: "${relativeTarget}"`,
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          break;
        }
        throw error;
      }
    }
    return target;
  }

  async #exists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async #readState(): Promise<InstallState> {
    try {
      await this.#secureAbsoluteTarget(this.#statePath);
      const value = JSON.parse(
        await readFile(this.#statePath, "utf8"),
      ) as InstallState;
      if (value.version !== 1 || !value.items) {
        throw new Error("Unsupported registry state version");
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, items: {} };
      }
      throw error;
    }
  }

  async #readLockfile(): Promise<RegistryLockfile> {
    try {
      await this.#secureAbsoluteTarget(this.#lockPath);
      const value = JSON.parse(
        await readFile(this.#lockPath, "utf8"),
      ) as RegistryLockfile;
      if (value.version !== 1 || !value.items) {
        throw new Error("Unsupported registry lockfile version");
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, items: {} };
      }
      throw error;
    }
  }

  async #writeMetadata(
    state: InstallState,
    lockfile: RegistryLockfile,
  ): Promise<void> {
    await mkdir(dirname(this.#statePath), { recursive: true });
    const transaction = crypto.randomUUID();
    const entries = [
      { path: this.#statePath, value: state },
      { path: this.#lockPath, value: lockfile },
    ];
    const staged = entries.map((entry) => ({
      ...entry,
      temporary: `${entry.path}.${transaction}.tmp`,
      backup: `${entry.path}.${transaction}.backup`,
      existed: false,
      installed: false,
    }));
    try {
      for (const entry of staged) {
        await this.#secureAbsoluteTarget(entry.path);
        await writeFile(
          entry.temporary,
          `${JSON.stringify(entry.value, null, 2)}\n`,
          {
            encoding: "utf8",
            flag: "wx",
          },
        );
      }
      for (const entry of staged) {
        entry.existed = await this.#exists(entry.path);
        if (entry.existed) await rename(entry.path, entry.backup);
        await rename(entry.temporary, entry.path);
        entry.installed = true;
      }
    } catch (error) {
      for (const entry of [...staged].reverse()) {
        await rm(entry.temporary, { force: true });
        if (entry.installed) await rm(entry.path, { force: true });
        if (entry.existed && (await this.#exists(entry.backup))) {
          await rename(entry.backup, entry.path);
        }
      }
      throw error;
    }
    await Promise.allSettled(
      staged.map((entry) => rm(entry.backup, { force: true })),
    );
  }
}
