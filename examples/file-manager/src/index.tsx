import { Text } from "@mwillbanks/tuil-ink";
import { useEffect, useMemo, useState } from "react";
import { Tree } from "../../../registry/data-display/tree.tsx";
import { SplitPane } from "../../../registry/layout/panes.tsx";
import {
  createProductionApplicationAdapter,
  ProductionApplicationShell,
  type ProductionRecordSource,
  runExampleApplication,
} from "../../_shared.tsx";

const directorySource: ProductionRecordSource = {
  batchSize: 100,
  async *stream(signal) {
    if (typeof Bun === "undefined") {
      yield ["src", "README.md"];
      return;
    }
    let entries: string[] = [];
    for await (const path of new Bun.Glob("*").scan({ onlyFiles: false })) {
      signal.throwIfAborted();
      entries.push(path);
      if (entries.length === 100) {
        yield Object.freeze(entries.toSorted());
        entries = [];
      }
    }
    if (entries.length > 0) yield Object.freeze(entries.toSorted());
  },
  async read(path) {
    if (typeof Bun === "undefined") return `Preview unavailable for ${path}`;
    const file = Bun.file(path);
    if (!(await file.exists())) return `${path} is a directory`;
    return (await file.text()).slice(0, 8_192);
  },
};

function FilePreview(props: {
  readonly path: string;
  readonly read: (path: string) => Promise<string>;
}) {
  const [content, setContent] = useState("Loading preview…");
  useEffect(() => {
    let active = true;
    setContent("Loading preview…");
    void props.read(props.path).then(
      (value) => {
        if (active) setContent(value);
      },
      (error) => {
        if (active)
          setContent(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      active = false;
    };
  }, [props.path, props.read]);
  return (
    <>
      <Text bold>Preview: {props.path}</Text>
      <Text>{content}</Text>
    </>
  );
}

export function FileManagerApplication(
  props: { readonly source?: ProductionRecordSource } = {},
) {
  const [selected, setSelected] = useState("README.md");
  const source = props.source ?? directorySource;
  const adapter = useMemo(
    () => createProductionApplicationAdapter("file-manager", source),
    [source],
  );
  return (
    <ProductionApplicationShell kind="file-manager" adapter={adapter}>
      {({ lines, read }) => (
        <SplitPane
          id="file-manager-panes"
          panes={[
            {
              id: "files",
              content: (
                <Tree
                  id="file-tree"
                  label="Files"
                  onSelect={(item) => setSelected(item.label)}
                  items={lines.map((line, index) => ({
                    id: `entry-${index}`,
                    label: line,
                  }))}
                />
              ),
            },
            {
              id: "preview",
              content: <FilePreview path={selected} read={read} />,
            },
          ]}
        />
      )}
    </ProductionApplicationShell>
  );
}

if (import.meta.main)
  await runExampleApplication("file-manager", FileManagerApplication);
