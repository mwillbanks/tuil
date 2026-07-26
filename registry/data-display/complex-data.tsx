import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  TerminalSemanticNode as SemanticNode,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import {
  fitTerminalText,
  getVisibleTerminalIndexes,
  useTerminalVirtualizer,
} from "@mwillbanks/tuil-virtual";
import {
  createCell,
  flexRender,
  type Table as TanStackTable,
} from "@tanstack/react-table";
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  Fragment,
  isValidElement,
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";

export { fitTerminalText } from "@mwillbanks/tuil-virtual";

function semanticValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "[content]";
}

type TerminalRenderer = (context: unknown) => ReactNode;

interface TerminalTemplate {
  readonly renderer: TerminalRenderer;
  readonly context: unknown;
}

interface TerminalRendererProps {
  readonly context: unknown;
  readonly renderPrimitive: (value: unknown) => ReactNode;
  readonly renderInlinePrimitive: (value: unknown) => ReactNode;
}

const terminalRenderers = new WeakMap<
  object,
  (props: TerminalRendererProps) => ReactNode
>();

type NormalizedTerminalResult =
  | { readonly key: string; readonly kind: "empty" }
  | { readonly key: string; readonly kind: "primitive"; readonly text: string }
  | { readonly key: string; readonly kind: "node"; readonly node: ReactNode };

function normalizeTerminalResult(
  value: ReactNode,
  renderPrimitive: (value: unknown) => ReactNode,
  renderInlinePrimitive: (value: unknown) => ReactNode,
  path = "root",
): NormalizedTerminalResult {
  if (value === null || value === undefined || typeof value === "boolean") {
    return { key: path, kind: "empty" };
  }
  if (isValidElement(value)) {
    return { key: path, kind: "node", node: value };
  }
  if (
    typeof value === "object" &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function"
  ) {
    const children = [...value].map((child, index) =>
      normalizeTerminalResult(
        child,
        renderPrimitive,
        renderInlinePrimitive,
        `${path}:${index}`,
      ),
    );
    const renderedChildren = children.filter((child) => child.kind !== "empty");
    if (renderedChildren.length === 0) {
      return { key: path, kind: "empty" };
    }
    if (renderedChildren.every((child) => child.kind === "primitive")) {
      return {
        key: path,
        kind: "primitive",
        text: renderedChildren
          .map((child) => (child.kind === "primitive" ? child.text : ""))
          .join(""),
      };
    }
    return {
      key: path,
      kind: "node",
      node: (
        <>
          {renderedChildren.map((child) => (
            <Fragment key={child.key}>
              {child.kind === "primitive"
                ? renderInlinePrimitive(child.text)
                : child.node}
            </Fragment>
          ))}
        </>
      ),
    };
  }
  return { key: path, kind: "primitive", text: semanticValue(value) };
}

function renderTerminalResult(
  value: ReactNode,
  renderPrimitive: (value: unknown) => ReactNode,
  renderInlinePrimitive = renderPrimitive,
): ReactNode {
  const normalized = normalizeTerminalResult(
    value,
    renderPrimitive,
    renderInlinePrimitive,
  );
  if (normalized.kind === "empty") return null;
  return normalized.kind === "primitive"
    ? renderPrimitive(normalized.text)
    : normalized.node;
}

function resolveTerminalRenderer(
  renderer: TerminalRenderer,
): (props: TerminalRendererProps) => ReactNode {
  const cached = terminalRenderers.get(renderer);
  if (cached) return cached;
  const ResolvedRenderer = ({
    context,
    renderPrimitive,
    renderInlinePrimitive,
  }: TerminalRendererProps): ReactNode => {
    const result = renderer(context);
    return renderTerminalResult(result, renderPrimitive, renderInlinePrimitive);
  };
  terminalRenderers.set(renderer, ResolvedRenderer);
  return ResolvedRenderer;
}

function TerminalTemplateResult({
  template,
  renderPrimitive,
  renderInlinePrimitive,
}: {
  readonly template: TerminalTemplate;
  readonly renderPrimitive: (value: unknown) => ReactNode;
  readonly renderInlinePrimitive: (value: unknown) => ReactNode;
}): ReactNode {
  const Renderer = resolveTerminalRenderer(template.renderer);
  return (
    <Renderer
      context={template.context}
      renderPrimitive={renderPrimitive}
      renderInlinePrimitive={renderInlinePrimitive}
    />
  );
}

export interface TableColumn<TData> {
  readonly id: string;
  readonly header: ReactNode;
  readonly accessor?: (row: TData, index: number) => unknown;
  readonly cell?: (row: TData, index: number) => ReactNode;
  readonly width?: number;
  readonly align?: "left" | "center" | "right";
  readonly hidden?: boolean;
}

type TableSlots = {
  root: BoxProps;
  header: BoxProps;
  headerCell: TextProps;
  body: BoxProps;
  row: BoxProps;
  cell: TextProps;
  overflow: TextProps;
  empty: TextProps;
};

interface TerminalColumn {
  readonly id: string;
  readonly header: ReactNode;
  readonly headerText: string;
  readonly headerTemplate?: TerminalTemplate;
  readonly width: number;
  readonly align: "left" | "center" | "right";
}

interface TerminalCell {
  readonly content: ReactNode;
  readonly template?: TerminalTemplate;
  readonly text: string;
}

interface TerminalRow {
  readonly id: string;
  readonly cells: ReadonlyMap<string, TerminalCell>;
  readonly selected?: boolean;
}

interface TerminalTableViewProps
  extends CommonComponentProps,
    SlottedComponentProps<
      TableSlots,
      {
        readonly focused: boolean;
        readonly activeRow: number;
        readonly activeColumn: number;
      }
    > {
  readonly columns: readonly TerminalColumn[];
  readonly rowCount: number;
  readonly getRow: (
    index: number,
    columns: readonly TerminalColumn[],
  ) => TerminalRow | undefined;
  readonly height: number;
  readonly width: number;
  readonly focusMode: "row" | "cell";
  readonly frozenColumns: number;
  readonly rightFrozenColumns: number;
  readonly staticLimit: number;
  readonly onActivate?: (row: number, column: number) => void | Promise<void>;
  readonly onToggleSelection?: (row: number) => void | Promise<void>;
  readonly onSortColumn?: (column: number) => void | Promise<void>;
}

function fitColumns(
  columns: readonly TerminalColumn[],
  width: number,
  offset: number,
  frozenColumns: number,
  rightFrozenColumns: number,
): readonly TerminalColumn[] {
  const frozen = columns.slice(0, Math.max(0, frozenColumns));
  const rightStart = Math.max(
    frozen.length,
    columns.length - Math.max(0, rightFrozenColumns),
  );
  const right = columns.slice(rightStart);
  const scrolling = columns.slice(frozen.length + offset, rightStart);
  const result = [...frozen];
  let used = [...frozen, ...right].reduce(
    (total, column) => total + column.width + 1,
    0,
  );
  for (const column of scrolling) {
    if (used + column.width + 1 > width) break;
    result.push(column);
    used += column.width + 1;
  }
  result.push(...right);
  if (result.length === 0 && columns[0]) return [columns[0]];
  return result;
}

function TerminalTableView({
  columns,
  rowCount,
  getRow,
  height,
  width,
  focusMode,
  frozenColumns,
  rightFrozenColumns,
  staticLimit,
  onActivate,
  onToggleSelection,
  onSortColumn,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  ...props
}: TerminalTableViewProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const [activeRow, setActiveRow] = useState(0);
  const [activeColumn, setActiveColumn] = useState(0);
  const [rowOffset, setRowOffset] = useState(0);
  const [columnOffset, setColumnOffset] = useState(0);
  const { focused } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive,
        hidden: false,
        role: "table" as const,
        label: props.label ?? "Table",
      }),
      [disabled, id, interactive, props.label],
    ),
  );
  const moveRow = useCallback(
    (next: number) => {
      const value = Math.min(rowCount - 1, Math.max(0, next));
      setActiveRow(Math.max(0, value));
      if (value < rowOffset) setRowOffset(value);
      if (value >= rowOffset + height) setRowOffset(value - height + 1);
    },
    [height, rowCount, rowOffset],
  );
  const moveColumn = useCallback(
    (next: number) => {
      const value = Math.min(columns.length - 1, Math.max(0, next));
      setActiveColumn(Math.max(0, value));
      if (
        value >= frozenColumns &&
        value < columns.length - rightFrozenColumns
      ) {
        const scrollIndex = value - frozenColumns;
        if (scrollIndex < columnOffset) setColumnOffset(scrollIndex);
        const visible = fitColumns(
          columns,
          width,
          columnOffset,
          frozenColumns,
          rightFrozenColumns,
        );
        if (!visible.some((column) => column.id === columns[value]?.id)) {
          setColumnOffset(scrollIndex);
        }
      }
    },
    [columnOffset, columns, frozenColumns, rightFrozenColumns, width],
  );
  useTerminalInput(
    async (input, key) => {
      if (key.upArrow) {
        moveRow(activeRow - 1);
        return true;
      }
      if (key.downArrow) {
        moveRow(activeRow + 1);
        return true;
      }
      if (key.pageUp) {
        moveRow(activeRow - Math.max(1, height));
        return true;
      }
      if (key.pageDown) {
        moveRow(activeRow + Math.max(1, height));
        return true;
      }
      if (focusMode === "cell" && key.leftArrow) {
        moveColumn(activeColumn - 1);
        return true;
      }
      if (focusMode === "cell" && key.rightArrow) {
        moveColumn(activeColumn + 1);
        return true;
      }
      if (key.home) {
        if (key.ctrl) moveRow(0);
        else moveColumn(0);
        return true;
      }
      if (key.end) {
        if (key.ctrl) moveRow(rowCount - 1);
        else moveColumn(columns.length - 1);
        return true;
      }
      if (key.return && !readOnly) {
        await onActivate?.(activeRow, activeColumn);
        return true;
      }
      if (input === " " && !readOnly) {
        await onToggleSelection?.(activeRow);
        return true;
      }
      if (input.toLowerCase() === "s" && !readOnly) {
        await onSortColumn?.(activeColumn);
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_550 },
  );
  const range = useTerminalVirtualizer({
    count: rowCount,
    viewportSize: Math.max(1, height),
    scrollOffset: rowOffset,
    overscan: 1,
  });
  const rowIndexes = interactive
    ? getVisibleTerminalIndexes(range)
    : Array.from(
        { length: Math.min(rowCount, Math.max(0, staticLimit)) },
        (_value, index) => index,
      );
  const projectionIndexes = interactive ? range.indexes : rowIndexes;
  const visibleColumns = interactive
    ? fitColumns(
        columns,
        width,
        columnOffset,
        frozenColumns,
        rightFrozenColumns,
      )
    : columns;
  const projectedRows = new Map(
    projectionIndexes.flatMap((index) => {
      const row = getRow(index, visibleColumns);
      return row ? ([[index, row]] as const) : [];
    }),
  );
  const state = { focused, activeRow, activeColumn };
  const Root = slots?.root ?? Box;
  const Header = slots?.header ?? Box;
  const HeaderCell = slots?.headerCell ?? Text;
  const Body = slots?.body ?? Box;
  const Row = slots?.row ?? Box;
  const Cell = slots?.cell ?? Text;
  const Overflow = slots?.overflow ?? Text;
  const Empty = slots?.empty ?? Text;
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticNode
        id={id}
        role="table"
        label={props.label ?? "Table"}
        valueText={`${rowCount} rows by ${columns.length} columns`}
        metadata={{ ...props, disabled, readOnly }}
      />
      <Header
        flexDirection="row"
        {...resolveSlotProps(slotProps?.header, state, theme)}
      >
        {visibleColumns.map((column) => {
          const renderPrimitive = (value: unknown) => (
            <HeaderCell
              bold
              underline={focused && columns[activeColumn]?.id === column.id}
              wrap="truncate-end"
              {...resolveSlotProps(slotProps?.headerCell, state, theme)}
            >
              {fitTerminalText(
                semanticValue(value),
                column.width,
                column.align,
              )}
            </HeaderCell>
          );
          const renderInlinePrimitive = (value: unknown) => (
            <HeaderCell
              bold
              underline={focused && columns[activeColumn]?.id === column.id}
              wrap="truncate-end"
              {...resolveSlotProps(slotProps?.headerCell, state, theme)}
            >
              {semanticValue(value)}
            </HeaderCell>
          );
          return (
            <Box
              key={column.id}
              width={column.width}
              height={1}
              overflow="hidden"
            >
              {column.headerTemplate ? (
                <TerminalTemplateResult
                  template={column.headerTemplate}
                  renderPrimitive={renderPrimitive}
                  renderInlinePrimitive={renderInlinePrimitive}
                />
              ) : (
                renderTerminalResult(
                  column.header,
                  renderPrimitive,
                  renderInlinePrimitive,
                )
              )}
            </Box>
          );
        })}
      </Header>
      {rowCount === 0 ? (
        <Empty dimColor {...resolveSlotProps(slotProps?.empty, state, theme)}>
          No rows
        </Empty>
      ) : (
        <Body
          flexDirection="column"
          height={interactive ? Math.max(1, height) : undefined}
          overflow="hidden"
          {...resolveSlotProps(slotProps?.body, state, theme)}
        >
          {rowIndexes.map((rowIndex) => {
            const row = projectedRows.get(rowIndex);
            if (!row) return null;
            const active = focused && rowIndex === activeRow;
            return (
              <Row
                key={row.id}
                flexDirection="row"
                {...resolveSlotProps(slotProps?.row, state, theme)}
              >
                <SemanticNode
                  id={`${id}:row:${row.id}`}
                  role="row"
                  label={`Row ${rowIndex + 1}`}
                  selected={row.selected}
                />
                {visibleColumns.map((column) => {
                  const cell = row.cells.get(column.id);
                  const cellActive =
                    active &&
                    (focusMode === "row" ||
                      columns[activeColumn]?.id === column.id);
                  return (
                    <Box
                      key={`${row.id}:${column.id}`}
                      width={column.width}
                      height={1}
                      overflow="hidden"
                    >
                      <SemanticNode
                        id={`${id}:cell:${row.id}:${column.id}`}
                        role="cell"
                        label={`${column.headerText}: ${cell?.text ?? ""}`}
                        selected={cellActive}
                      />
                      {cell?.template ? (
                        <TerminalTemplateResult
                          template={cell.template}
                          renderPrimitive={(value) => (
                            <Cell
                              inverse={cellActive}
                              bold={cellActive}
                              wrap="truncate-end"
                              {...resolveSlotProps(
                                slotProps?.cell,
                                state,
                                theme,
                              )}
                            >
                              {fitTerminalText(
                                semanticValue(value),
                                column.width,
                                column.align,
                              )}
                            </Cell>
                          )}
                          renderInlinePrimitive={(value) => (
                            <Cell
                              inverse={cellActive}
                              bold={cellActive}
                              wrap="truncate-end"
                              {...resolveSlotProps(
                                slotProps?.cell,
                                state,
                                theme,
                              )}
                            >
                              {semanticValue(value)}
                            </Cell>
                          )}
                        />
                      ) : (
                        renderTerminalResult(
                          cell?.content ?? cell?.text ?? "",
                          (value) => (
                            <Cell
                              inverse={cellActive}
                              bold={cellActive}
                              wrap="truncate-end"
                              {...resolveSlotProps(
                                slotProps?.cell,
                                state,
                                theme,
                              )}
                            >
                              {fitTerminalText(
                                semanticValue(value) || cell?.text || "",
                                column.width,
                                column.align,
                              )}
                            </Cell>
                          ),
                          (value) => (
                            <Cell
                              inverse={cellActive}
                              bold={cellActive}
                              wrap="truncate-end"
                              {...resolveSlotProps(
                                slotProps?.cell,
                                state,
                                theme,
                              )}
                            >
                              {semanticValue(value)}
                            </Cell>
                          ),
                        )
                      )}
                    </Box>
                  );
                })}
              </Row>
            );
          })}
        </Body>
      )}
      {interactive && range.after > 0 ? (
        <Overflow
          dimColor
          {...resolveSlotProps(slotProps?.overflow, state, theme)}
        >
          ↓ {rowCount - range.endIndex - 1} more rows
        </Overflow>
      ) : null}
      {!interactive && rowCount > rowIndexes.length ? (
        <Overflow
          dimColor
          {...resolveSlotProps(slotProps?.overflow, state, theme)}
        >
          … {rowCount - rowIndexes.length} additional rows omitted
        </Overflow>
      ) : null}
    </Root>
  );
}

export interface TableProps<TData>
  extends CommonComponentProps,
    SlottedComponentProps<TableSlots> {
  readonly columns: readonly TableColumn<TData>[];
  readonly rows: readonly TData[];
  readonly getRowKey: (row: TData, index: number) => string;
  readonly height?: number;
  readonly width?: number;
  readonly focusMode?: "row" | "cell";
  readonly frozenColumns?: number;
  readonly selectedRowKeys?: readonly string[];
  readonly defaultSelectedRowKeys?: readonly string[];
  readonly onActivate?: (
    row: TData,
    column: TableColumn<TData>,
    rowIndex: number,
  ) => void | Promise<void>;
  readonly onSelectionChange?: (
    selected: readonly string[],
  ) => void | Promise<void>;
  readonly staticLimit?: number;
}

export function Table<TData>({
  columns,
  rows,
  getRowKey,
  selectedRowKeys,
  defaultSelectedRowKeys = [],
  onActivate,
  onSelectionChange,
  height = 10,
  width = 80,
  focusMode = "row",
  frozenColumns = 0,
  staticLimit = 1_000,
  ...props
}: TableProps<TData>): ReactNode {
  const [internalSelectedRowKeys, setInternalSelectedRowKeys] = useState<
    readonly string[]
  >(defaultSelectedRowKeys);
  const resolvedSelectedRowKeys = selectedRowKeys ?? internalSelectedRowKeys;
  const visibleColumns = columns.filter((column) => !column.hidden);
  const terminalColumns: TerminalColumn[] = visibleColumns.map((column) => ({
    id: column.id,
    header: column.header,
    headerText: semanticValue(column.header) || column.id,
    width: Math.max(3, column.width ?? 16),
    align: column.align ?? "left",
  }));
  const columnById = new Map(
    visibleColumns.map((column) => [column.id, column] as const),
  );
  const selected = new Set(resolvedSelectedRowKeys);
  return (
    <TerminalTableView
      {...props}
      columns={terminalColumns}
      rowCount={rows.length}
      getRow={(rowIndex, projectedColumns) => {
        if (rowIndex < 0 || rowIndex >= rows.length) return undefined;
        const row = rows[rowIndex] as TData;
        const rowKey = getRowKey(row, rowIndex);
        return {
          id: rowKey,
          selected: selected.has(rowKey),
          cells: new Map(
            projectedColumns.flatMap((projectedColumn) => {
              const column = columnById.get(projectedColumn.id);
              if (!column) return [];
              const raw = column.accessor?.(row, rowIndex);
              const content =
                column.cell?.(row, rowIndex) ?? semanticValue(raw);
              return [
                [
                  column.id,
                  {
                    content,
                    template: undefined,
                    text: semanticValue(
                      typeof content === "string" || typeof content === "number"
                        ? content
                        : raw,
                    ),
                  },
                ] as const,
              ];
            }),
          ),
        };
      }}
      height={height}
      width={width}
      focusMode={focusMode}
      frozenColumns={frozenColumns}
      rightFrozenColumns={0}
      staticLimit={staticLimit}
      onActivate={async (rowIndex, columnIndex) => {
        if (rowIndex < 0 || rowIndex >= rows.length) return;
        const row = rows[rowIndex] as TData;
        const column = visibleColumns[columnIndex];
        if (column) await onActivate?.(row, column, rowIndex);
      }}
      onToggleSelection={async (rowIndex) => {
        if (rowIndex < 0 || rowIndex >= rows.length) return;
        const row = rows[rowIndex] as TData;
        const key = getRowKey(row, rowIndex);
        const next = selected.has(key)
          ? resolvedSelectedRowKeys.filter((candidate) => candidate !== key)
          : [...resolvedSelectedRowKeys, key];
        if (selectedRowKeys === undefined) {
          setInternalSelectedRowKeys(Object.freeze(next));
        }
        await onSelectionChange?.(Object.freeze(next));
      }}
    />
  );
}

export interface DataTableProps<TData>
  extends CommonComponentProps,
    SlottedComponentProps<TableSlots> {
  readonly table: TanStackTable<TData>;
  readonly height?: number;
  readonly width?: number;
  readonly focusMode?: "row" | "cell";
  readonly frozenColumns?: number;
  readonly minColumnWidth?: number;
  readonly maxColumnWidth?: number;
  readonly staticLimit?: number;
  readonly onActivate?: (row: TData, columnId: string) => void | Promise<void>;
}

export function DataTable<TData>({
  table,
  height = 10,
  width = 80,
  focusMode = "cell",
  frozenColumns,
  minColumnWidth = 4,
  maxColumnWidth = 40,
  staticLimit = 1_000,
  onActivate,
  ...props
}: DataTableProps<TData>): ReactNode {
  const leftColumns = table.getLeftVisibleLeafColumns();
  const centerColumns = table.getCenterVisibleLeafColumns();
  const rightColumns = table.getRightVisibleLeafColumns();
  const columns = [...leftColumns, ...centerColumns, ...rightColumns];
  const defaultColumnDefinition = table._getDefaultColumnDef();
  const headersByColumn = new Map(
    table.getFlatHeaders().map((header) => [header.column.id, header] as const),
  );
  const terminalColumns: TerminalColumn[] = columns.map((column) => {
    const headerDefinition = column.columnDef.header;
    const headerIsCustomFunction =
      typeof headerDefinition === "function" &&
      headerDefinition !== defaultColumnDefinition.header;
    const header = headersByColumn.get(column.id);
    return {
      id: column.id,
      header:
        typeof headerDefinition === "string" ? headerDefinition : column.id,
      headerText:
        typeof headerDefinition === "string" ? headerDefinition : column.id,
      headerTemplate:
        headerIsCustomFunction && header && !header.isPlaceholder
          ? {
              renderer: headerDefinition as TerminalRenderer,
              context: header.getContext(),
            }
          : undefined,
      width: Math.min(
        Math.max(minColumnWidth, column.getSize()),
        maxColumnWidth,
      ),
      align:
        (
          column.columnDef.meta as
            | { align?: TerminalColumn["align"] }
            | undefined
        )?.align ?? "left",
    };
  });
  const columnById = new Map(
    columns.map((column) => [column.id, column] as const),
  );
  const modelRows = table.getRowModel().rows;
  const pinnedCount = frozenColumns ?? leftColumns.length;
  return (
    <TerminalTableView
      {...props}
      columns={terminalColumns}
      rowCount={modelRows.length}
      getRow={(rowIndex, projectedColumns) => {
        const row = modelRows[rowIndex];
        if (!row) return undefined;
        return {
          id: row.id,
          selected: row.getIsSelected(),
          cells: new Map(
            projectedColumns.flatMap((projectedColumn) => {
              const column = columnById.get(projectedColumn.id);
              if (!column) return [];
              const cell = createCell(table, row, column, column.id);
              const raw = cell.getValue();
              const renderer = cell.column.columnDef.cell;
              const customRenderer =
                typeof renderer === "function" &&
                renderer !== defaultColumnDefinition.cell;
              const content =
                customRenderer || renderer === defaultColumnDefinition.cell
                  ? semanticValue(raw)
                  : flexRender(renderer, cell.getContext());
              return [
                [
                  cell.column.id,
                  {
                    content,
                    template: customRenderer
                      ? {
                          renderer: renderer as TerminalRenderer,
                          context: cell.getContext(),
                        }
                      : undefined,
                    text: semanticValue(
                      typeof content === "string" || typeof content === "number"
                        ? content
                        : raw,
                    ),
                  },
                ] as const,
              ];
            }),
          ),
        };
      }}
      height={height}
      width={width}
      focusMode={focusMode}
      frozenColumns={pinnedCount}
      rightFrozenColumns={rightColumns.length}
      staticLimit={staticLimit}
      onActivate={async (rowIndex, columnIndex) => {
        const row = modelRows[rowIndex];
        const column = columns[columnIndex];
        if (row && column) await onActivate?.(row.original, column.id);
      }}
      onToggleSelection={(rowIndex) => {
        const row = modelRows[rowIndex];
        if (row?.getCanSelect()) row.toggleSelected();
      }}
      onSortColumn={(columnIndex) => {
        const column = columns[columnIndex];
        if (column?.getCanSort()) column.toggleSorting();
      }}
    />
  );
}
