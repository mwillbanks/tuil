import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <DocsLayout tree={source.getPageTree("en")} {...baseOptions("en")}>
      {props.children}
    </DocsLayout>
  );
}
