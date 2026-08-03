function parts(value: string): string[] {
  return value.replaceAll("\\", "/").split("/").filter(Boolean);
}

export function basename(value: string): string {
  return parts(value).at(-1) ?? "";
}
export function dirname(value: string): string {
  const values = parts(value);
  values.pop();
  return `/${values.join("/")}`;
}
export function isAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(value);
}
export function join(...values: string[]): string {
  return resolve(...values);
}
export function resolve(...values: string[]): string {
  return `/${values.flatMap(parts).join("/")}`;
}
export function relative(from: string, to: string): string {
  const prefix = `${resolve(from).replace(/\/$/u, "")}/`;
  return resolve(to).replace(prefix, "").replace(/^\//u, "");
}
export const sep = "/";
export default { basename, dirname, isAbsolute, join, relative, resolve, sep };
