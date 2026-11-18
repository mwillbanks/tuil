import type { Root } from "fumadocs-core/page-tree";
import type { TOCItemType } from "fumadocs-core/toc";
import type { MDXContent } from "mdx/types";

export interface StaticPage {
  readonly path: string;
  readonly url: string;
  readonly slugs: string[];
  readonly locale?: string;
  readonly data: {
    readonly title: string;
    readonly description?: string;
    readonly full?: boolean;
    readonly toc: TOCItemType[];
    readonly body: MDXContent;
  };
}
export interface StaticRoute {
  readonly kind: "home" | "docs" | "playground" | "showcase" | "redirect";
  readonly pathname: string;
  readonly title: string;
  readonly description?: string;
  readonly page?: Omit<StaticPage, "data"> & {
    readonly data: Omit<StaticPage["data"], "body">;
  };
  readonly tree?: Root;
}
