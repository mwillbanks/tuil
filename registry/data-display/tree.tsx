import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  escapeTerminalControlCharacters,
  Box as SemanticBox,
  usePointerEvents,
  useTerminalInput,
  useTerminalScrollArea,
} from "@mwillbanks/tuil-ink";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import {
  getVisibleTerminalIndexes,
  useTerminalVirtualizer,
} from "@mwillbanks/tuil-virtual";
import { Box, type BoxProps, type Key, Text, type TextProps } from "ink";
import {
  type ElementType,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

export interface TreeItem<TData = unknown> {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly data?: TData;
  readonly disabled?: boolean;
  readonly children?: readonly TreeItem<TData>[];
}

interface FlatTreeItem<TData> {
  readonly item: TreeItem<TData>;
  readonly depth: number;
  readonly parentId?: string;
}

function flattenTree<TData>(
  items: readonly TreeItem<TData>[],
  expanded: ReadonlySet<string>,
  depth = 0,
  parentId?: string,
): readonly FlatTreeItem<TData>[] {
  const result: FlatTreeItem<TData>[] = [];
  for (const item of items) {
    result.push({ item, depth, parentId });
    if (item.children?.length && expanded.has(item.id)) {
      result.push(...flattenTree(item.children, expanded, depth + 1, item.id));
    }
  }
  return result;
}

type TreeSlots = {
  root: BoxProps;
  viewport: BoxProps;
  item: TextProps;
  empty: TextProps;
  overflow: TextProps;
};

export interface TreeProps<TData = unknown>
  extends CommonComponentProps,
    SlottedComponentProps<
      TreeSlots,
      {
        readonly focused: boolean;
        readonly activeId?: string;
        readonly expanded: ReadonlySet<string>;
      }
    > {
  readonly items: readonly TreeItem<TData>[];
  readonly expandedIds?: readonly string[];
  readonly defaultExpandedIds?: readonly string[];
  readonly selectedId?: string;
  readonly defaultSelectedId?: string;
  readonly onExpandedChange?: (
    expanded: readonly string[],
  ) => void | Promise<void>;
  readonly onSelect?: (item: TreeItem<TData>) => void | Promise<void>;
  readonly height?: number;
  readonly staticLimit?: number;
  readonly autoFocus?: boolean;
}

interface TreeInputContext<TData> {
  readonly flat: readonly FlatTreeItem<TData>[];
  readonly activeIndex: number;
  readonly height: number;
  readonly expanded: ReadonlySet<string>;
  readonly readOnly: boolean;
  readonly move: (index: number) => void;
  readonly setExpanded: (id: string, value: boolean) => Promise<void>;
  readonly select: (entry: FlatTreeItem<TData> | undefined) => Promise<void>;
}

function treeNavigationTarget(
  key: Key,
  activeIndex: number,
  height: number,
  count: number,
): number | undefined {
  if (key.upArrow) return activeIndex - 1;
  if (key.downArrow) return activeIndex + 1;
  if (key.pageUp) return activeIndex - height;
  if (key.pageDown) return activeIndex + height;
  if (key.home) return 0;
  if (key.end) return count - 1;
  return undefined;
}

async function handleTreeHorizontal<TData>(
  key: Key,
  context: TreeInputContext<TData>,
): Promise<boolean> {
  const entry = context.flat[context.activeIndex];
  if (key.rightArrow) return handleTreeRight(entry, context);
  if (key.leftArrow) return handleTreeLeft(entry, context);
  return false;
}

async function handleTreeRight<TData>(
  entry: FlatTreeItem<TData> | undefined,
  context: TreeInputContext<TData>,
): Promise<true> {
  if (entry?.item.children?.length && !context.expanded.has(entry.item.id)) {
    await context.setExpanded(entry.item.id, true);
  } else if (entry?.item.children?.length) {
    context.move(context.activeIndex + 1);
  }
  return true;
}

async function handleTreeLeft<TData>(
  entry: FlatTreeItem<TData> | undefined,
  context: TreeInputContext<TData>,
): Promise<true> {
  if (entry && context.expanded.has(entry.item.id)) {
    await context.setExpanded(entry.item.id, false);
  } else if (entry?.parentId) {
    context.move(
      context.flat.findIndex(
        (candidate) => candidate.item.id === entry.parentId,
      ),
    );
  }
  return true;
}

async function handleTreeInput<TData>(
  input: string,
  key: Key,
  context: TreeInputContext<TData>,
): Promise<boolean> {
  const target = treeNavigationTarget(
    key,
    context.activeIndex,
    context.height,
    context.flat.length,
  );
  if (target !== undefined) {
    context.move(target);
    return true;
  }
  if (await handleTreeHorizontal(key, context)) return true;
  if (!key.return && input !== " ") return false;
  const entry = context.flat[context.activeIndex];
  if (entry?.item.children?.length && !context.readOnly) {
    await context.setExpanded(
      entry.item.id,
      !context.expanded.has(entry.item.id),
    );
  }
  await context.select(entry);
  return true;
}

function treeMarker(
  expandable: boolean,
  expanded: boolean,
  unicode: boolean,
): string {
  if (!expandable) return " ";
  if (expanded) return unicode ? "▾" : "-";
  return unicode ? "▸" : "+";
}

function TreeRows<TData>(props: {
  readonly flat: readonly FlatTreeItem<TData>[];
  readonly indexes: readonly number[];
  readonly id: string;
  readonly focused: boolean;
  readonly activeIndex: number;
  readonly currentSelected: string | undefined;
  readonly expanded: ReadonlySet<string>;
  readonly unicode: boolean;
  readonly Item: ElementType<TextProps>;
  readonly itemProps: TextProps;
}): ReactNode {
  return props.indexes.map((index) => {
    const entry = props.flat[index];
    if (!entry) return null;
    const expandable = Boolean(entry.item.children?.length);
    const isExpanded = props.expanded.has(entry.item.id);
    const active = props.focused && index === props.activeIndex;
    return (
      <SemanticBox
        key={entry.item.id}
        id={`${props.id}:item:${entry.item.id}`}
        role="treeitem"
        label={entry.item.label}
        description={entry.item.description}
        selected={entry.item.id === props.currentSelected}
        expanded={expandable ? isExpanded : undefined}
        disabled={entry.item.disabled}
        height={1}
        overflow="hidden"
        layout={{ parentId: props.id, zIndex: 1 }}
      >
        <props.Item
          inverse={active}
          bold={active || entry.item.id === props.currentSelected}
          dimColor={entry.item.disabled}
          {...props.itemProps}
        >
          {"  ".repeat(entry.depth)}
          {treeMarker(expandable, isExpanded, props.unicode)}{" "}
          {escapeTerminalControlCharacters(entry.item.label)}
        </props.Item>
      </SemanticBox>
    );
  });
}

function TreePresentation<TData>(props: {
  readonly Root: ElementType<BoxProps>;
  readonly Viewport: ElementType<BoxProps>;
  readonly Item: ElementType<TextProps>;
  readonly Empty: ElementType<TextProps>;
  readonly Overflow: ElementType<TextProps>;
  readonly rootProps: BoxProps;
  readonly viewportProps: BoxProps;
  readonly itemProps: TextProps;
  readonly emptyProps: TextProps;
  readonly overflowProps: TextProps;
  readonly id: string;
  readonly label: string;
  readonly metadata: CommonComponentProps;
  readonly flat: readonly FlatTreeItem<TData>[];
  readonly indexes: readonly number[];
  readonly focused: boolean;
  readonly activeIndex: number;
  readonly currentSelected: string | undefined;
  readonly expanded: ReadonlySet<string>;
  readonly unicode: boolean;
  readonly interactive: boolean;
  readonly height: number;
  readonly remaining: number;
}): ReactNode {
  const rows =
    props.flat.length === 0 ? (
      <props.Empty dimColor {...props.emptyProps}>
        No items
      </props.Empty>
    ) : (
      <props.Viewport
        flexDirection="column"
        height={props.interactive ? props.height : undefined}
        overflow="hidden"
        {...props.viewportProps}
      >
        <TreeRows
          flat={props.flat}
          indexes={props.indexes}
          id={props.id}
          focused={props.focused}
          activeIndex={props.activeIndex}
          currentSelected={props.currentSelected}
          expanded={props.expanded}
          unicode={props.unicode}
          Item={props.Item}
          itemProps={props.itemProps}
        />
      </props.Viewport>
    );
  return (
    <SemanticBox
      {...props.metadata}
      id={props.id}
      role="tree"
      label={props.label}
      valueText={`${props.flat.length} visible items`}
      flexDirection="column"
      layout={{ ...props.metadata.layout, focusable: props.interactive }}
    >
      <props.Root flexDirection="column" {...props.rootProps}>
        {rows}
        {props.remaining > 0 ? (
          <props.Overflow dimColor {...props.overflowProps}>
            {props.interactive ? "↓" : "…"} {props.remaining}{" "}
            {props.interactive ? "more" : "additional items omitted"}
          </props.Overflow>
        ) : null}
      </props.Root>
    </SemanticBox>
  );
}

export function Tree<TData>({
  items,
  expandedIds,
  defaultExpandedIds = [],
  selectedId,
  defaultSelectedId,
  onExpandedChange,
  onSelect,
  height = 12,
  staticLimit = 1_000,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  ...props
}: TreeProps<TData>): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const [internalExpanded, setInternalExpanded] = useState(
    () => new Set(defaultExpandedIds),
  );
  const [internalSelected, setInternalSelected] = useState(defaultSelectedId);
  const expanded = useMemo(
    () => new Set(expandedIds ?? internalExpanded),
    [expandedIds, internalExpanded],
  );
  const flat = useMemo(() => flattenTree(items, expanded), [expanded, items]);
  const currentSelected = selectedId ?? internalSelected;
  const selectedIndex = Math.max(
    0,
    flat.findIndex((entry) => entry.item.id === currentSelected),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const { state: scroll, snapshot: scrollSnapshot } = useTerminalScrollArea({
    id,
    viewport: { width: 1, height },
    extent: { width: 1, height: flat.length },
    followFocus: true,
    enabled: interactive && !disabled,
  });
  const offset = scrollSnapshot.position.y;
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive,
        hidden: false,
        role: "tree" as const,
        label: props.label ?? "Tree",
      }),
      [disabled, id, interactive, props.label],
    ),
  );
  useEffect(() => {
    if (autoFocus && interactive) focus();
  }, [autoFocus, focus, interactive]);
  const move = useCallback(
    (next: number) => {
      const value = Math.min(flat.length - 1, Math.max(0, next));
      setActiveIndex(Math.max(0, value));
      if (value < offset) scroll.scrollTo({ y: value });
      if (value >= offset + height) scroll.scrollTo({ y: value - height + 1 });
    },
    [flat.length, height, offset, scroll],
  );
  const setExpanded = useCallback(
    async (itemId: string, value: boolean) => {
      const next = new Set(expanded);
      if (value) next.add(itemId);
      else next.delete(itemId);
      if (expandedIds === undefined) setInternalExpanded(next);
      await onExpandedChange?.(Object.freeze([...next]));
    },
    [expanded, expandedIds, onExpandedChange],
  );
  const select = useCallback(
    async (entry: FlatTreeItem<TData> | undefined) => {
      if (!entry || entry.item.disabled || readOnly) return;
      if (selectedId === undefined) setInternalSelected(entry.item.id);
      await onSelect?.(entry.item);
    },
    [onSelect, readOnly, selectedId],
  );
  usePointerEvents(
    useMemo(
      () => [
        ...flat.map((entry, index) => ({
          id: `${id}:item:${entry.item.id}`,
          type: "click" as const,
          enabled: !disabled && !entry.item.disabled,
          listener: async () => {
            focus();
            move(index);
            if (entry.item.children?.length && !readOnly) {
              await setExpanded(entry.item.id, !expanded.has(entry.item.id));
            }
            await select(entry);
          },
        })),
      ],
      [
        disabled,
        expanded,
        flat,
        focus,
        id,
        move,
        readOnly,
        select,
        setExpanded,
      ],
    ),
  );
  useTerminalInput(
    (input, key) =>
      handleTreeInput(input, key, {
        flat,
        activeIndex,
        height,
        expanded,
        readOnly,
        move,
        setExpanded,
        select,
      }),
    { enabled: focused && !disabled, priority: 1_520 },
  );
  const range = useTerminalVirtualizer({
    count: flat.length,
    viewportSize: height,
    scrollOffset: offset,
    overscan: 0,
  });
  const indexes = interactive
    ? getVisibleTerminalIndexes(range)
    : [...flat.keys()].slice(0, Math.max(0, staticLimit));
  const state = {
    focused,
    activeId: flat[activeIndex]?.item.id,
    expanded,
  };
  const Root = slots?.root ?? Box;
  const Viewport = slots?.viewport ?? Box;
  const Item = slots?.item ?? Text;
  const Empty = slots?.empty ?? Text;
  const Overflow = slots?.overflow ?? Text;
  const remaining = interactive
    ? range.after > 0
      ? flat.length - range.endIndex - 1
      : 0
    : Math.max(0, flat.length - indexes.length);
  return (
    <TreePresentation
      Root={Root}
      Viewport={Viewport}
      Item={Item}
      Empty={Empty}
      Overflow={Overflow}
      rootProps={resolveSlotProps(slotProps?.root, state, theme)}
      viewportProps={resolveSlotProps(slotProps?.viewport, state, theme)}
      itemProps={resolveSlotProps(slotProps?.item, state, theme)}
      emptyProps={resolveSlotProps(slotProps?.empty, state, theme)}
      overflowProps={resolveSlotProps(slotProps?.overflow, state, theme)}
      id={id}
      label={props.label ?? "Tree"}
      metadata={{ ...props, disabled, readOnly }}
      flat={flat}
      indexes={indexes}
      focused={focused}
      activeIndex={activeIndex}
      currentSelected={currentSelected}
      expanded={expanded}
      unicode={app.capabilities.unicode}
      interactive={interactive}
      height={height}
      remaining={remaining}
    />
  );
}
