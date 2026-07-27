import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DocsContent } from "@/components/docs-content";
import { isDocsLocale } from "@/lib/i18n";
import { getPageImageUrl, source } from "@/lib/source";

interface LocalizedDocsParams {
  readonly lang: string;
  readonly slug?: string[];
}

async function getLocalizedPage(params: Promise<LocalizedDocsParams>): Promise<{
  readonly lang: "es";
  readonly page: NonNullable<ReturnType<typeof source.getPage>>;
}> {
  const { lang, slug } = await params;
  if (!isDocsLocale(lang) || lang === "en") notFound();
  const page = source.getPage(slug, lang);
  if (!page) notFound();
  return { lang, page };
}

export default async function LocalizedDocsPage(props: {
  readonly params: Promise<LocalizedDocsParams>;
}): Promise<ReactNode> {
  const { lang, page } = await getLocalizedPage(props.params);
  return <DocsContent lang={lang} page={page} />;
}

export function generateStaticParams(): LocalizedDocsParams[] {
  return source.getPages("es").map((page) => ({
    lang: "es",
    slug: page.slugs.length > 0 ? page.slugs : undefined,
  }));
}

export async function generateMetadata(props: {
  readonly params: Promise<LocalizedDocsParams>;
}) {
  const { page } = await getLocalizedPage(props.params);
  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
