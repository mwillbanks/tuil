import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DocsContent } from "@/components/docs-content";
import { getPageImageUrl, source } from "@/lib/source";

export default async function Page(props: {
  readonly params: Promise<{ readonly slug?: string[] }>;
}): Promise<ReactNode> {
  const params = await props.params;
  const page = source.getPage(params.slug, "en");
  if (!page) notFound();
  return <DocsContent lang="en" page={page} />;
}

export function generateStaticParams(): { readonly slug?: string[] }[] {
  return source
    .getPages("en")
    .map((page) => ({ slug: page.slugs.length > 0 ? page.slugs : undefined }));
}

export async function generateMetadata(props: {
  readonly params: Promise<{ readonly slug?: string[] }>;
}) {
  const page = source.getPage((await props.params).slug, "en");
  if (!page) notFound();
  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
