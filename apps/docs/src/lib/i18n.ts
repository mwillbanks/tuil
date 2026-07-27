import { defineI18n, type I18nConfig } from "fumadocs-core/i18n";

export const i18nConfig = {
  defaultLanguage: "en",
  fallbackLanguage: "en",
  hideLocale: "default-locale",
  languages: ["en", "es"],
} satisfies I18nConfig<"en" | "es">;

export const i18n = defineI18n(i18nConfig);

export type DocsLocale = (typeof i18n.languages)[number];

export function isDocsLocale(value: string): value is DocsLocale {
  return i18n.languages.includes(value as DocsLocale);
}

export function localeFromPath(pathname: string): DocsLocale {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment && isDocsLocale(segment) ? segment : i18n.defaultLanguage;
}

export function localizeDocsHref(href: string, locale: DocsLocale): string;
export function localizeDocsHref(
  href: string | undefined,
  locale: DocsLocale,
): string | undefined;
export function localizeDocsHref(
  href: string | undefined,
  locale: DocsLocale,
): string | undefined {
  if (
    locale === i18n.defaultLanguage ||
    !href ||
    !/^\/docs(?:$|[/?#])/.test(href)
  ) {
    return href;
  }
  return `/${locale}${href}`;
}

export function localizeMarkdownDocsPaths(
  markdown: string,
  locale: DocsLocale,
): string {
  if (locale === i18n.defaultLanguage) return markdown;
  return markdown
    .replace(
      /(\]\()(\/docs(?:[/?#][^)\s]*)?)(\))/g,
      (_match, open: string, path: string, close: string) =>
        `${open}${localizeDocsHref(path, locale)}${close}`,
    )
    .replace(
      /(\b(?:href|src)=["'])(\/docs(?:[/?#][^"']*)?)(["'])/g,
      (_match, open: string, path: string, close: string) =>
        `${open}${localizeDocsHref(path, locale)}${close}`,
    );
}
