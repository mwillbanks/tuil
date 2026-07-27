import { renderMermaidSVG } from "beautiful-mermaid";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import type { ReactNode } from "react";

export function Mermaid(props: { readonly chart: string }): ReactNode {
  try {
    const svg = renderMermaidSVG(props.chart.replaceAll("\\n", "\n"), {
      accent: "#16e0e6",
      bg: "#090d17",
      border: "#2a3b62",
      fg: "#eef3ff",
      font: "var(--font-geist-mono)",
      line: "#7757ea",
      muted: "#94a3bd",
      surface: "#11192a",
      transparent: true,
    });
    return (
      <div
        className="tuil-mermaid"
        // The renderer emits a self-contained SVG from the local chart string.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  } catch {
    return (
      <CodeBlock title="Mermaid">
        <Pre>{props.chart}</Pre>
      </CodeBlock>
    );
  }
}
