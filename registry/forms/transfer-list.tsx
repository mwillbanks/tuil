import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  escapeTerminalControlCharacters,
  useSemanticNode,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

export interface TransferListItem<TData = unknown> {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly data?: TData;
}

type TransferListSlots = {
  root: BoxProps;
  panel: BoxProps;
  title: TextProps;
  item: TextProps;
  controls: TextProps;
  empty: TextProps;
  overflow: TextProps;
};

type TransferSide = "available" | "selected";

function SemanticTransferNode(props: {
  readonly id: string;
  readonly role: "form" | "listbox" | "option";
  readonly label: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly valueText?: string;
  readonly metadata?: CommonComponentProps;
}): null {
  useSemanticNode(
    useMemo(
      () => ({
        key: props.id,
        id: props.id,
        testId: props.metadata?.testId,
        role: props.metadata?.role ?? props.role,
        label: props.metadata?.label ?? props.label,
        description: props.metadata?.description,
        selected: props.metadata?.selected ?? props.selected,
        checked: props.metadata?.checked,
        expanded: props.metadata?.expanded,
        disabled: props.metadata?.disabled ?? props.disabled,
        readOnly: props.metadata?.readOnly,
        valueText: props.metadata?.valueText ?? props.valueText,
      }),
      [props],
    ),
  );
  return null;
}

export interface TransferListProps<TData = unknown>
  extends CommonComponentProps,
    SlottedComponentProps<
      TransferListSlots,
      {
        readonly focused: boolean;
        readonly side: TransferSide;
        readonly activeIndex: number;
      }
    > {
  readonly items: readonly TransferListItem<TData>[];
  readonly value?: readonly string[];
  readonly defaultValue?: readonly string[];
  readonly onValueChange?: (
    selectedIds: readonly string[],
  ) => void | Promise<void>;
  readonly onTransfer?: (
    item: TransferListItem<TData>,
    direction: "select" | "remove",
  ) => void | Promise<void>;
  readonly availableTitle?: string;
  readonly selectedTitle?: string;
  readonly height?: number;
  readonly autoFocus?: boolean;
}

export function TransferList<TData>({
  items,
  value,
  defaultValue = [],
  onValueChange,
  onTransfer,
  availableTitle = "Available",
  selectedTitle = "Selected",
  height = 8,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  ...props
}: TransferListProps<TData>): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const [internal, setInternal] = useState<readonly string[]>(defaultValue);
  const [side, setSide] = useState<TransferSide>("available");
  const [availableIndex, setAvailableIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIds = value ?? internal;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const available = items.filter((item) => !selectedSet.has(item.id));
  const selected = selectedIds.flatMap((itemId) => {
    const item = itemById.get(itemId);
    return item ? [item] : [];
  });
  const activeItems = side === "available" ? available : selected;
  const activeIndex =
    side === "available"
      ? Math.min(availableIndex, Math.max(0, available.length - 1))
      : Math.min(selectedIndex, Math.max(0, selected.length - 1));
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive,
        hidden: false,
        role: "listbox" as const,
        label: props.label ?? "Transfer list",
      }),
      [disabled, id, interactive, props.label],
    ),
  );
  useEffect(() => {
    if (autoFocus && interactive) focus();
  }, [autoFocus, focus, interactive]);
  const setValue = useCallback(
    async (next: readonly string[]) => {
      const frozen = Object.freeze([...next]);
      if (value === undefined) setInternal(frozen);
      await onValueChange?.(frozen);
    },
    [onValueChange, value],
  );
  const transfer = useCallback(
    async (item: TransferListItem<TData> | undefined) => {
      if (!item || item.disabled || readOnly) return;
      const selecting = side === "available";
      const next = selecting
        ? [...selectedIds, item.id]
        : selectedIds.filter((candidate) => candidate !== item.id);
      await setValue(next);
      await onTransfer?.(item, selecting ? "select" : "remove");
    },
    [onTransfer, readOnly, selectedIds, setValue, side],
  );
  const transferAll = useCallback(async () => {
    if (readOnly) return;
    const movable = activeItems.filter((item) => !item.disabled);
    if (side === "available") {
      await setValue([...selectedIds, ...movable.map((item) => item.id)]);
    } else {
      const moving = new Set(movable.map((item) => item.id));
      await setValue(selectedIds.filter((itemId) => !moving.has(itemId)));
    }
    for (const item of movable) {
      await onTransfer?.(item, side === "available" ? "select" : "remove");
    }
  }, [activeItems, onTransfer, readOnly, selectedIds, setValue, side]);
  const move = useCallback(
    (next: number) => {
      const value = Math.min(activeItems.length - 1, Math.max(0, next));
      if (side === "available") setAvailableIndex(Math.max(0, value));
      else setSelectedIndex(Math.max(0, value));
    },
    [activeItems.length, side],
  );
  useTerminalInput(
    async (input, key) => {
      if (key.leftArrow) {
        setSide("available");
        return true;
      }
      if (key.rightArrow) {
        setSide("selected");
        return true;
      }
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
      if (key.home) {
        move(0);
        return true;
      }
      if (key.end) {
        move(activeItems.length - 1);
        return true;
      }
      if (key.return || input === " ") {
        await transfer(activeItems[activeIndex]);
        return true;
      }
      if (input.toLowerCase() === "a") {
        await transferAll();
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_540 },
  );
  const state = { focused, side, activeIndex };
  const Root = slots?.root ?? Box;
  const Panel = slots?.panel ?? Box;
  const Title = slots?.title ?? Text;
  const Item = slots?.item ?? Text;
  const Controls = slots?.controls ?? Text;
  const Empty = slots?.empty ?? Text;
  const Overflow = slots?.overflow ?? Text;
  const renderPanel = (
    panelSide: TransferSide,
    title: string,
    panelItems: readonly TransferListItem<TData>[],
    panelIndex: number,
  ) => {
    const start = Math.max(
      0,
      Math.min(panelIndex - height + 1, panelItems.length - height),
    );
    return (
      <Panel
        key={panelSide}
        flexDirection="column"
        width="45%"
        minHeight={height + 1}
        borderStyle={focused && side === panelSide ? "single" : undefined}
        {...resolveSlotProps(slotProps?.panel, state, theme)}
      >
        <SemanticTransferNode
          id={`${id}:${panelSide}`}
          role="listbox"
          label={title}
          valueText={`${panelItems.length} items`}
        />
        <Title
          bold
          underline={focused && side === panelSide}
          {...resolveSlotProps(slotProps?.title, state, theme)}
        >
          {title} ({panelItems.length})
        </Title>
        {panelItems.length === 0 ? (
          <Empty dimColor {...resolveSlotProps(slotProps?.empty, state, theme)}>
            None
          </Empty>
        ) : (
          <>
            {panelItems
              .slice(start, start + Math.max(1, height))
              .map((item, visibleIndex) => {
                const index = start + visibleIndex;
                const active =
                  focused && side === panelSide && index === panelIndex;
                return (
                  <Item
                    key={item.id}
                    inverse={active}
                    bold={active}
                    dimColor={item.disabled}
                    {...resolveSlotProps(slotProps?.item, state, theme)}
                  >
                    <SemanticTransferNode
                      id={`${id}:${panelSide}:${item.id}`}
                      role="option"
                      label={item.label}
                      selected={active}
                      disabled={item.disabled}
                    />
                    {active ? (app.capabilities.unicode ? "▶ " : "> ") : "  "}
                    {escapeTerminalControlCharacters(item.label)}
                  </Item>
                );
              })}
            {!interactive && panelItems.length > Math.max(1, height) ? (
              <Overflow
                dimColor
                {...resolveSlotProps(slotProps?.overflow, state, theme)}
              >
                … {panelItems.length - Math.max(1, height)} additional items
                omitted
              </Overflow>
            ) : null}
          </>
        )}
      </Panel>
    );
  };
  return (
    <Root
      flexDirection="row"
      gap={1}
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticTransferNode
        id={id}
        role="form"
        label={props.label ?? "Transfer list"}
        valueText={`${selected.length} selected`}
        metadata={{ ...props, disabled, readOnly }}
      />
      {renderPanel("available", availableTitle, available, availableIndex)}
      <Controls
        dimColor
        {...resolveSlotProps(slotProps?.controls, state, theme)}
      >
        {interactive ? "← →\nEnter\nA all" : "→"}
      </Controls>
      {renderPanel("selected", selectedTitle, selected, selectedIndex)}
    </Root>
  );
}
