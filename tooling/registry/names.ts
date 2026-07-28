export function registryExportName(name: string): string {
  const value = name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return value === "Default" ? "DefaultTheme" : value;
}
