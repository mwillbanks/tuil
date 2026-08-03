"use client";

import type {
  PlaygroundDocumentV1,
  PlaygroundNodeV1,
} from "@mwillbanks/tuil-ghostty-web";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GhosttyPlayground } from "./ghostty-playground";

type ComponentName = PlaygroundNodeV1["component"];
interface CatalogItem {
  readonly component: ComponentName;
  readonly props: readonly string[];
  readonly slots: readonly string[];
}

function controlValue(event: { readonly currentTarget: unknown }): string {
  return (event.currentTarget as { readonly value: string }).value;
}

function controlChecked(event: { readonly currentTarget: unknown }): boolean {
  return (event.currentTarget as { readonly checked: boolean }).checked;
}

const storageKey = "tuil-playground-document-v1";
const initialDocument: PlaygroundDocumentV1 = {
  version: 1,
  terminal: {
    width: 80,
    height: 24,
    theme: "default-dark",
    colorDepth: 24,
    unicode: true,
    reducedMotion: false,
  },
  root: {
    id: "application",
    component: "Box",
    props: { flexDirection: "column", gap: 1 },
    children: [
      {
        id: "heading-1",
        component: "Heading",
        props: { children: "Visual TUIL playground" },
      },
      {
        id: "text-1",
        component: "Text",
        props: {
          children: "Compose without evaluating source.",
          color: "cyan",
        },
      },
      {
        id: "button-1",
        component: "Button",
        props: { children: "Run", autoFocus: true },
      },
    ],
  },
};

function walk(node: PlaygroundNodeV1): readonly PlaygroundNodeV1[] {
  return [
    node,
    ...(node.children ?? []).flatMap(walk),
    ...Object.values(node.slots ?? {}).flatMap((nodes) => nodes.flatMap(walk)),
  ];
}

function findNode(
  node: PlaygroundNodeV1,
  id: string,
): PlaygroundNodeV1 | undefined {
  return walk(node).find((candidate) => candidate.id === id);
}

function mapNode(
  node: PlaygroundNodeV1,
  id: string,
  update: (node: PlaygroundNodeV1) => PlaygroundNodeV1,
): PlaygroundNodeV1 {
  if (node.id === id) return update(node);
  return {
    ...node,
    children: node.children?.map((child) => mapNode(child, id, update)),
    slots: node.slots
      ? Object.fromEntries(
          Object.entries(node.slots).map(([name, nodes]) => [
            name,
            nodes.map((child) => mapNode(child, id, update)),
          ]),
        )
      : undefined,
  };
}

function transformSiblings(
  node: PlaygroundNodeV1,
  id: string,
  transform: (
    nodes: readonly PlaygroundNodeV1[],
    index: number,
  ) => readonly PlaygroundNodeV1[],
): PlaygroundNodeV1 {
  const transformList = (nodes: readonly PlaygroundNodeV1[]) => {
    const index = nodes.findIndex((candidate) => candidate.id === id);
    return index >= 0
      ? transform(nodes, index)
      : nodes.map((child) => transformSiblings(child, id, transform));
  };
  return {
    ...node,
    children: node.children ? transformList(node.children) : undefined,
    slots: node.slots
      ? Object.fromEntries(
          Object.entries(node.slots).map(([name, nodes]) => [
            name,
            transformList(nodes),
          ]),
        )
      : undefined,
  };
}

function reorderSiblings(
  node: PlaygroundNodeV1,
  draggedId: string,
  targetId: string,
): PlaygroundNodeV1 {
  return transformSiblings(node, draggedId, (nodes, from) => {
    const to = nodes.findIndex((candidate) => candidate.id === targetId);
    if (to < 0) return nodes;
    const result = [...nodes];
    const [dragged] = result.splice(from, 1);
    if (dragged) result.splice(to, 0, dragged);
    return result;
  });
}

function componentDefaults(
  component: ComponentName,
): Readonly<Record<string, unknown>> {
  const defaults: Partial<
    Record<ComponentName, Readonly<Record<string, unknown>>>
  > = {
    Progress: { label: "Progress", value: 50, max: 100 },
    Spinner: { label: "Loading" },
    Divider: { label: "Section" },
    Alert: { title: "Notice", children: "Alert content", tone: "info" },
    Box: { flexDirection: "column", gap: 1 },
    Stack: { direction: "column", gap: 1 },
    HStack: { gap: 1 },
    VStack: { gap: 1 },
    ResponsiveStack: { gap: 1 },
    AppShell: { gap: 1 },
    AppBar: { gap: 1 },
    StatusBar: { gap: 1 },
    Container: { paddingX: 1 },
  };
  return defaults[component] ?? { children: component };
}

function Tree(props: {
  readonly nodes: readonly PlaygroundNodeV1[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly onDragStart: (id: string) => void;
  readonly onDrop: (id: string) => void;
}): ReactNode {
  return (
    <ol>
      {props.nodes.map((node) => (
        <li
          draggable
          key={node.id}
          onDragStart={() => props.onDragStart(node.id)}
          onDragOver={(event: DragEvent<HTMLLIElement>) =>
            event.preventDefault()
          }
          onDrop={() => props.onDrop(node.id)}
        >
          <button
            aria-pressed={props.selectedId === node.id}
            type="button"
            onClick={() => props.onSelect(node.id)}
          >
            {node.component} · {node.id}
          </button>
          {node.children?.length ? (
            <Tree {...props} nodes={node.children} />
          ) : null}
          {Object.entries(node.slots ?? {}).map(([name, nodes]) => (
            <section aria-label={`${node.id} ${name} slot`} key={name}>
              <strong>{name} slot</strong>
              <Tree {...props} nodes={nodes} />
            </section>
          ))}
        </li>
      ))}
    </ol>
  );
}

export function VisualComposer(): ReactNode {
  const [document, setDocument] = useState(initialDocument);
  const [catalog, setCatalog] = useState<readonly CatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState("application");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("Document ready.");
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState("children");
  const [draggedId, setDraggedId] = useState<string>();
  const [treeOpen, setTreeOpen] = useState(false);
  const treeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const treeModalRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!treeOpen) return;
    const browser = globalThis as unknown as {
      readonly document: { readonly activeElement: unknown };
      addEventListener(
        type: "keydown",
        listener: (event: {
          readonly key: string;
          readonly shiftKey: boolean;
          preventDefault(): void;
        }) => void,
      ): void;
      removeEventListener(
        type: "keydown",
        listener: (event: {
          readonly key: string;
          readonly shiftKey: boolean;
          preventDefault(): void;
        }) => void,
      ): void;
    };
    type FocusTarget = { focus(): void };
    const modal = treeModalRef.current as unknown as {
      querySelectorAll(selector: string): readonly FocusTarget[];
    } | null;
    const focusableSelector =
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    if (!modal) return;
    const focusable = () =>
      Array.from(modal.querySelectorAll(focusableSelector));
    focusable()[0]?.focus();
    const handleKeyDown = (event: {
      readonly key: string;
      readonly shiftKey: boolean;
      preventDefault(): void;
    }) => {
      if (event.key === "Escape") {
        setTreeOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const targets = focusable();
      if (!targets.length) return;
      const currentIndex = targets.indexOf(
        browser.document.activeElement as FocusTarget,
      );
      if (event.shiftKey && (currentIndex <= 0 || currentIndex < 0)) {
        event.preventDefault();
        targets[targets.length - 1]?.focus();
      } else if (
        !event.shiftKey &&
        (currentIndex === targets.length - 1 || currentIndex < 0)
      ) {
        event.preventDefault();
        targets[0]?.focus();
      }
    };
    browser.addEventListener("keydown", handleKeyDown);
    return () => {
      browser.removeEventListener("keydown", handleKeyDown);
      (treeTriggerRef.current as unknown as FocusTarget | null)?.focus();
    };
  }, [treeOpen]);
  const selected = useMemo(
    () => findNode(document.root, selectedId),
    [document, selectedId],
  );
  const selectedCatalog = catalog.find(
    (item) => item.component === selected?.component,
  );

  useEffect(() => {
    const validSlots = ["children", ...(selectedCatalog?.slots ?? [])];
    if (!validSlots.includes(slot)) setSlot("children");
  }, [selectedCatalog, slot]);

  useEffect(() => {
    let active = true;
    void import("@mwillbanks/tuil-ghostty-web")
      .then((adapter) => {
        if (!active) return;
        setCatalog(adapter.playgroundComponentCatalog);
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const restored = adapter.validatePlaygroundDocument(
            JSON.parse(saved) as PlaygroundDocumentV1,
          );
          setDocument(restored);
          setSelectedId(restored.root.id);
          setStatus("Saved document restored.");
        }
      })
      .catch(
        (cause: unknown) =>
          active &&
          setStatus(
            `Catalog failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
      );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void import("@mwillbanks/tuil-ghostty-web")
      .then((adapter) => {
        const generated = adapter.generatePlaygroundTsx(document);
        if (active) setSource(generated);
      })
      .catch(
        (cause: unknown) =>
          active &&
          setStatus(
            `Generation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
      );
    return () => {
      active = false;
    };
  }, [document]);

  const updateRoot = (root: PlaygroundNodeV1) =>
    setDocument((current) => ({ ...current, root }));
  const add = (component: ComponentName) => {
    const used = new Set(walk(document.root).map((node) => node.id));
    const prefix = component.replace(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase();
    let index = 1;
    while (used.has(`${prefix}-${index}`)) index++;
    const node: PlaygroundNodeV1 = {
      id: `${prefix}-${index}`,
      component,
      props: componentDefaults(component),
    };
    const targetId = selected?.id ?? document.root.id;
    updateRoot(
      mapNode(document.root, targetId, (target) =>
        slot === "children"
          ? { ...target, children: [...(target.children ?? []), node] }
          : {
              ...target,
              slots: {
                ...target.slots,
                [slot]: [...(target.slots?.[slot] ?? []), node],
              },
            },
      ),
    );
    setSelectedId(node.id);
    setSlot("children");
    setStatus(`Added ${component}.`);
  };
  const updateSelectedProp = (key: string, value: unknown) => {
    updateRoot(
      mapNode(document.root, selectedId, (node) => {
        const props = { ...node.props };
        if (value === undefined || value === "") delete props[key];
        else props[key] = value;
        return { ...node, props };
      }),
    );
  };
  const move = (delta: number) => {
    updateRoot(
      transformSiblings(document.root, selectedId, (nodes, index) => {
        const target = index + delta;
        if (target < 0 || target >= nodes.length) return nodes;
        const result = [...nodes];
        [result[index], result[target]] = [
          result[target] as PlaygroundNodeV1,
          result[index] as PlaygroundNodeV1,
        ];
        return result;
      }),
    );
    setStatus("Component order changed.");
  };
  const remove = () => {
    if (selectedId === document.root.id) return;
    updateRoot(
      transformSiblings(document.root, selectedId, (nodes, index) =>
        nodes.filter((_node, candidate) => candidate !== index),
      ),
    );
    setSelectedId(document.root.id);
    setStatus("Component removed.");
  };
  const duplicate = () => {
    if (!selected || selected.id === document.root.id) return;
    const used = new Set(walk(document.root).map((node) => node.id));
    const clone = (node: PlaygroundNodeV1): PlaygroundNodeV1 => {
      let index = 2;
      let id = `${node.id}-copy`;
      while (used.has(id)) id = `${node.id}-copy-${index++}`;
      used.add(id);
      return {
        ...node,
        id,
        children: node.children?.map(clone),
        slots: node.slots
          ? Object.fromEntries(
              Object.entries(node.slots).map(([name, nodes]) => [
                name,
                nodes.map(clone),
              ]),
            )
          : undefined,
      };
    };
    const copy = clone(selected);
    updateRoot(
      transformSiblings(document.root, selectedId, (nodes, index) => [
        ...nodes.slice(0, index + 1),
        copy,
        ...nodes.slice(index + 1),
      ]),
    );
    setSelectedId(copy.id);
    setStatus("Component duplicated.");
  };
  const save = () => {
    localStorage.setItem(storageKey, JSON.stringify(document));
    setStatus("Document saved locally.");
  };
  const download = (content: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = (
      globalThis as unknown as {
        readonly document: {
          createElement(name: "a"): {
            href: string;
            download: string;
            click(): void;
          };
        };
      }
    ).document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`${name} downloaded.`);
  };
  const importDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = (
      event.currentTarget as unknown as { readonly files?: readonly File[] }
    ).files?.[0];
    if (!file) return;
    try {
      const candidate = JSON.parse(await file.text()) as PlaygroundDocumentV1;
      const adapter = await import("@mwillbanks/tuil-ghostty-web");
      const validated = adapter.validatePlaygroundDocument(candidate);
      setDocument(validated);
      setSelectedId(validated.root.id);
      setStatus("Document imported.");
    } catch (cause) {
      setStatus(
        `Import failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };

  const insertionSlots = ["children", ...(selectedCatalog?.slots ?? [])];
  const visibleCatalog = catalog.filter((item) =>
    item.component.toLowerCase().includes(query.toLowerCase()),
  );
  const renderTree = (titleId: string) => (
    <div className="composer-tree-content">
      <div className="composer-tree-heading">
        <div>
          <p className="composer-eyebrow">Structure</p>
          <h2 id={titleId}>Component tree</h2>
        </div>
        <span className="composer-tree-hint">Drag to reorder</span>
      </div>
      <Tree
        nodes={[document.root]}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setSlot("children");
          setTreeOpen(false);
        }}
        onDragStart={setDraggedId}
        onDrop={(targetId) => {
          if (draggedId && draggedId !== targetId) {
            updateRoot(reorderSiblings(document.root, draggedId, targetId));
            setStatus("Component moved by pointer.");
          }
          setDraggedId(undefined);
        }}
      />
      <fieldset className="composer-actions" aria-label="Component actions">
        <button type="button" onClick={() => move(-1)}>
          Move up
        </button>
        <button type="button" onClick={() => move(1)}>
          Move down
        </button>
        <button type="button" onClick={duplicate}>
          Duplicate
        </button>
        <button type="button" onClick={remove}>
          Delete
        </button>
      </fieldset>
    </div>
  );
  return (
    <section className="visual-composer">
      <header className="composer-header">
        <div>
          <p className="composer-eyebrow">Visual composer</p>
          <h2>Build your interface</h2>
          <p>Select a node, adjust its props, and preview the result live.</p>
        </div>
        <button
          className="composer-tree-trigger"
          ref={treeTriggerRef}
          type="button"
          aria-controls="mobile-component-tree"
          aria-expanded={treeOpen}
          onClick={() => setTreeOpen(true)}
        >
          <span aria-hidden="true">☷</span>
          Component tree
        </button>
      </header>
      <div className="composer-workspace">
        <aside className="composer-sidebar" aria-label="Composer controls">
          <section
            className="composer-panel composer-palette"
            aria-label="Component palette"
          >
            <div className="composer-panel-heading">
              <div>
                <p className="composer-eyebrow">Add building blocks</p>
                <h2>Components</h2>
              </div>
              <span>{visibleCatalog.length} available</span>
            </div>
            <label className="composer-field">
              <span>Search palette</span>
              <input
                value={query}
                placeholder="Search components"
                onChange={(event) => setQuery(controlValue(event))}
              />
            </label>
            <label className="composer-field">
              <span>Insert into</span>
              <select
                value={slot}
                onChange={(event) => setSlot(controlValue(event))}
              >
                {insertionSlots.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <div className="composer-component-list">
              {visibleCatalog.map(({ component }) => (
                <button
                  key={component}
                  type="button"
                  onClick={() => add(component)}
                >
                  <span aria-hidden="true">+</span>
                  Add {component}
                </button>
              ))}
            </div>
          </section>
          <section
            className="composer-tree-desktop"
            aria-labelledby="component-tree-title"
          >
            {renderTree("component-tree-title")}
          </section>
          <section className="composer-panel composer-properties">
            <div className="composer-panel-heading">
              <div>
                <p className="composer-eyebrow">Selected node</p>
                <h2>Properties</h2>
              </div>
              <code>{selected?.id ?? "none"}</code>
            </div>
            {selected && selectedCatalog ? (
              selectedCatalog.props.map((name) => {
                const value = selected.props[name];
                const booleanValue =
                  typeof value === "boolean" ||
                  ["autoFocus", "disabled", "showValue"].includes(name);
                const numericValue =
                  typeof value === "number" ||
                  [
                    "gap",
                    "level",
                    "max",
                    "maxWidth",
                    "padding",
                    "paddingX",
                    "paddingY",
                    "value",
                    "width",
                  ].includes(name);
                return (
                  <label className="composer-field" key={name}>
                    <span>{name}</span>
                    <input
                      checked={booleanValue ? Boolean(value) : undefined}
                      type={
                        booleanValue
                          ? "checkbox"
                          : numericValue
                            ? "number"
                            : "text"
                      }
                      value={
                        booleanValue
                          ? undefined
                          : value === undefined
                            ? ""
                            : typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)
                      }
                      onChange={(event) => {
                        if (booleanValue)
                          updateSelectedProp(name, controlChecked(event));
                        else if (numericValue)
                          updateSelectedProp(
                            name,
                            controlValue(event) === ""
                              ? undefined
                              : Number(controlValue(event)),
                          );
                        else if (name === "directions") {
                          try {
                            updateSelectedProp(
                              name,
                              JSON.parse(controlValue(event)),
                            );
                          } catch {
                            setStatus("Directions must be valid JSON.");
                          }
                        } else updateSelectedProp(name, controlValue(event));
                      }}
                    />
                  </label>
                );
              })
            ) : (
              <p className="composer-empty">
                Select a component from the tree.
              </p>
            )}
            <div className="composer-subheading">
              <p className="composer-eyebrow">Output</p>
              <h3>Terminal settings</h3>
            </div>
            <div className="composer-terminal-fields">
              <label className="composer-field">
                <span>Width</span>
                <input
                  type="number"
                  value={document.terminal.width}
                  onChange={(event) =>
                    setDocument((current) => ({
                      ...current,
                      terminal: {
                        ...current.terminal,
                        width: Number(controlValue(event)),
                      },
                    }))
                  }
                />
              </label>
              <label className="composer-field">
                <span>Height</span>
                <input
                  type="number"
                  value={document.terminal.height}
                  onChange={(event) =>
                    setDocument((current) => ({
                      ...current,
                      terminal: {
                        ...current.terminal,
                        height: Number(controlValue(event)),
                      },
                    }))
                  }
                />
              </label>
              <label className="composer-field">
                <span>Theme</span>
                <select
                  value={document.terminal.theme}
                  onChange={(event) =>
                    setDocument((current) => ({
                      ...current,
                      terminal: {
                        ...current.terminal,
                        theme: controlValue(event),
                      },
                    }))
                  }
                >
                  <option>default-dark</option>
                  <option>default-light</option>
                </select>
              </label>
              <label className="composer-field">
                <span>Color depth</span>
                <select
                  value={document.terminal.colorDepth ?? 24}
                  onChange={(event) =>
                    setDocument((current) => ({
                      ...current,
                      terminal: {
                        ...current.terminal,
                        colorDepth: Number(controlValue(event)) as
                          | 1
                          | 4
                          | 8
                          | 24,
                      },
                    }))
                  }
                >
                  <option value="1">Monochrome</option>
                  <option value="4">ANSI</option>
                  <option value="8">256 colors</option>
                  <option value="24">True color</option>
                </select>
              </label>
              <label className="composer-check">
                <input
                  type="checkbox"
                  checked={document.terminal.unicode ?? true}
                  onChange={(event) =>
                    setDocument((current) => ({
                      ...current,
                      terminal: {
                        ...current.terminal,
                        unicode: controlChecked(event),
                      },
                    }))
                  }
                />
                Unicode
              </label>
              <label className="composer-check">
                <input
                  type="checkbox"
                  checked={document.terminal.reducedMotion ?? false}
                  onChange={(event) =>
                    setDocument((current) => ({
                      ...current,
                      terminal: {
                        ...current.terminal,
                        reducedMotion: controlChecked(event),
                      },
                    }))
                  }
                />
                Reduced motion
              </label>
            </div>
          </section>
        </aside>
        <div className="visual-preview">
          <div className="composer-preview-heading">
            <div>
              <p className="composer-eyebrow">Live preview</p>
              <h2>Terminal canvas</h2>
            </div>
            <span>Ghostty Web · Ink 7</span>
          </div>
          <GhosttyPlayground document={document} />
        </div>
      </div>
      <section className="visual-source">
        <h2>Generated TSX</h2>
        <pre>
          <code>{source}</code>
        </pre>
        <div>
          <button
            type="button"
            onClick={() =>
              void (
                navigator as Navigator & {
                  readonly clipboard: {
                    writeText(value: string): Promise<void>;
                  };
                }
              ).clipboard
                .writeText(source)
                .then(
                  () => setStatus("Source copied."),
                  () => setStatus("Copy failed."),
                )
            }
          >
            Copy TSX
          </button>
          <button
            type="button"
            onClick={() =>
              download(source, "tuil-playground.tsx", "text/typescript")
            }
          >
            Download TSX
          </button>
          <button type="button" onClick={save}>
            Save
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                JSON.stringify(document, null, 2),
                "tuil-playground.json",
                "application/json",
              )
            }
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => {
              setDocument(initialDocument);
              setSelectedId("heading-1");
              setStatus("Document reset.");
            }}
          >
            Reset document
          </button>
          <label className="file-button">
            Import JSON
            <input
              type="file"
              accept="application/json"
              onChange={(event) => void importDocument(event)}
            />
          </label>
        </div>
        <p>Install: bun add @mwillbanks/tuil @mwillbanks/tuil-ink</p>
      </section>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      {treeOpen ? (
        <div className="composer-tree-backdrop" role="presentation">
          <section
            className="composer-tree-modal"
            ref={treeModalRef}
            id="mobile-component-tree"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-component-tree-title"
          >
            <div className="composer-tree-modal-close">
              <button type="button" onClick={() => setTreeOpen(false)}>
                Close
              </button>
            </div>
            {renderTree("mobile-component-tree-title")}
          </section>
        </div>
      ) : null}
    </section>
  );
}
