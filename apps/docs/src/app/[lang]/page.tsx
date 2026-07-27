import { notFound } from "next/navigation";
import { HomePageContent } from "@/app/page";
import { isDocsLocale } from "@/lib/i18n";

export default async function LocalizedHome(props: {
  readonly params: Promise<{ readonly lang: string }>;
}) {
  const { lang } = await props.params;
  if (!isDocsLocale(lang) || lang === "en") notFound();
  return <HomePageContent locale={lang} />;
}

export function generateStaticParams(): { readonly lang: string }[] {
  return [{ lang: "es" }];
}
