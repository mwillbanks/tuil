declare module "*.mdx" {
  import type { MDXContent } from "mdx/types";
  const content: MDXContent;
  export default content;
}
declare module "*.mdx?collection=docs" {
  import type { MDXContent } from "mdx/types";
  const content: MDXContent;
  export default content;
}

declare module "tuil:docs-content" {
  import type { MDXContent } from "mdx/types";
  export function loadDocument(path: string): Promise<{ default: MDXContent }>;
}
