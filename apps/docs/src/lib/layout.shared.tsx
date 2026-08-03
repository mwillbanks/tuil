import { storyTranslations } from "@fumadocs/story/i18n";
import { uiTranslations } from "fumadocs-ui/i18n";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Brand } from "@/components/brand";
import { type DocsLocale, i18n } from "@/lib/i18n";

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .extend(storyTranslations())
  .add({
    en: {
      displayName: "English",
    },
  });

export function baseOptions(locale: DocsLocale = "en"): BaseLayoutProps {
  return {
    nav: {
      title: <Brand compact />,
      url: locale === i18n.defaultLanguage ? "/" : `/${locale}`,
    },
    githubUrl: "https://github.com/mwillbanks/tuil",
    themeSwitch: {
      enabled: false,
    },
  };
}
