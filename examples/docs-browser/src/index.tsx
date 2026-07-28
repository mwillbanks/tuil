import { MarkdownViewer } from "../../../registry/data-display/rich-content.tsx";
import { SplitPane } from "../../../registry/layout/panes.tsx";
import { Outline } from "../../../registry/navigation/navigation.tsx";
import {
  createProductionApplicationAdapter,
  ProductionApplicationShell,
  type ProductionRecordSource,
  runExampleApplication,
} from "../../_shared.tsx";

const documentationSource: ProductionRecordSource = {
  batchSize: 100,
  async *stream(signal) {
    if (typeof Bun === "undefined") {
      yield ["Introduction", "Renderers", "Logging"];
      return;
    }
    let documents: string[] = [];
    for await (const path of new Bun.Glob(
      "apps/docs/content/docs/**/*.mdx",
    ).scan()) {
      signal.throwIfAborted();
      documents.push(path);
      if (documents.length === 100) {
        yield Object.freeze(documents.toSorted());
        documents = [];
      }
    }
    if (documents.length > 0) yield Object.freeze(documents.toSorted());
  },
  async read(path) {
    if (typeof Bun === "undefined") return `# ${path}`;
    return Bun.file(path).text();
  },
};

function DocumentationWorkspace(props: {
  readonly documents: readonly string[];
  readonly read: (path: string) => Promise<string>;
}) {
  const [active, setActive] = useState(0);
  const [source, setSource] = useState("# TUIL docs");
  useTerminalInput((input, key) => {
    if (key.upArrow || input === "k") {
      setActive((value) =>
        Math.max(0, Math.min(props.documents.length - 1, value - 1)),
      );
      return true;
    }
    if (key.downArrow || input === "j") {
      setActive((value) =>
        Math.max(0, Math.min(props.documents.length - 1, value + 1)),
      );
      return true;
    }
    return false;
  });
  const selected = props.documents[active];
  useEffect(() => {
    let mounted = true;
    if (!selected) {
      setSource("# No documentation matched");
      return;
    }
    void props.read(selected).then((value) => {
      if (mounted) setSource(value);
    });
    return () => {
      mounted = false;
    };
  }, [props.read, selected]);
  return (
    <SplitPane
      id="docs-panes"
      panes={[
        {
          id: "outline",
          content: (
            <Outline
              items={props.documents.slice(0, 20).map((line, index) => ({
                id: `document-${index}`,
                label: line,
                selected: index === active,
              }))}
            />
          ),
        },
        {
          id: "document",
          content: <MarkdownViewer source={source} />,
        },
      ]}
    />
  );
}

export function DocsBrowserApplication(
  props: { readonly source?: ProductionRecordSource } = {},
) {
  const source = props.source ?? documentationSource;
  const adapter = useMemo(
    () => createProductionApplicationAdapter("docs-browser", source),
    [source],
  );
  return (
    <ProductionApplicationShell kind="docs-browser" adapter={adapter}>
      {({ lines, read }) => (
        <DocumentationWorkspace documents={lines.slice(1)} read={read} />
      )}
    </ProductionApplicationShell>
  );
}

if (import.meta.main)
  await runExampleApplication("docs-browser", DocsBrowserApplication);

import { useTerminalInput } from "@mwillbanks/tuil-ink";
import { useEffect, useMemo, useState } from "react";
