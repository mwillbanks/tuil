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

type VirtualListSlots = {
  root: BoxProps;
  viewport: BoxProps;
  item: TextProps;
  overflow: TextProps;
  empty: TextProps;
};

export interface VirtualListRenderContext {
  readonly index: number;
  readonly active: boolean;
  readonly focused: boolean;
}

export interface VirtualListProps<TItem>
  extends CommonComponentProps,
    SlottedComponentProps<
      VirtualListSlots,
      {
        readonly focused: boolean;
        readonly activeIndex: number;
        readonly offset: number;
      }
    > {
  readonly items: readonly TItem[];
  readonly renderItem: (
    item: TItem,
    context: VirtualListRenderContext,
  ) => ReactNode;
  readonly getItemKey: (item: TItem, index: number) => string;
  readonly getItemLabel?: (item: TItem, index: number) => string;
  readonly height?: number;
  readonly overscan?: number;
  readonly offset?: number;
  readonly defaultOffset?: number;
  readonly onOffsetChange?: (offset: number) => void | Promise<void>;
  readonly activeIndex?: number;
  readonly defaultActiveIndex?: number;
  readonly onActiveIndexChange?: (index: number) => void | Promise<void>;
  readonly onSelect?: (item: TItem, index: number) => void | Promise<void>;
  readonly emptyMessage?: string;
  readonly staticLimit?: number;
  readonly autoFocus?: boolean;
}

export function VirtualList<TItem>({
  items,
  renderItem,
  getItemKey,
  getItemLabel,
  height = 10,
  overscan = 1,
  offset,
  defaultOffset = 0,
  onOffsetChange,
  activeIndex,
  defaultActiveIndex = 0,
  onActiveIndexChange,
  onSelect,
  emptyMessage = "No items",
  staticLimit = 1_000,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  ...props
}: VirtualListProps<TItem>): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const [internalOffset, setInternalOffset] = useState(defaultOffset);
  const [internalActive, setInternalActive] = useState(defaultActiveIndex);
  const currentOffset = offset ?? internalOffset;
  const currentActive = Math.min(
    Math.max(0, activeIndex ?? internalActive),
    Math.max(0, items.length - 1),
  );
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive,
        hidden: false,
        role: "listbox" as const,
        label: props.label ?? "Virtual list",
      }),
      [disabled, id, interactive, props.label],
    ),
  );
  useEffect(() => {
    if (autoFocus && interactive) focus();
  }, [autoFocus, focus, interactive]);
  const setOffset = useCallback(
    async (next: number) => {
      const maximum = Math.max(0, items.length - Math.max(1, height));
      const value = Math.min(maximum, Math.max(0, Math.floor(next)));
      if (offset === undefined) setInternalOffset(value);
      await onOffsetChange?.(value);
    },
    [height, items.length, offset, onOffsetChange],
  );
  const setActive = useCallback(
    async (next: number) => {
      if (items.length === 0) return;
      const value = Math.min(items.length - 1, Math.max(0, Math.floor(next)));
      if (activeIndex === undefined) setInternalActive(value);
      await onActiveIndexChange?.(value);
      if (value < currentOffset) {
        await setOffset(value);
      } else if (value >= currentOffset + height) {
        await setOffset(value - height + 1);
      }
    },
    [
      activeIndex,
      currentOffset,
      height,
      items.length,
      onActiveIndexChange,
      setOffset,
    ],
  );
  useTerminalInput(
    async (_input, key) => {
      if (key.upArrow) {
        await setActive(currentActive - 1);
        return true;
      }
      if (key.downArrow) {
        await setActive(currentActive + 1);
        return true;
      }
      if (key.pageUp) {
        await setActive(currentActive - Math.max(1, height));
        return true;
      }
      if (key.pageDown) {
        await setActive(currentActive + Math.max(1, height));
        return true;
      }
      if (key.home) {
        await setActive(0);
        return true;
      }
      if (key.end) {
        await setActive(items.length - 1);
        return true;
      }
      if (key.return) {
        if (currentActive >= 0 && currentActive < items.length && !readOnly) {
          await onSelect?.(items[currentActive] as TItem, currentActive);
        }
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_500 },
  );
  const range = useTerminalVirtualizer({
    count: items.length,
    viewportSize: Math.max(1, height),
    scrollOffset: currentOffset,
    overscan,
  });
  const indexes = interactive
    ? getVisibleTerminalIndexes(range)
    : [...items.keys()].slice(0, Math.max(0, staticLimit));
  const overscanIndexes = interactive
    ? range.indexes.filter(
        (index) => index < range.startIndex || index > range.endIndex,
      )
    : [];
  const state = {
    focused,
    activeIndex: currentActive,
    offset: range.offset,
  };
  const Root = slots?.root ?? Box;
  const Viewport = slots?.viewport ?? Box;
  const Item = slots?.item ?? Text;
  const Overflow = slots?.overflow ?? Text;
  const Empty = slots?.empty ?? Text;
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticNode
        id={id}
        role="listbox"
        label={props.label ?? "Virtual list"}
        disabled={disabled}
        valueText={`${items.length} items`}
        metadata={{ ...props, disabled, readOnly }}
      />
      {items.length === 0 ? (
        <Empty dimColor {...resolveSlotProps(slotProps?.empty, state, theme)}>
          {emptyMessage}
        </Empty>
      ) : (
        <>
          {interactive && range.before > 0 ? (
            <Overflow
              dimColor
              {...resolveSlotProps(slotProps?.overflow, state, theme)}
            >
              ↑ {range.startIndex} more
            </Overflow>
          ) : null}
          <Viewport
            flexDirection="column"
            height={interactive ? Math.max(1, height) : undefined}
            overflow="hidden"
            {...resolveSlotProps(slotProps?.viewport, state, theme)}
          >
            {indexes.map((index) => {
              if (index < 0 || index >= items.length) return null;
              const item = items[index] as TItem;
              const key = getItemKey(item, index);
              const label = getItemLabel?.(item, index) ?? key;
              return (
                <Box key={key} height={1} overflow="hidden">
                  <Item
                    bold={focused && index === currentActive}
                    inverse={focused && index === currentActive}
                    wrap="truncate-end"
                    {...resolveSlotProps(slotProps?.item, state, theme)}
                  >
                    <SemanticNode
                      id={`${id}:item:${key}`}
                      role="option"
                      label={label}
                      selected={index === currentActive}
                    />
                    {renderItem(item, {
                      index,
                      active: index === currentActive,
                      focused,
                    })}
                  </Item>
                </Box>
              );
            })}
          </Viewport>
          {overscanIndexes.map((index) => {
            if (index < 0 || index >= items.length) return null;
            const item = items[index] as TItem;
            return (
              <Box
                key={`overscan:${getItemKey(item, index)}`}
                height={0}
                overflow="hidden"
              >
                <Item {...resolveSlotProps(slotProps?.item, state, theme)}>
                  {renderItem(item, {
                    index,
                    active: index === currentActive,
                    focused,
                  })}
                </Item>
              </Box>
            );
          })}
          {interactive && range.after > 0 ? (
            <Overflow
              dimColor
              {...resolveSlotProps(slotProps?.overflow, state, theme)}
            >
              ↓ {items.length - range.endIndex - 1} more
            </Overflow>
          ) : null}
          {!interactive && items.length > indexes.length ? (
            <Overflow
              dimColor
              {...resolveSlotProps(slotProps?.overflow, state, theme)}
            >
              … {items.length - indexes.length} additional items omitted
            </Overflow>
          ) : null}
        </>
      )}
    </Root>
  );
}
