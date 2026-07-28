import { expect, test } from "bun:test";
import { renderTuil } from "@mwillbanks/tuil-testing-ink";
import {
  fitTerminalText,
  TerminalVirtualizerAdapter,
} from "@mwillbanks/tuil-virtual";
import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Box, Text } from "ink";
import { useState } from "react";
import { DataTable, Table } from "./data-display/complex-data.tsx";
import { createLineDiff, DiffViewer } from "./data-display/diff-viewer.tsx";
import { flattenJson, JsonViewer } from "./data-display/json-viewer.tsx";
import { type LogEntry, LogViewer } from "./data-display/log-viewer.tsx";
import { Tree } from "./data-display/tree.tsx";
import { VirtualList } from "./data-display/virtual-list.tsx";
import { ErrorBoundary } from "./feedback/overlays.tsx";
import { TransferList } from "./forms/transfer-list.tsx";
import { SplitPane } from "./layout/panes.tsx";
import { ResizablePane } from "./layout/resizable-pane.tsx";

async function clickMeasured(
  view: ReturnType<typeof renderTuil>,
  id: string,
): Promise<void> {
  const bounds = view.app.layout.get(id)?.bounds;
  expect(bounds).toBeDefined();
  if (!bounds) throw new Error(`Pointer target "${id}" was not measured`);
  const column = bounds.x + 1;
  const row = bounds.y + 1;
  await view.user.press(`\u001b[<0;${column};${row}M`);
  await view.user.press(`\u001b[<0;${column};${row}m`);
}

async function dragMeasured(
  view: ReturnType<typeof renderTuil>,
  id: string,
  deltaX: number,
): Promise<void> {
  const bounds = view.app.layout.get(id)?.bounds;
  expect(bounds).toBeDefined();
  if (!bounds) throw new Error(`Pointer target "${id}" was not measured`);
  const column = bounds.x + 1;
  const row = bounds.y + 1;
  await view.user.press(`\u001b[<0;${column};${row}M`);
  await view.user.press(`\u001b[<32;${column + deltaX};${row}M`);
  await view.user.press(`\u001b[<0;${column + deltaX};${row}m`);
}

test("terminal virtualization is bounded, fast, and ANSI width safe", () => {
  const adapter = new TerminalVirtualizerAdapter({
    count: 1_000_000,
    viewportSize: 20,
    scrollOffset: 900_000,
    overscan: 2,
  });
  const started = performance.now();
  let last = adapter.measure({
    count: 1_000_000,
    viewportSize: 20,
    scrollOffset: 900_000,
    overscan: 2,
  });
  for (let index = 0; index < 10_000; index += 1) {
    last = adapter.measure({
      count: 1_000_000,
      viewportSize: 20,
      scrollOffset: index * 10,
      overscan: 2,
    });
  }
  adapter.dispose();
  expect(last.indexes.length).toBeLessThanOrEqual(24);
  expect(performance.now() - started).toBeLessThan(250);
  expect(fitTerminalText("\u001b[31m界面\u001b[39m", 5)).toBe(
    "\u001b[31m界面\u001b[39m ",
  );
  expect(fitTerminalText("terminal", 5)).toEndWith("…");
});

test("virtual lists honor overscan and accept falsey items", async () => {
  const rendered = new Set<number>();
  let selected: number | undefined;
  const view = renderTuil(
    <VirtualList
      id="numeric-list"
      testId="numeric-list"
      description="Falsey values"
      items={Array.from({ length: 20 }, (_value, index) => index)}
      height={5}
      overscan={1}
      defaultOffset={10}
      defaultActiveIndex={10}
      getItemKey={(item) => String(item)}
      getItemLabel={(item) => String(item)}
      renderItem={(item) => {
        rendered.add(item);
        return String(item);
      }}
      onSelect={(item) => {
        selected = item;
      }}
    />,
  );
  await view.ready;
  expect(rendered.has(9)).toBeTrue();
  expect(rendered.has(15)).toBeTrue();
  expect(view.screen.getByTestId("numeric-list").description).toBe(
    "Falsey values",
  );
  expect(view.app.focus.focus("numeric-list")).toBeTrue();
  await view.user.press("home");
  await view.user.press("enter");
  expect(selected).toBe(0);
  expect(view.screen.frame()).toContain("0");
  await view.cleanup();
});

test("virtual lists share scroll restoration and pointer selection", async () => {
  let selected = "";
  const renderList = () =>
    renderTuil(
      <VirtualList
        id="restored-list"
        items={Array.from({ length: 20 }, (_value, index) => `item-${index}`)}
        height={3}
        getItemKey={(item) => item}
        renderItem={(item) => item}
        onSelect={(item) => {
          selected = item;
        }}
      />,
    );
  const first = renderList();
  await first.ready;
  expect(first.app.focus.focus("restored-list")).toBeTrue();
  await first.user.press("end");
  expect(first.app.scroll.get("restored-list")?.snapshot().atBottom).toBeTrue();
  await clickMeasured(first, "restored-list:item:item-19");
  expect(selected).toBe("item-19");
  await first.cleanup();
});

test("virtual lists keep rendering bounded and scroll active focus into view", async () => {
  const items = Array.from({ length: 10_000 }, (_value, index) => ({
    id: `item-${index}`,
    label: `Item ${index}`,
  }));
  let selected = "";
  const view = renderTuil(
    <VirtualList
      id="large-list"
      label="Large list"
      items={items}
      height={5}
      overscan={1}
      getItemKey={(item) => item.id}
      getItemLabel={(item) => item.label}
      renderItem={(item) => item.label}
      onSelect={(item) => {
        selected = item.id;
      }}
    />,
  );
  await view.ready;
  expect(view.app.focus.focus("large-list")).toBeTrue();
  await view.user.press("end");
  await view.user.press("enter");
  expect(selected).toBe("item-9999");
  expect(view.screen.frame()).toContain("Item 9999");
  expect(view.screen.getAllByRole("option").length).toBeLessThanOrEqual(7);
  await view.cleanup();
});

interface Person {
  readonly id: string;
  readonly name: string;
  readonly score: number;
}

const people: readonly Person[] = [
  { id: "b", name: "Beta", score: 2 },
  { id: "a", name: "Alpha", score: 1 },
  { id: "c", name: "Gamma", score: 3 },
];

const personColumns: ColumnDef<Person>[] = [
  { accessorKey: "name", header: "Name", size: 12 },
  { accessorKey: "score", header: "Score", size: 8 },
];

let visiblePersonIds: readonly string[] = [];
let currentSorting: SortingState = [];

function DataTableHarness(): React.ReactNode {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const table = useReactTable({
    data: [...people],
    columns: personColumns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
  });
  currentSorting = sorting;
  visiblePersonIds = table.getRowModel().rows.map((row) => row.id);
  return (
    <DataTable
      id="people-table"
      label="People"
      table={table}
      height={2}
      width={24}
    />
  );
}

test("tables lazily project rows and support uncontrolled selection", async () => {
  const rows = Array.from({ length: 100_000 }, (_value, index) => ({
    id: `row-${index}`,
    value: index,
  }));
  let projections = 0;
  const activations: number[] = [];
  const selectionChanges: string[][] = [];
  const table = renderTuil(
    <Table
      id="lazy-table"
      label="Lazy table"
      rows={rows}
      height={3}
      getRowKey={(row) => row.id}
      columns={[
        {
          id: "value",
          header: "Value",
          width: 8,
          cell: (row) => {
            projections += 1;
            return String(row.value);
          },
        },
      ]}
      onSelectionChange={(selected) => {
        selectionChanges.push([...selected]);
      }}
      onActivate={(_row, _column, rowIndex) => {
        activations.push(rowIndex);
      }}
    />,
  );
  await table.ready;
  expect(projections).toBeLessThanOrEqual(4);
  await clickMeasured(table, "lazy-table:cell:row-0:value");
  expect(activations).toEqual([0]);
  expect(table.app.focus.focus("lazy-table")).toBeTrue();
  await table.user.press(" ");
  await table.user.press(" ");
  expect(selectionChanges).toEqual([["row-0"], []]);
  await table.cleanup();
});

test("tables preserve falsey rows during rendering and interaction", async () => {
  const activated: Array<number | boolean | string> = [];
  const selections: string[][] = [];
  const table = renderTuil(
    <Table
      id="falsey-table"
      rows={[0, false, ""]}
      height={3}
      getRowKey={(_row, index) => String(index)}
      columns={[
        {
          id: "value",
          header: "Value",
          accessor: (row) => String(row),
          width: 8,
        },
      ]}
      onActivate={(row) => {
        activated.push(row);
      }}
      onSelectionChange={(selected) => {
        selections.push([...selected]);
      }}
    />,
  );
  await table.ready;
  expect(table.screen.frame()).toContain("0");
  expect(table.screen.frame()).toContain("false");
  expect(table.app.focus.focus("falsey-table")).toBeTrue();
  await table.user.press("enter");
  await table.user.press("space");
  await table.user.press("arrowDown");
  await table.user.press("enter");
  expect(activated).toEqual([0, false]);
  expect(selections).toEqual([["0"]]);
  await table.cleanup();
});

test("data tables render only columns fitted to the terminal viewport", async () => {
  let headerRenders = 0;
  let cellRenders = 0;
  const columns: ColumnDef<Record<string, never>>[] = Array.from(
    { length: 10_000 },
    (_value, index) => ({
      id: `column-${index}`,
      accessorFn: () => index,
      size: 4,
      header: () => {
        headerRenders += 1;
        return <Text>{`H${index}`}</Text>;
      },
      cell: () => {
        cellRenders += 1;
        return <Text>{`C${index}`}</Text>;
      },
    }),
  );
  function WideTable(): React.ReactNode {
    const table = useReactTable({
      data: [{}],
      columns,
      getCoreRowModel: getCoreRowModel(),
    });
    return (
      <DataTable
        id="wide-table"
        table={table}
        height={1}
        width={12}
        minColumnWidth={4}
        maxColumnWidth={4}
      />
    );
  }
  const rendered = renderTuil(<WideTable />);
  await rendered.ready;
  expect(headerRenders).toBeLessThanOrEqual(2);
  expect(cellRenders).toBeLessThanOrEqual(2);
  expect(rendered.screen.getAllByRole("cell")).toHaveLength(2);
  await rendered.cleanup();
});

test("data tables preserve rich header and cell render results", async () => {
  function RichTable(): React.ReactNode {
    const table = useReactTable({
      data: [
        {
          value: "UNUSED",
          text: "VISIBLE",
          array: "ARRAY UNUSED",
          iterable: "ITERABLE UNUSED",
          mixed: "MIXED UNUSED",
          empty: "EMPTY UNUSED",
        },
      ],
      columns: [
        {
          accessorKey: "value",
          size: 8,
          header: () => (
            <Box>
              <Text>BOXHEADER</Text>
            </Box>
          ),
          cell: () => <Text>CUSTOM-OVERFLOW</Text>,
        },
        {
          accessorKey: "text",
          size: 8,
          header: () => "FUNCTION HEADER",
        },
        {
          accessorKey: "array",
          size: 8,
          header: () => ["ARR", "HEADER"],
          cell: () => ["ARR", "CELL"],
        },
        {
          accessorKey: "iterable",
          size: 8,
          header: () => new Set(["SET", " HEADER"]),
          cell: () => new Set(["SET", " CELL"]),
        },
        {
          accessorKey: "mixed",
          size: 8,
          header: () => ["A", <Text key="header-node">B</Text>],
          cell: () => ["C", <Text key="cell-node">D</Text>],
        },
        {
          accessorKey: "empty",
          size: 8,
          header: () => [null, false, <Text key="header-empty-node">X</Text>],
          cell: () => [undefined, true, <Text key="cell-empty-node">Y</Text>],
        },
      ],
      getCoreRowModel: getCoreRowModel(),
    });
    return (
      <DataTable
        id="rich-table"
        table={table}
        height={1}
        width={54}
        minColumnWidth={8}
        maxColumnWidth={8}
      />
    );
  }
  const rendered = renderTuil(<RichTable />);
  await rendered.ready;
  const frame = rendered.screen.frame();
  expect(frame).toContain("BOX");
  expect(frame).toContain("CUSTOM");
  expect(frame).toContain("FUNCTIO");
  expect(frame).toContain("ARRHEAD");
  expect(frame).toContain("ARRCELL");
  expect(frame).toContain("SET HEA");
  expect(frame).toContain("SET CELL");
  const [headerLine, cellLine] = frame.split("\n");
  expect(headerLine).toContain("AB");
  expect(cellLine).toContain("CD");
  expect(headerLine).toEndWith("X");
  expect(cellLine).toEndWith("Y");
  expect(frame).not.toContain("BOXHEADER");
  expect(frame).not.toContain("FUNCTION HEADER");
  expect(frame).not.toContain("CUSTOM-OVERFLOW");
  expect(frame).not.toContain("UNUSED");
  expect(frame).not.toContain("empty");
  await rendered.cleanup();
});

test("source tables preserve mixed and empty iterable cell results", async () => {
  const view = renderTuil(
    <Table
      rows={[{ id: "one" }]}
      getRowKey={(row) => row.id}
      columns={[
        {
          id: "mixed",
          header: "Mixed",
          width: 8,
          cell: () => ["A", <Text key="mixed-node">B</Text>],
        },
        {
          id: "empty",
          header: "Empty",
          width: 8,
          cell: () => new Set([null, false]),
        },
      ]}
    />,
  );
  await view.ready;
  expect(view.screen.frame()).toContain("AB");
  await view.cleanup();
});

test("tables integrate TanStack sorting, row selection, and raw cell models", async () => {
  const dataView = renderTuil(<DataTableHarness />);
  await dataView.ready;
  expect(dataView.app.focus.focus("people-table")).toBeTrue();
  await dataView.user.press("s");
  await Bun.sleep(5);
  expect(currentSorting).toEqual([{ id: "name", desc: false }]);
  expect(visiblePersonIds).toEqual(["a", "b", "c"]);
  await dataView.user.press("space");
  expect(
    dataView.screen.getByRole("row", { name: "Row 1" }).selected,
  ).toBeTrue();
  expect(dataView.screen.getAllByRole("cell").length).toBeLessThanOrEqual(6);
  await dataView.cleanup();

  let selected: readonly string[] = [];
  function RawTable(): React.ReactNode {
    const [value, setValue] = useState<readonly string[]>([]);
    selected = value;
    return (
      <Table
        id="raw-table"
        label="Raw table"
        rows={people}
        getRowKey={(row) => row.id}
        selectedRowKeys={value}
        onSelectionChange={setValue}
        columns={[
          {
            id: "name",
            header: "Name",
            accessor: (row) => row.name,
            width: 10,
          },
          {
            id: "score",
            header: "Score",
            accessor: (row) => row.score,
            width: 6,
            align: "right",
          },
        ]}
      />
    );
  }
  const raw = renderTuil(<RawTable />);
  await raw.ready;
  expect(raw.app.focus.focus("raw-table")).toBeTrue();
  await raw.user.press("space");
  expect(selected).toEqual(["b"]);
  await raw.cleanup();
});

test("data tables honor left and right pinning and constrain JSX cells", async () => {
  function PinnedHarness(): React.ReactNode {
    const table = useReactTable({
      data: [{ a: "alpha", b: "beta", c: "gamma" }],
      columns: [
        { accessorKey: "a", header: "A", size: 4 },
        { accessorKey: "b", header: "B", size: 4 },
        { accessorKey: "c", header: "C", size: 4 },
      ],
      initialState: {
        columnPinning: { left: ["b"], right: ["c"] },
      },
      getCoreRowModel: getCoreRowModel(),
    });
    return (
      <DataTable
        id="pinned-table"
        table={table}
        width={10}
        minColumnWidth={4}
        maxColumnWidth={4}
      />
    );
  }
  const pinned = renderTuil(<PinnedHarness />);
  await pinned.ready;
  const pinnedFrame = pinned.screen.frame();
  expect(pinnedFrame.indexOf("B")).toBeLessThan(pinnedFrame.indexOf("C"));
  expect(pinnedFrame).not.toContain("A   ");
  await pinned.cleanup();

  const custom = renderTuil(
    <Table
      id="custom-cell-table"
      rows={[{ id: "one" }]}
      getRowKey={(row) => row.id}
      columns={[
        {
          id: "custom",
          header: <Text>Long custom header</Text>,
          width: 5,
          cell: () => <Text>abcdefghijklmnop</Text>,
        },
      ]}
    />,
  );
  await custom.ready;
  expect(custom.screen.frame()).not.toContain("abcdefghijklmnop");
  expect(custom.screen.frame()).not.toContain("Long custom header");
  await custom.cleanup();
});

test("tree, transfer, and JSON viewers preserve structured interaction", async () => {
  let treeSelection = "";
  const tree = renderTuil(
    <Tree
      id="tree"
      label="Files"
      defaultExpandedIds={["root"]}
      items={[
        {
          id: "root",
          label: "root",
          children: [
            { id: "readme", label: "README.md" },
            { id: "src", label: "src" },
          ],
        },
      ]}
      onSelect={(item) => {
        treeSelection = item.id;
      }}
    />,
  );
  await tree.ready;
  await clickMeasured(tree, "tree:item:readme");
  expect(treeSelection).toBe("readme");
  expect(
    tree.screen.getByRole("treeitem", { name: "README.md" }).selected,
  ).toBeTrue();
  await tree.cleanup();

  let transferred: readonly string[] = [];
  function TransferHarness(): React.ReactNode {
    const [value, setValue] = useState<readonly string[]>([]);
    transferred = value;
    return (
      <TransferList
        id="transfer"
        label="Enabled plugins"
        items={[
          { id: "git", label: "Git" },
          { id: "aws", label: "AWS" },
        ]}
        value={value}
        onValueChange={setValue}
      />
    );
  }
  const transfer = renderTuil(<TransferHarness />);
  await transfer.ready;
  expect(transfer.app.focus.focus("transfer")).toBeTrue();
  await transfer.user.press("enter");
  expect(transferred).toEqual(["git"]);
  expect(transfer.screen.frame()).toContain("Selected (1)");
  await transfer.cleanup();

  const circular: {
    token: string;
    nested: { value: number };
    self?: unknown;
  } = {
    token: "sensitive",
    nested: { value: 42 },
  };
  circular.self = circular;
  const json = renderTuil(
    <JsonViewer
      id="json"
      label="Payload"
      value={circular}
      defaultExpandedDepth={2}
      height={10}
    />,
  );
  await json.ready;
  expect(json.screen.frame()).toContain("[REDACTED]");
  expect(json.screen.frame()).toContain("[Circular]");
  expect(json.screen.getByRole("tree", { name: "Payload" })).toBeDefined();
  await json.cleanup();
});

test("JSON inspection never executes accessors before redaction", async () => {
  let getterCalls = 0;
  const value: Record<string, unknown> = { safe: true };
  Object.defineProperty(value, "token", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("getter ran");
    },
  });
  Object.defineProperty(value, "computed", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "secret";
    },
  });
  const json = renderTuil(
    <JsonViewer
      id="getter-json"
      label="Getter JSON"
      value={value}
      defaultExpandedDepth={2}
    />,
  );
  await json.ready;
  expect(getterCalls).toBe(0);
  expect(json.screen.frame()).toContain("[REDACTED]");
  expect(json.screen.frame()).toContain("[Getter]");
  await json.cleanup();
});

test("JSON flattening preserves exotic and inaccessible values", () => {
  const inaccessible = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("blocked");
      },
    },
  );
  let descriptorCalls = 0;
  const descriptorFailure = new Proxy(
    { value: true },
    {
      getOwnPropertyDescriptor(_target, key) {
        descriptorCalls += 1;
        if (descriptorCalls === 1) {
          return {
            configurable: true,
            enumerable: true,
            value: key === "value",
            writable: true,
          };
        }
        throw new Error("blocked");
      },
    },
  );
  const options = {
    expandedPaths: new Set(["$", "$/descriptor"]),
    maxDepth: 4,
    sortKeys: true,
    redactKeys: /token/i,
  };
  expect(flattenJson(Symbol("value"), options)[0]?.value).toBe(
    '"Symbol(value)"',
  );
  expect(flattenJson(inaccessible, options)).toHaveLength(1);
  expect(
    flattenJson({ descriptor: descriptorFailure }, options).some(
      (node) => node.value === '"[Inaccessible]"',
    ),
  ).toBeTrue();
});

test("log and diff viewers bound streams and expose real line changes", async () => {
  const inaccessible: LogEntry = {
    id: "old",
    get message(): string {
      throw new Error("entries before the retained tail must not be read");
    },
  };
  const log = renderTuil(
    <LogViewer
      id="logs"
      label="Build logs"
      lines={[
        inaccessible,
        ...Array.from({ length: 100 }, (_value, index) => `line ${index}`),
      ]}
      height={3}
      maxLines={20}
    />,
  );
  await log.ready;
  expect(log.app.logPipelines.values()).toHaveLength(1);
  expect(log.screen.frame()).toContain("line 99");
  expect(log.screen.frame()).not.toContain("line 0");
  expect(log.app.focus.focus("logs")).toBeTrue();
  await log.user.press("home");
  expect(log.screen.frame()).toContain("line 80");
  await log.cleanup();
  expect(log.app.logPipelines.values()).toEqual([]);

  const multiline = renderTuil(
    <LogViewer id="multiline-logs" lines={["a\nb"]} height={1} maxLines={2} />,
  );
  await multiline.ready;
  expect(multiline.screen.frame()).toContain("b");
  expect(multiline.app.focus.focus("multiline-logs")).toBeTrue();
  await multiline.user.press("home");
  expect(multiline.screen.frame()).toContain("a");
  await multiline.user.press("arrowDown");
  expect(multiline.screen.frame()).toContain("b");
  await multiline.cleanup();

  const tailOnly = renderTuil(
    <LogViewer
      id="tail-only-logs"
      lines={["unreachable", "a\nb"]}
      height={1}
      maxLines={1}
    />,
  );
  await tailOnly.ready;
  expect(tailOnly.screen.frame()).toContain("INFO b");
  expect(tailOnly.screen.frame()).not.toContain("INFO a");
  await tailOnly.cleanup();

  const lines = createLineDiff("one\ntwo\n", "one\nthree\n");
  expect(lines.map((line) => line.kind)).toEqual(["equal", "removed", "added"]);
  const diff = renderTuil(
    <DiffViewer
      id="diff"
      label="Changes"
      before={"one\ntwo\n"}
      after={"one\nthree\n"}
    />,
  );
  await diff.ready;
  expect(diff.screen.frame()).toContain("- two");
  expect(diff.screen.frame()).toContain("+ three");
  expect(diff.screen.getByRole("status", { name: "Changes" }).valueText).toBe(
    "1 additions, 1 removals",
  );
  await diff.cleanup();
});

test("split and resizable panes enforce constrained keyboard resizing", async () => {
  let splitSizes: readonly number[] = [];
  function SplitHarness(): React.ReactNode {
    const [sizes, setSizes] = useState<readonly number[]>([50, 50]);
    splitSizes = sizes;
    return (
      <SplitPane
        id="split"
        label="Workspace panes"
        panes={[
          { id: "files", content: <Text>Files</Text>, minSize: 40 },
          { id: "editor", content: <Text>Editor</Text>, minSize: 40 },
        ]}
        sizes={sizes}
        onSizesChange={setSizes}
      />
    );
  }
  const split = renderTuil(<SplitHarness />);
  await split.ready;
  await dragMeasured(split, "split:divider:files", 1);
  expect(splitSizes.map(Math.round)).toEqual([55, 45]);
  await split.user.press("arrowRight");
  expect(splitSizes.map(Math.round)).toEqual([60, 40]);
  await split.user.press("arrowRight");
  expect(splitSizes.map(Math.round)).toEqual([60, 40]);
  await split.cleanup();

  const constrained = renderTuil(
    <SplitPane
      id="constrained-split"
      testId="constrained-split"
      description="Constrained panes"
      panes={[
        { id: "left", content: <Text>Left</Text> },
        {
          id: "right",
          content: <Text>Right</Text>,
          minSize: 40,
        },
      ]}
      sizes={[90, 10]}
    />,
  );
  await constrained.ready;
  expect(constrained.screen.getByTestId("constrained-split").valueText).toBe(
    "60%, 40%",
  );
  expect(constrained.screen.getByTestId("constrained-split").description).toBe(
    "Constrained panes",
  );
  const unfocusedFirstLine = constrained.screen.frame().split("\n")[0];
  expect(constrained.app.focus.focus("constrained-split")).toBeTrue();
  await Bun.sleep(5);
  expect(constrained.screen.frame().split("\n")[0]).toBe(unfocusedFirstLine);
  expect(constrained.screen.frame()).toContain("resize");
  await constrained.cleanup();

  let extent = 10;
  function PaneHarness(): React.ReactNode {
    const [value, setValue] = useState(10);
    extent = value;
    return (
      <ResizablePane
        id="resizable"
        label="Inspector"
        extent={value}
        minSize={8}
        maxSize={12}
        onSizeChange={setValue}
      >
        <Text>Inspector</Text>
      </ResizablePane>
    );
  }
  const pane = renderTuil(<PaneHarness />);
  await pane.ready;
  expect(pane.app.focus.focus("resizable")).toBeTrue();
  await pane.user.press("end");
  expect(extent).toBe(12);
  await pane.user.press("arrowRight");
  expect(extent).toBe(12);
  await pane.cleanup();
});

test("split panes reject invalid size contracts", async () => {
  const cases = [
    [
      { id: "one", content: <Text>One</Text>, minSize: -1 },
      { id: "two", content: <Text>Two</Text> },
    ],
    [
      { id: "one", content: <Text>One</Text>, maxSize: 101 },
      { id: "two", content: <Text>Two</Text> },
    ],
    [
      { id: "one", content: <Text>One</Text>, minSize: 60, maxSize: 40 },
      { id: "two", content: <Text>Two</Text> },
    ],
    [
      { id: "one", content: <Text>One</Text>, minSize: 60 },
      { id: "two", content: <Text>Two</Text>, minSize: 60 },
    ],
  ] as const;
  for (const [index, panes] of cases.entries()) {
    const view = renderTuil(
      <ErrorBoundary fallback={(error) => <Text>{error.message}</Text>}>
        <SplitPane id={`invalid-split-${index}`} panes={panes} />
      </ErrorBoundary>,
    );
    await view.ready;
    expect(view.screen.frame()).not.toBeEmpty();
    await view.cleanup();
  }
});

test("complex data components degrade to bounded static output", async () => {
  const view = renderTuil(
    <Box flexDirection="column">
      <VirtualList
        label="Static list"
        items={[{ id: "one" }, { id: "two" }]}
        getItemKey={(item) => item.id}
        renderItem={(item) => item.id}
      />
      <Table
        label="Static table"
        rows={[{ id: "row", value: "cell" }]}
        getRowKey={(row) => row.id}
        columns={[
          {
            id: "value",
            header: "Value",
            accessor: (row) => row.value,
          },
        ]}
      />
      <DiffViewer before="old" after="new" />
      <JsonViewer value={{ ready: true }} />
      <SplitPane
        panes={[
          { id: "left", content: <Text>Left pane</Text> },
          { id: "right", content: <Text>Right pane</Text> },
        ]}
      />
    </Box>,
    {
      terminal: {
        mode: "static",
        capabilities: { interactive: false, tty: false, unicode: false },
      },
    },
  );
  await view.ready;
  expect(view.screen.frame()).toContain("one");
  expect(view.screen.frame()).toContain("cell");
  expect(view.screen.frame()).toContain("- old");
  expect(view.screen.frame()).toContain("ready: true");
  expect(view.screen.frame()).toContain("Left pane");
  expect(view.screen.frame()).toContain("Right pane");
  await view.cleanup();

  const noLogs = renderTuil(
    <LogViewer lines={["one", "two", "three"]} staticLimit={0} />,
    { terminal: { mode: "static" } },
  );
  await noLogs.ready;
  expect(noLogs.screen.frame()).not.toContain("INFO one");
  expect(noLogs.screen.frame()).not.toContain("INFO three");
  await noLogs.cleanup();
});

test("transfer lists index large selections and report static omissions", async () => {
  const items = Array.from({ length: 20_000 }, (_value, index) => ({
    id: `item-${index}`,
    label: `Item ${index}`,
  }));
  const started = performance.now();
  const transfer = renderTuil(
    <TransferList
      items={items}
      defaultValue={items.map((item) => item.id)}
      height={3}
      testId="large-transfer"
    />,
    { terminal: { mode: "static" } },
  );
  await transfer.ready;
  expect(performance.now() - started).toBeLessThan(500);
  expect(transfer.screen.frame()).toContain("additional items omitted");
  expect(transfer.screen.getByTestId("large-transfer")).toBeDefined();
  await transfer.cleanup();
});

test("structured viewers cover complete keyboard navigation contracts", async () => {
  const expansionChanges: string[][] = [];
  const selections: string[] = [];
  const tree = renderTuil(
    <Tree
      id="keyboard-tree"
      height={2}
      autoFocus
      defaultExpandedIds={["root"]}
      items={[
        {
          id: "root",
          label: "Root",
          children: [
            {
              id: "branch",
              label: "Branch",
              children: [{ id: "leaf", label: "Leaf" }],
            },
            { id: "disabled", label: "Disabled", disabled: true },
          ],
        },
      ]}
      onExpandedChange={(ids) => {
        expansionChanges.push([...ids]);
      }}
      onSelect={(item) => {
        selections.push(item.id);
      }}
    />,
  );
  await tree.ready;
  await tree.user.press("arrowLeft");
  await tree.user.press("arrowRight");
  await tree.user.press("arrowRight");
  await tree.user.press("enter");
  await tree.user.press("arrowRight");
  await tree.user.press("arrowDown");
  await tree.user.press("pageDown");
  await tree.user.press("pageUp");
  await tree.user.press("end");
  await tree.user.press("enter");
  await tree.user.press("home");
  await tree.user.press("space");
  await tree.user.press("arrowDown");
  await tree.user.press("arrowLeft");
  await tree.user.press("unhandled");
  expect(expansionChanges.length).toBeGreaterThanOrEqual(3);
  expect(selections).toContain("root");
  await tree.cleanup();

  const jsonChanges: string[][] = [];
  const json = renderTuil(
    <JsonViewer
      id="keyboard-json"
      value={{
        alpha: { nested: true },
        beta: [1, 2],
        empty: {},
        nil: null,
        big: 1n,
        missing: undefined,
      }}
      defaultExpandedDepth={2}
      height={2}
      autoFocus
      onExpandedChange={(paths) => {
        jsonChanges.push([...paths]);
      }}
    />,
  );
  await json.ready;
  await json.user.press("arrowLeft");
  await json.user.press("arrowRight");
  await json.user.press("arrowDown");
  await json.user.press("enter");
  await json.user.press("arrowRight");
  await json.user.press("arrowLeft");
  await json.user.press("pageDown");
  await json.user.press("pageUp");
  await json.user.press("end");
  await json.user.press("home");
  await json.user.press("arrowUp");
  await json.user.press("arrowRight");
  await json.user.press("arrowDown");
  await json.user.press("arrowRight");
  await json.user.press("arrowDown");
  await json.user.press("arrowLeft");
  await json.user.press("space");
  await json.user.press("unhandled");
  expect(jsonChanges.length).toBeGreaterThan(0);
  await json.cleanup();

  const diff = renderTuil(
    <DiffViewer
      id="keyboard-diff"
      before={"zero\none\ntwo\nthree\nfour"}
      after={"zero\none changed\ntwo\nthree changed\nfour"}
      context={1}
      height={2}
      autoFocus
    />,
  );
  await diff.ready;
  for (const key of [
    "arrowDown",
    "arrowUp",
    "pageDown",
    "pageUp",
    "end",
    "home",
    "unhandled",
  ]) {
    await diff.user.press(key);
  }
  expect(diff.screen.frame()).toContain("zero");
  await diff.cleanup();

  let transferred: readonly string[] = ["two"];
  function KeyboardTransfer(): React.ReactNode {
    const [value, setValue] = useState<readonly string[]>(["two"]);
    transferred = value;
    return (
      <TransferList
        id="keyboard-transfer"
        items={[
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
          { id: "three", label: "Three", disabled: true },
        ]}
        value={value}
        onValueChange={setValue}
        height={1}
        autoFocus
      />
    );
  }
  const transfer = renderTuil(<KeyboardTransfer />);
  await transfer.ready;
  for (const key of [
    "arrowDown",
    "arrowUp",
    "pageDown",
    "pageUp",
    "end",
    "home",
    "arrowRight",
    "enter",
    "arrowLeft",
    "a",
    "unhandled",
  ]) {
    await transfer.user.press(key);
  }
  expect(transferred).toContain("one");
  await transfer.cleanup();

  const vertical = renderTuil(
    <SplitPane
      id="vertical-split"
      orientation="vertical"
      defaultSizes={[0, Number.NaN, 0]}
      panes={[
        { id: "one", content: <Text>One</Text>, maxSize: 80 },
        { id: "two", content: <Text>Two</Text> },
        { id: "three", content: <Text>Three</Text> },
      ]}
      autoFocus
    />,
  );
  await vertical.ready;
  for (const key of [
    "arrowDown",
    "arrowUp",
    "]",
    "[",
    "pageDown",
    "pageUp",
    "end",
    "home",
    "unhandled",
  ]) {
    await vertical.user.press(key);
  }
  await vertical.cleanup();
});

test("data viewers cover bounded navigation, empty, and static overflow states", async () => {
  const tableActions: string[] = [];
  const table = renderTuil(
    <Table
      id="keyboard-table"
      focusMode="cell"
      height={2}
      width={12}
      rows={[
        { id: "one", left: "A", right: "B" },
        { id: "two", left: "C", right: "D" },
        { id: "three", left: "E", right: "F" },
      ]}
      getRowKey={(row) => row.id}
      columns={[
        { id: "left", header: "Left", accessor: (row) => row.left, width: 6 },
        {
          id: "right",
          header: "Right",
          accessor: (row) => row.right,
          width: 6,
        },
      ]}
      onActivate={(_row, column) => {
        tableActions.push(`activate:${column.id}`);
      }}
      onSelectionChange={(keys) => {
        tableActions.push(`select:${keys.join(",")}`);
      }}
    />,
  );
  await table.ready;
  expect(table.app.focus.focus("keyboard-table")).toBeTrue();
  for (const key of [
    "arrowDown",
    "arrowUp",
    "pageDown",
    "pageUp",
    "arrowRight",
    "arrowLeft",
    "end",
    "home",
    "enter",
    "space",
    "s",
    "unhandled",
  ]) {
    await table.user.press(key);
  }
  expect(
    tableActions.some((action) => action.startsWith("activate:")),
  ).toBeTrue();
  expect(
    tableActions.some((action) => action.startsWith("select:")),
  ).toBeTrue();
  await table.cleanup();

  const activeIndexes: number[] = [];
  const list = renderTuil(
    <VirtualList
      id="keyboard-list"
      autoFocus
      height={2}
      items={["one", "two", "three", "four"]}
      getItemKey={(item) => item}
      renderItem={(item) => item}
      onActiveIndexChange={(index) => {
        activeIndexes.push(index);
      }}
    />,
  );
  await list.ready;
  for (const key of [
    "arrowDown",
    "arrowUp",
    "pageDown",
    "pageUp",
    "end",
    "home",
    "enter",
    "unhandled",
  ]) {
    await list.user.press(key);
  }
  expect(activeIndexes.length).toBeGreaterThan(0);
  await list.cleanup();

  const following: boolean[] = [];
  const logs = renderTuil(
    <LogViewer
      id="keyboard-logs"
      autoFocus
      height={2}
      width={50}
      showTimestamp
      lines={[
        {
          id: "debug",
          level: "debug",
          message: "debug",
          timestamp: new Date("2026-01-01T00:00:00Z"),
        },
        { id: "warning", level: "warning", message: "warning", timestamp: 2 },
        { id: "error", level: "error", message: "error" },
        { id: "info", level: "info", message: "info" },
      ]}
      onFollowChange={(value) => {
        following.push(value);
      }}
    />,
  );
  await logs.ready;
  for (const key of [
    "arrowUp",
    "arrowDown",
    "pageUp",
    "pageDown",
    "home",
    "end",
    "space",
    "unhandled",
  ]) {
    await logs.user.press(key);
  }
  expect(following).toEqual([false]);
  await logs.cleanup();

  const paneSizes: number[] = [];
  const pane = renderTuil(
    <ResizablePane
      id="keyboard-pane"
      autoFocus
      defaultExtent={10}
      minSize={8}
      maxSize={12}
      onSizeChange={(size) => {
        paneSizes.push(size);
      }}
    >
      <Text>Pane</Text>
    </ResizablePane>,
  );
  await pane.ready;
  for (const key of [
    "arrowLeft",
    "arrowRight",
    "-",
    "+",
    "home",
    "end",
    "unhandled",
  ]) {
    await pane.user.press(key);
  }
  expect(paneSizes).toContain(8);
  expect(paneSizes).toContain(12);
  await pane.cleanup();

  const states = renderTuil(
    <Box flexDirection="column">
      <Table
        rows={[]}
        columns={[]}
        getRowKey={(_row, index) => String(index)}
      />
      <VirtualList
        items={[]}
        getItemKey={(item) => String(item)}
        renderItem={(item) => String(item)}
      />
      <Tree items={[]} />
      <LogViewer lines={[]} />
    </Box>,
    { terminal: { mode: "static" } },
  );
  await states.ready;
  expect(states.screen.frame()).toContain("No rows");
  expect(states.screen.frame()).toContain("No items");
  expect(states.screen.frame()).toContain("No log entries");
  await states.cleanup();

  const overflow = renderTuil(
    <Box flexDirection="column">
      <Table
        staticLimit={1}
        rows={[{ id: "1" }, { id: "2" }, { id: "3" }]}
        columns={[{ id: "id", header: "ID", accessor: (row) => row.id }]}
        getRowKey={(row) => row.id}
      />
      <VirtualList
        staticLimit={1}
        items={["one", "two", "three"]}
        getItemKey={(item) => item}
        renderItem={(item) => item}
      />
      <Tree
        staticLimit={1}
        items={[
          { id: "one", label: "One" },
          { id: "two", label: "Two" },
        ]}
      />
      <JsonViewer
        value={{ one: 1, two: 2 }}
        defaultExpandedDepth={1}
        staticLimit={1}
      />
    </Box>,
    { terminal: { mode: "static" } },
  );
  await overflow.ready;
  expect(overflow.screen.frame()).toContain("additional");
  await overflow.cleanup();

  const removeAllChanges: readonly string[][] = [];
  const removeAll = renderTuil(
    <TransferList
      id="remove-all-transfer"
      autoFocus
      items={[
        { id: "one", label: "One" },
        { id: "two", label: "Two" },
      ]}
      defaultValue={["one", "two"]}
      onValueChange={(value) => {
        (removeAllChanges as string[][]).push([...value]);
      }}
    />,
  );
  await removeAll.ready;
  await removeAll.user.press("arrowRight");
  await removeAll.user.press("a");
  expect(removeAllChanges.at(-1)).toEqual([]);
  await removeAll.cleanup();

  const parentNavigation = renderTuil(
    <Tree
      id="parent-navigation-tree"
      autoFocus
      defaultExpandedIds={["root"]}
      items={[
        {
          id: "root",
          label: "Root",
          children: [{ id: "child", label: "Child" }],
        },
      ]}
    />,
  );
  await parentNavigation.ready;
  await parentNavigation.user.press("arrowRight");
  await parentNavigation.user.press("arrowLeft");
  await parentNavigation.user.press("arrowUp");
  expect(
    parentNavigation.screen.getByRole("treeitem", { name: "Root" }),
  ).toBeDefined();
  await parentNavigation.cleanup();
});
