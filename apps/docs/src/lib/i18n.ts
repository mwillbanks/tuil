import { defineI18n, type I18nConfig } from "fumadocs-core/i18n";

export const i18nConfig = {
  defaultLanguage: "en",
  fallbackLanguage: "en",
  hideLocale: "default-locale",
  languages: ["en"],
} satisfies I18nConfig<"en">;

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
  _locale: DocsLocale,
): string | undefined {
  return href;
}

export function localizeMarkdownDocsPaths(
  markdown: string,
  _locale: DocsLocale,
): string {
  return markdown;
}
