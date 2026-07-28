import { renderMermaidSVG } from "beautiful-mermaid";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import Image from "next/image";
import type { ReactNode } from "react";

function sanitizeMermaidSvg(svg: string): string {
  if (!svg.trimStart().startsWith("<svg")) {
    throw new TypeError("Mermaid renderer returned non-SVG markup");
  }
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(
      /\s(?:on[a-z]+|href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    );
}

export function Mermaid(props: { readonly chart: string }): ReactNode {
  try {
    const svg = sanitizeMermaidSvg(
      renderMermaidSVG(props.chart.replaceAll("\\n", "\n"), {
        accent: "#16e0e6",
        bg: "#090d17",
        border: "#2a3b62",
        fg: "#eef3ff",
        font: "var(--font-geist-mono)",
        line: "#7757ea",
        muted: "#94a3bd",
        surface: "#11192a",
        transparent: true,
      }),
    );
    return (
      <Image
        alt="Mermaid diagram"
        className="tuil-mermaid"
        height={540}
        src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
        unoptimized
        width={960}
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
