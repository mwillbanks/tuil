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

function describeMermaid(chart: string): string {
  const statements = chart
    .replaceAll("\\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram)/u.test(
          line,
        ),
    )
    .slice(0, 8)
    .map((line) =>
      line
        .replaceAll(/\w+\["([^"]+)"\]/g, "$1")
        .replaceAll(/--?>|==>/g, " leads to ")
        .replaceAll(/\s+/g, " "),
    );
  return statements.length > 0
    ? statements.join("; ")
    : "A diagram supporting the surrounding documentation.";
}

export function Mermaid(props: {
  readonly chart: string;
  readonly description?: string;
  readonly title?: string;
}): ReactNode {
  const title = props.title ?? "Documentation flow diagram";
  const description = props.description ?? describeMermaid(props.chart);
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
      <figure className="tuil-mermaid-figure">
        <Image
          alt={`${title}. ${description}`}
          className="tuil-mermaid"
          height={540}
          src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
          unoptimized
          width={960}
        />
        <figcaption className="sr-only">
          <strong>{title}.</strong> {description}
        </figcaption>
      </figure>
    );
  } catch {
    return (
      <CodeBlock title="Mermaid">
        <Pre>{props.chart}</Pre>
      </CodeBlock>
    );
  }
}
