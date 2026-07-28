import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  Box as SemanticBox,
  usePointerEvent,
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

function VirtualListItemTarget(props: {
  readonly id: string;
  readonly parentId: string;
  readonly label: string;
  readonly selected: boolean;
  readonly enabled: boolean;
  readonly onSelect: () => void | Promise<void>;
  readonly children: ReactNode;
}): ReactNode {
  const select = useCallback(() => void props.onSelect(), [props.onSelect]);
  usePointerEvent(props.id, "click", select, {
    enabled: props.enabled,
  });
  return (
    <SemanticBox
      id={props.id}
      role="option"
      label={props.label}
      selected={props.selected}
      height={1}
      overflow="hidden"
      layout={{ parentId: props.parentId, zIndex: 1 }}
    >
      {props.children}
    </SemanticBox>
  );
}

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
  const [internalActive, setInternalActive] = useState(defaultActiveIndex);
  const { state: scroll, snapshot: scrollSnapshot } = useTerminalScrollArea({
    id,
    viewport: { width: 1, height: Math.max(1, height) },
    extent: { width: 1, height: items.length },
    followFocus: true,
    enabled: interactive && !disabled,
    initialPosition: { y: offset ?? defaultOffset },
  });
  const currentOffset = offset ?? scrollSnapshot.position.y;
  useEffect(() => {
    scroll.scrollTo({ y: offset ?? defaultOffset });
  }, [defaultOffset, offset, scroll]);
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
      if (offset === undefined) scroll.scrollTo({ y: value });
      await onOffsetChange?.(value);
    },
    [height, items.length, offset, onOffsetChange, scroll],
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
  const focusFromPointer = useCallback(() => focus(), [focus]);
  usePointerEvent(id, "click", focusFromPointer, {
    enabled: interactive && !disabled,
  });
  return (
    <SemanticBox
      {...props}
      id={id}
      role="listbox"
      label={props.label ?? "Virtual list"}
      disabled={disabled}
      readOnly={readOnly}
      valueText={`${items.length} items`}
      flexDirection="column"
      layout={{ focusable: interactive && !disabled }}
    >
      <Root
        flexDirection="column"
        {...resolveSlotProps(slotProps?.root, state, theme)}
      >
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
                const itemId = `${id}:item:${key}`;
                return (
                  <VirtualListItemTarget
                    key={key}
                    id={itemId}
                    parentId={id}
                    label={label}
                    selected={index === currentActive}
                    enabled={interactive && !disabled}
                    onSelect={async () => {
                      focus();
                      await setActive(index);
                      if (!readOnly) await onSelect?.(item, index);
                    }}
                  >
                    <Item
                      bold={focused && index === currentActive}
                      inverse={focused && index === currentActive}
                      wrap="truncate-end"
                      {...resolveSlotProps(slotProps?.item, state, theme)}
                    >
                      {renderItem(item, {
                        index,
                        active: index === currentActive,
                        focused,
                      })}
                    </Item>
                  </VirtualListItemTarget>
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
    </SemanticBox>
  );
}
