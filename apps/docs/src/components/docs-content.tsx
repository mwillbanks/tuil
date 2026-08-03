import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import type { ReactNode } from "react";
import type { DocsLocale } from "@/lib/i18n";
import type { source } from "@/lib/source";
import { getMDXComponents } from "./mdx";
import { PageActions } from "./page-actions";

type SourcePage = NonNullable<ReturnType<typeof source.getPage>>;
export function DocsContent(props: {
  readonly lang: DocsLocale;
  readonly page: SourcePage;
}): ReactNode {
  const MDX = props.page.data.body;
  const slug = props.page.slugs.join("/");
  const markdownPath = slug.length > 0 ? `${slug}/` : "";
  return (
    <DocsPage toc={props.page.data.toc} full={props.page.data.full}>
      <DocsTitle>{props.page.data.title}</DocsTitle>
      <DocsDescription>{props.page.data.description}</DocsDescription>
      <PageActions
        markdownUrl={`/llms.mdx/${props.lang}/docs/${markdownPath}index.md`}
        sourcePath={props.page.path}
      />
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
