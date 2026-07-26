export function normalizePublishedDependencies(
  dependencies: Record<string, string> | undefined,
  options: {
    readonly catalog: Readonly<Record<string, string>>;
    readonly workspaceVersions: ReadonlyMap<string, string>;
  },
): Record<string, string> | undefined {
  if (!dependencies) return undefined;
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => {
      if (version.startsWith("workspace:")) {
        const workspaceVersion = options.workspaceVersions.get(name);
        if (!workspaceVersion) {
          throw new Error(
            `Workspace dependency "${name}" has no publishable package version`,
          );
        }
        return [name, `^${workspaceVersion}`];
      }
      if (version === "catalog:") {
        const catalogVersion = options.catalog[name];
        if (!catalogVersion) {
          throw new Error(
            `Catalog has no published version for dependency "${name}"`,
          );
        }
        return [name, catalogVersion];
      }
      return [name, version];
    }),
  );
}
