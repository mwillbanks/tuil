import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function prepareDocsAssets(
  options: Readonly<{
    logoSource?: string;
    publicDirectory?: string;
  }> = {},
): Promise<void> {
  const workspace = resolve(import.meta.dir, "../..");
  const publicDirectory =
    options.publicDirectory ?? resolve(workspace, "apps/docs/public");
  const logoSource = options.logoSource ?? resolve(workspace, "logo.svg");

  await mkdir(publicDirectory, { recursive: true });
  await copyFile(logoSource, resolve(publicDirectory, "logo.svg"));
  await writeFile(resolve(publicDirectory, ".nojekyll"), "", "utf8");
}

if (import.meta.main) {
  await prepareDocsAssets();
}
