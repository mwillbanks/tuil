import { generate as DefaultImage } from "fumadocs-ui/og/takumi";
import { notFound } from "next/navigation";
import { ImageResponse } from "takumi-js/response";
import { isDocsLocale } from "@/lib/i18n";
import { getPageImageUrl, source } from "@/lib/source";

export const revalidate = false;

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly slug: string[] }> },
): Promise<ImageResponse> {
  const { slug } = await context.params;
  const [locale, ...path] = slug.slice(0, -1);
  if (!locale || !isDocsLocale(locale)) notFound();
  const page = source.getPage(path, locale);
  if (!page) notFound();

  return new ImageResponse(
    <DefaultImage
      title={page.data.title}
      description={page.data.description}
      site="tuil"
    />,
    {
      format: "webp",
      height: 630,
      width: 1200,
    },
  );
}

export function generateStaticParams(): {
  readonly slug: string[];
}[] {
  return source.getPages().map((page) => ({
    slug: getPageImageUrl(page).segments,
  }));
}
