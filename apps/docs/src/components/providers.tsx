"use client";

import { i18nProvider } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import StaticSearchDialog from "@/components/search";
import type { DocsLocale } from "@/lib/i18n";
import { translations } from "@/lib/layout.shared";

export function Providers(props: {
  readonly children: ReactNode;
  readonly locale: DocsLocale;
}): ReactNode {
  return (
    <RootProvider
      i18n={i18nProvider(translations, props.locale)}
      search={{ SearchDialog: StaticSearchDialog }}
      theme={{ defaultTheme: "dark", forcedTheme: "dark" }}
    >
      {props.children}
    </RootProvider>
  );
}
