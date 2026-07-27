"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { localeFromPath } from "@/lib/i18n";

export function DocumentShell(props: {
  readonly bodyClassName: string;
  readonly children: ReactNode;
}): ReactNode {
  const locale = localeFromPath(usePathname());
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={props.bodyClassName}>
        <Providers locale={locale}>{props.children}</Providers>
      </body>
    </html>
  );
}
