import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isDocsLocale } from "@/lib/i18n";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default async function LocalizedDocsLayout(props: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly lang: string }>;
}): Promise<ReactNode> {
  const { lang } = await props.params;
  if (!isDocsLocale(lang) || lang === "en") notFound();
  return (
    <DocsLayout
      containerProps={{ lang }}
      tree={source.getPageTree(lang)}
      {...baseOptions(lang)}
    >
      {props.children}
    </DocsLayout>
  );
}
