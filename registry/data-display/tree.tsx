import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  escapeTerminalControlCharacters,
  TerminalSemanticNode as SemanticNode,
  useTerminalInput,
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
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
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
  const [offset, setOffset] = useState(0);
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
      if (value < offset) setOffset(value);
      if (value >= offset + height) setOffset(value - height + 1);
    },
    [flat.length, height, offset],
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
  useTerminalInput(
    async (_input, key) => {
      const entry = flat[activeIndex];
      if (key.upArrow) {
        move(activeIndex - 1);
        return true;
      }
      if (key.downArrow) {
        move(activeIndex + 1);
        return true;
      }
      if (key.pageUp) {
        move(activeIndex - height);
        return true;
      }
      if (key.pageDown) {
        move(activeIndex + height);
        return true;
      }
      if (key.rightArrow) {
        if (entry?.item.children?.length && !expanded.has(entry.item.id)) {
          await setExpanded(entry.item.id, true);
        } else if (entry?.item.children?.length) {
          move(activeIndex + 1);
        }
        return true;
      }
      if (key.leftArrow) {
        if (entry && expanded.has(entry.item.id)) {
          await setExpanded(entry.item.id, false);
        } else if (entry?.parentId) {
          move(
            flat.findIndex((candidate) => candidate.item.id === entry.parentId),
          );
        }
        return true;
      }
      if (key.return || _input === " ") {
        if (entry?.item.children?.length && !readOnly) {
          await setExpanded(entry.item.id, !expanded.has(entry.item.id));
        }
        await select(entry);
        return true;
      }
      if (key.home) {
        move(0);
        return true;
      }
      if (key.end) {
        move(flat.length - 1);
        return true;
      }
      return false;
    },
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
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticNode
        id={id}
        role="tree"
        label={props.label ?? "Tree"}
        valueText={`${flat.length} visible items`}
        metadata={{ ...props, disabled, readOnly }}
      />
      {flat.length === 0 ? (
        <Empty dimColor {...resolveSlotProps(slotProps?.empty, state, theme)}>
          No items
        </Empty>
      ) : (
        <Viewport
          flexDirection="column"
          height={interactive ? height : undefined}
          overflow="hidden"
          {...resolveSlotProps(slotProps?.viewport, state, theme)}
        >
          {indexes.map((index) => {
            const entry = flat[index];
            if (!entry) return null;
            const expandable = Boolean(entry.item.children?.length);
            const isExpanded = expanded.has(entry.item.id);
            const active = focused && index === activeIndex;
            const marker = expandable
              ? isExpanded
                ? app.capabilities.unicode
                  ? "▾"
                  : "-"
                : app.capabilities.unicode
                  ? "▸"
                  : "+"
              : " ";
            return (
              <Item
                key={entry.item.id}
                inverse={active}
                bold={active || entry.item.id === currentSelected}
                dimColor={entry.item.disabled}
                {...resolveSlotProps(slotProps?.item, state, theme)}
              >
                <SemanticNode
                  id={`${id}:item:${entry.item.id}`}
                  role="treeitem"
                  label={entry.item.label}
                  description={entry.item.description}
                  selected={entry.item.id === currentSelected}
                  expanded={expandable ? isExpanded : undefined}
                  disabled={entry.item.disabled}
                />
                {"  ".repeat(entry.depth)}
                {marker} {escapeTerminalControlCharacters(entry.item.label)}
              </Item>
            );
          })}
        </Viewport>
      )}
      {interactive && range.after > 0 ? (
        <Overflow
          dimColor
          {...resolveSlotProps(slotProps?.overflow, state, theme)}
        >
          ↓ {flat.length - range.endIndex - 1} more
        </Overflow>
      ) : null}
      {!interactive && flat.length > indexes.length ? (
        <Overflow
          dimColor
          {...resolveSlotProps(slotProps?.overflow, state, theme)}
        >
          … {flat.length - indexes.length} additional items omitted
        </Overflow>
      ) : null}
    </Root>
  );
}
