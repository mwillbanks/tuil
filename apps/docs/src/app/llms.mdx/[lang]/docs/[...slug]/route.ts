import { notFound } from "next/navigation";
import { getLLMText } from "@/lib/get-llm-text";
import { isDocsLocale } from "@/lib/i18n";
import { source } from "@/lib/source";

export const revalidate = false;

interface RawDocsParams {
  readonly lang: string;
  readonly slug: string[];
}

function normalizeSlug(slug: readonly string[]): string[] {
  if (slug.at(-1) !== "index.md") return [...slug];
  return slug.slice(0, -1);
}

export async function GET(
  _request: Request,
  context: { readonly params: Promise<RawDocsParams> },
): Promise<Response> {
  const { lang, slug } = await context.params;
  if (!isDocsLocale(lang)) notFound();
  const page = source.getPage(normalizeSlug(slug), lang);
  if (!page) notFound();
  return new Response(await getLLMText(page), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

export function generateStaticParams(): RawDocsParams[] {
  return source.getPages().map((page) => ({
    lang: page.locale ?? "en",
    slug: [...page.slugs, "index.md"],
  }));
}
