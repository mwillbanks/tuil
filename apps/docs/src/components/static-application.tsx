import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { MDXContent } from "mdx/types";
import type { ReactNode } from "react";
import HomePage from "../app/page";
import PlaygroundPage from "../app/playground/page";
import ShowcasePage from "../app/showcase/page";
import RetiredSpanishDocumentation from "../app/es/page";
import { baseOptions } from "../lib/layout.shared";
import type { StaticRoute } from "../lib/static-types";
import { DocsContent } from "./docs-content";
import { StaticFramework } from "./framework";
import { Providers } from "./providers";

export function StaticApplication(props: {
  readonly route: StaticRoute;
  readonly body?: MDXContent;
}): ReactNode {
  const { route } = props;
  let content: ReactNode;
  switch (route.kind) {
    case "docs":
      if (!route.page || !route.tree || !props.body)
        throw new Error("Documentation route is incomplete");
      content = (
        <DocsLayout
          tree={route.tree}
          sidebar={{ defaultOpenLevel: 1 }}
          {...baseOptions("en")}
        >
          <DocsContent
            lang="en"
            page={{
              ...route.page,
              data: { ...route.page.data, body: props.body },
            }}
          />
        </DocsLayout>
      );
      break;
    case "playground":
      content = <PlaygroundPage />;
      break;
    case "showcase":
      content = <ShowcasePage />;
      break;
    case "redirect":
      content = <RetiredSpanishDocumentation />;
      break;
    default:
      content = <HomePage />;
  }
  return (
    <StaticFramework pathname={route.pathname}>
      <Providers locale="en">{content}</Providers>
    </StaticFramework>
  );
}
