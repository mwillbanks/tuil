import { prefixMarkdownDeploymentPaths, withBasePath } from "@/lib/base-path";
import { isDocsLocale, localizeMarkdownDocsPaths } from "@/lib/i18n";
import type { source } from "@/lib/source";

export async function getLLMText(
  page: (typeof source)["$inferPage"],
): Promise<string> {
  const content = await page.data.getText("processed");
  const locale = page.locale && isDocsLocale(page.locale) ? page.locale : "en";
  return `# ${page.data.title}

Source: ${withBasePath(page.url)}
Locale: ${locale}

${page.data.description ?? ""}

${prefixMarkdownDeploymentPaths(localizeMarkdownDocsPaths(content, locale))}`;
}
