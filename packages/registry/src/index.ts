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

export type RegistryItemType =
  | "primitive"
  | "component"
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
  readonly content: string;
}

export interface RegistryItem {
  readonly name: string;
  readonly registryName?: string;
  readonly sourceId?: string;
  readonly type: RegistryItemType;
  readonly tier?: 1 | 2 | 3 | 4;
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

export interface RegistryIndexEntry {
  readonly name: string;
  readonly type: RegistryItemType;
  readonly title: string;
  readonly description: string;
}

export interface RegistrySource {
  readonly id: string;
  get(name: string, signal?: AbortSignal): Promise<RegistryItem | undefined>;
  list(signal?: AbortSignal): Promise<readonly RegistryIndexEntry[]>;
}

const itemTypes = new Set<RegistryItemType>([
  "primitive",
  "component",
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
    const path = String(file["path"] ?? "");
    const target = String(file["target"] ?? path);
    const content = String(file["content"] ?? "");
    if (!path || !target) {
      throw new TypeError("Registry files require path and target");
    }
    return { path, target, content };
  });
  const name = String(candidate["name"] ?? "");
  if (!name) {
    throw new TypeError("Registry item name cannot be empty");
  }
  return Object.freeze({
    ...candidate,
    name,
    type,
    title: String(candidate["title"] ?? name),
    description: String(candidate["description"] ?? ""),
    files,
  }) as RegistryItem;
}

export class HttpRegistrySource implements RegistrySource {
  constructor(
    readonly id: string,
    readonly baseUrl: string,
  ) {}

  async get(
    name: string,
    signal?: AbortSignal,
  ): Promise<RegistryItem | undefined> {
    const itemPath = validateRegistryPath(name)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/${itemPath}.json`,
      { signal },
    );
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(
        `Registry "${this.id}" returned ${response.status} for "${name}"`,
      );
    }
    const value = await response.json();
    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray((value as Record<string, unknown>)["files"]) ||
      (value as { files: unknown[] }).files.some(
        (file) =>
          !file ||
          typeof file !== "object" ||
          typeof (file as Record<string, unknown>)["content"] !== "string",
      )
    ) {
      throw new TypeError(
        `Registry "${this.id}" item "${name}" must inline every file's content`,
      );
    }
    return parseRegistryItem(value);
  }

  async list(signal?: AbortSignal): Promise<readonly RegistryIndexEntry[]> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/registry.json`,
      { signal },
    );
    if (!response.ok) {
      throw new Error(`Registry "${this.id}" returned ${response.status}`);
    }
    const value = await response.json();
    const items =
      value && typeof value === "object" && "items" in value
        ? (value as { items: unknown }).items
        : value;
    if (!Array.isArray(items)) {
      throw new TypeError(`Registry "${this.id}" index must be an array`);
    }
    return items.map((entry) => {
      const item = entry as Record<string, unknown>;
      const type = String(item["type"] ?? "component")
        .replace(/^registry:tuil-/, "")
        .replace(/^registry:/, "") as RegistryItemType;
      return {
        name: String(item["name"]),
        type: type === ("ui" as RegistryItemType) ? "component" : type,
        title: String(item["title"] ?? item["name"]),
        description: String(item["description"] ?? ""),
      };
    });
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
      if (
        !value ||
        typeof value !== "object" ||
        !Array.isArray((value as Record<string, unknown>)["files"]) ||
        (value as { files: unknown[] }).files.some(
          (file) =>
            !file ||
            typeof file !== "object" ||
            typeof (file as Record<string, unknown>)["content"] !== "string",
        )
      ) {
        throw new TypeError(
          `Local registry "${this.id}" item "${name}" must inline every file's content`,
        );
      }
      const item = parseRegistryItem(value);
      return item;
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
    return Array.isArray(value) ? value : (value.items ?? []);
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

function registryIdentity(item: RegistryItem): string {
  return item.registryName ?? item.name;
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

  constructor(readonly root: string) {
    this.root = resolve(root);
    this.#statePath = join(this.root, ".tuil", "registry.json");
  }

  async install(
    item: RegistryItem,
    options: RegistryTransformOptions & { readonly force?: boolean } = {},
  ): Promise<InstallResult> {
    return (await this.installMany([item], options))[0] as InstallResult;
  }

  async installMany(
    items: readonly RegistryItem[],
    options: RegistryTransformOptions & { readonly force?: boolean } = {},
  ): Promise<readonly InstallResult[]> {
    if (items.length === 0) {
      return [];
    }
    const state = await this.#readState();
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
        const content = await transformSource(
          file.content,
          file.target,
          options,
        );
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
    for (const item of items) {
      const identity = registryIdentity(item);
      const result = results.get(identity);
      if (result) {
        nextState.items[identity] = {
          files: result.hashes,
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
      await this.#writeState(nextState);
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
        ...staged.filter((file) => file.existed).map((file) => file.backup),
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
        const incoming = await transformSource(
          file.content,
          file.target,
          options,
        );
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
    const state = await this.#readState();
    for (const name of names) {
      if (!state.items[name]) {
        throw new Error(`Registry item "${name}" is not installed`);
      }
    }
    const removalSet = new Set(names);
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
        const survivingHashes = Object.entries(state.items)
          .filter(([owner]) => !removalSet.has(owner))
          .flatMap(([, owner]) => {
            const ownerHash = owner.files[file];
            return ownerHash ? [ownerHash] : [];
          });
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
    for (const name of names) delete nextItems[name];
    const moved: typeof planned = [];
    try {
      for (const file of planned) {
        await this.#secureAbsoluteTarget(file.target);
        await rename(file.target, file.backup);
        moved.push(file);
      }
      await this.#writeState({ version: 1, items: nextItems });
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

  async #writeState(state: InstallState): Promise<void> {
    await mkdir(dirname(this.#statePath), { recursive: true });
    await this.#secureAbsoluteTarget(this.#statePath);
    const temporary = `${this.#statePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, this.#statePath);
  }
}
