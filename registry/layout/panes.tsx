import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
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
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface SplitPaneItem {
  readonly id: string;
  readonly content: ReactNode;
  readonly minSize?: number;
  readonly maxSize?: number;
}

type SplitPaneSlots = {
  root: BoxProps;
  track: BoxProps;
  pane: BoxProps;
  divider: TextProps;
  help: TextProps;
};

function paneConstraint(
  pane: SplitPaneItem,
  key: "minSize" | "maxSize",
  fallback: number,
): number {
  const value = pane[key] ?? fallback;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(
      `Pane "${pane.id}" requires a ${key} between 0 and 100`,
    );
  }
  return value;
}

function paneConstraints(panes: readonly SplitPaneItem[]): {
  readonly minimums: readonly number[];
  readonly maximums: readonly number[];
} {
  const minimums = panes.map((pane) => paneConstraint(pane, "minSize", 0));
  const maximums = panes.map((pane, index) => {
    const maximum = paneConstraint(pane, "maxSize", 100);
    if (maximum < (minimums[index] ?? 0)) {
      throw new RangeError(`Pane "${pane.id}" has maxSize below its minSize`);
    }
    return maximum;
  });
  if (
    minimums.reduce((sum, value) => sum + value, 0) > 100 ||
    maximums.reduce((sum, value) => sum + value, 0) < 100
  ) {
    throw new RangeError("Split pane constraints cannot total 100%");
  }
  return { minimums, maximums };
}

function normalizedPaneSizes(
  count: number,
  sizes: readonly number[] | undefined,
): readonly number[] {
  const source =
    sizes?.length === count ? sizes : Array.from({ length: count }, () => 1);
  const positive = source.map((size) =>
    Number.isFinite(size) ? Math.max(0, size) : 0,
  );
  const total = positive.reduce((sum, size) => sum + size, 0);
  return total === 0
    ? Array.from({ length: count }, () => 100 / count)
    : positive.map((size) => (size / total) * 100);
}

function distributePaneSizes(
  sizes: number[],
  minimums: readonly number[],
  maximums: readonly number[],
): readonly number[] {
  for (let pass = 0; pass < sizes.length * 2; pass += 1) {
    const delta = 100 - sizes.reduce((sum, value) => sum + value, 0);
    if (Math.abs(delta) < 0.000_001) break;
    const candidates = sizes.flatMap((value, index) =>
      delta > 0
        ? value < (maximums[index] ?? 100)
          ? [index]
          : []
        : value > (minimums[index] ?? 0)
          ? [index]
          : [],
    );
    if (candidates.length === 0) {
      throw new RangeError("Split pane constraints cannot total 100%");
    }
    const share = delta / candidates.length;
    for (const index of candidates) {
      sizes[index] = Math.min(
        maximums[index] ?? 100,
        Math.max(minimums[index] ?? 0, (sizes[index] ?? 0) + share),
      );
    }
  }
  return Object.freeze(sizes);
}

function resolvePaneSizes(
  panes: readonly SplitPaneItem[],
  sizes: readonly number[] | undefined,
): readonly number[] {
  const count = panes.length;
  if (count === 0) return Object.freeze([]);
  const { minimums, maximums } = paneConstraints(panes);
  const result = normalizedPaneSizes(count, sizes).map((size, index) =>
    Math.min(maximums[index] ?? 100, Math.max(minimums[index] ?? 0, size)),
  );
  return distributePaneSizes(result, minimums, maximums);
}

export interface SplitPaneProps
  extends CommonComponentProps,
    SlottedComponentProps<
      SplitPaneSlots,
      {
        readonly focused: boolean;
        readonly activeDivider: number;
        readonly sizes: readonly number[];
      }
    > {
  readonly panes: readonly SplitPaneItem[];
  readonly orientation?: "horizontal" | "vertical";
  readonly sizes?: readonly number[];
  readonly defaultSizes?: readonly number[];
  readonly onSizesChange?: (sizes: readonly number[]) => void | Promise<void>;
  readonly resizeStep?: number;
  readonly showHelp?: boolean;
  readonly autoFocus?: boolean;
}

export function SplitPane({
  panes,
  orientation = "horizontal",
  sizes,
  defaultSizes,
  onSizesChange,
  resizeStep = 5,
  showHelp = true,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  ...props
}: SplitPaneProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const [internalSizes, setInternalSizes] = useState(() =>
    resolvePaneSizes(panes, defaultSizes),
  );
  const [activeDivider, setActiveDivider] = useState(0);
  const dragCoordinate = useRef<number | undefined>(undefined);
  const resolvedSizes = resolvePaneSizes(panes, sizes ?? internalSizes);
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive || panes.length < 2,
        hidden: false,
        role: "application" as const,
        label: props.label ?? "Split pane",
      }),
      [disabled, id, interactive, panes.length, props.label],
    ),
  );
  useEffect(() => {
    if (autoFocus && interactive) focus();
  }, [autoFocus, focus, interactive]);
  const setSizes = useCallback(
    async (next: readonly number[]) => {
      const normalized = resolvePaneSizes(panes, next);
      if (sizes === undefined) setInternalSizes(normalized);
      await onSizesChange?.(normalized);
    },
    [onSizesChange, panes, sizes],
  );
  const resize = useCallback(
    async (delta: number, divider = activeDivider) => {
      const left = panes[divider];
      const right = panes[divider + 1];
      if (!left || !right || readOnly) return;
      const next = [...resolvedSizes];
      const leftMinimum = Math.max(0, left.minSize ?? 0);
      const rightMinimum = Math.max(0, right.minSize ?? 0);
      const leftMaximum = Math.min(100, left.maxSize ?? 100);
      const rightMaximum = Math.min(100, right.maxSize ?? 100);
      const applied = Math.max(
        leftMinimum - (next[divider] ?? 0),
        (next[divider + 1] ?? 0) - rightMaximum,
        Math.min(
          leftMaximum - (next[divider] ?? 0),
          (next[divider + 1] ?? 0) - rightMinimum,
          delta,
        ),
      );
      next[divider] = (next[divider] ?? 0) + applied;
      next[divider + 1] = (next[divider + 1] ?? 0) - applied;
      await setSizes(next);
    },
    [activeDivider, panes, readOnly, resolvedSizes, setSizes],
  );
  usePointerEvents(
    useMemo(
      () =>
        panes.slice(0, -1).flatMap((pane, index) => {
          const dividerId = `${id}:divider:${pane.id}`;
          return [
            {
              id: dividerId,
              type: "down" as const,
              enabled: !disabled && !readOnly,
              listener: (event: { readonly x: number; readonly y: number }) => {
                setActiveDivider(index);
                focus();
                dragCoordinate.current =
                  orientation === "horizontal" ? event.x : event.y;
                app.pointer.capture(dividerId);
              },
            },
            {
              id: dividerId,
              type: "drag" as const,
              enabled: !disabled && !readOnly,
              listener: async (event: {
                readonly x: number;
                readonly y: number;
              }) => {
                const coordinate =
                  orientation === "horizontal" ? event.x : event.y;
                const previous = dragCoordinate.current ?? coordinate;
                dragCoordinate.current = coordinate;
                setActiveDivider(index);
                await resize((coordinate - previous) * resizeStep, index);
              },
            },
            {
              id: dividerId,
              type: "dragend" as const,
              listener: () => {
                dragCoordinate.current = undefined;
                app.pointer.releaseCapture(dividerId);
              },
            },
          ];
        }),
      [
        app.pointer,
        disabled,
        focus,
        id,
        orientation,
        panes,
        readOnly,
        resize,
        resizeStep,
      ],
    ),
  );
  useTerminalInput(
    async (input, key) => {
      const decrease =
        orientation === "horizontal" ? key.leftArrow : key.upArrow;
      const increase =
        orientation === "horizontal" ? key.rightArrow : key.downArrow;
      if (decrease) {
        await resize(-Math.abs(resizeStep));
        return true;
      }
      if (increase) {
        await resize(Math.abs(resizeStep));
        return true;
      }
      if (input === "[" || key.pageUp) {
        setActiveDivider((current) => Math.max(0, current - 1));
        return true;
      }
      if (input === "]" || key.pageDown) {
        setActiveDivider((current) =>
          Math.min(Math.max(0, panes.length - 2), current + 1),
        );
        return true;
      }
      if (key.home) {
        setActiveDivider(0);
        return true;
      }
      if (key.end) {
        setActiveDivider(Math.max(0, panes.length - 2));
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_530 },
  );
  const state = { focused, activeDivider, sizes: resolvedSizes };
  const Root = slots?.root ?? Box;
  const Track = slots?.track ?? Box;
  const Pane = slots?.pane ?? Box;
  const Divider = slots?.divider ?? Text;
  const Help = slots?.help ?? Text;
  return (
    <SemanticBox
      {...props}
      id={id}
      role="application"
      label={props.label ?? "Split pane"}
      valueText={resolvedSizes.map((size) => `${Math.round(size)}%`).join(", ")}
      flexDirection="column"
      disabled={disabled}
      readOnly={readOnly}
      layout={{ ...props.layout, focusable: interactive && !disabled }}
    >
      <Root
        flexDirection="column"
        {...resolveSlotProps(slotProps?.root, state, theme)}
      >
        <Track
          flexDirection={orientation === "horizontal" ? "row" : "column"}
          {...resolveSlotProps(slotProps?.track, state, theme)}
        >
          {panes.map((pane, index) => (
            <Box
              key={pane.id}
              flexDirection={orientation === "horizontal" ? "row" : "column"}
              width={
                orientation === "horizontal"
                  ? `${resolvedSizes[index] ?? 0}%`
                  : undefined
              }
              height={
                orientation === "vertical"
                  ? `${resolvedSizes[index] ?? 0}%`
                  : undefined
              }
            >
              <Pane
                flexGrow={1}
                overflow="hidden"
                {...resolveSlotProps(slotProps?.pane, state, theme)}
              >
                {pane.content}
              </Pane>
              {index < panes.length - 1 ? (
                <SemanticBox
                  id={`${id}:divider:${pane.id}`}
                  role="button"
                  label={`Resize ${pane.id}`}
                  selected={index === activeDivider}
                  disabled={disabled || readOnly}
                  valueText={`${Math.round(resolvedSizes[index] ?? 0)}%`}
                  layout={{ parentId: id, zIndex: 1 }}
                >
                  <Divider
                    bold={focused && index === activeDivider}
                    inverse={focused && index === activeDivider}
                    {...resolveSlotProps(slotProps?.divider, state, theme)}
                  >
                    {orientation === "horizontal"
                      ? app.capabilities.unicode
                        ? "│"
                        : "|"
                      : app.capabilities.unicode
                        ? "─"
                        : "-"}
                  </Divider>
                </SemanticBox>
              ) : null}
            </Box>
          ))}
        </Track>
        {interactive && showHelp && focused ? (
          <Help dimColor {...resolveSlotProps(slotProps?.help, state, theme)}>
            {orientation === "horizontal" ? "←/→ resize" : "↑/↓ resize"} · [/]{" "}
            divider
          </Help>
        ) : null}
      </Root>
    </SemanticBox>
  );
}

export const Header: typeof Box = Box;
export const Footer: typeof Box = Box;
export const Sidebar: typeof Box = Box;

export interface PaneTabsProps {
  readonly labels: readonly string[];
  readonly active: number;
  readonly children?: ReactNode;
}

export function PaneTabs({
  labels,
  active,
  children,
}: PaneTabsProps): ReactNode {
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {labels.map((label, index) => (
          <Text key={label} bold={index === active}>
            {index === active ? `[${label}]` : label}
          </Text>
        ))}
      </Box>
      {children}
    </Box>
  );
}

export interface ScrollAreaProps {
  readonly lines: readonly string[];
  readonly height: number;
  readonly offset?: number;
  readonly label?: string;
  readonly id?: string;
  readonly onOffsetChange?: (offset: number) => void | Promise<void>;
  readonly sticky?: "top" | "bottom";
}

export function ScrollArea({
  lines,
  height,
  offset = 0,
  label = "Scrollable content",
  id = "scroll-area",
  onOffsetChange,
  sticky,
}: ScrollAreaProps): ReactNode {
  const safeHeight = Math.max(1, Math.floor(height));
  const { state, snapshot } = useTerminalScrollArea({
    id,
    viewport: { width: 1, height: safeHeight },
    extent: { width: 1, height: lines.length },
    sticky: sticky ? { [sticky]: true } : undefined,
  });
  useEffect(() => {
    state.scrollTo({ y: offset });
  }, [offset, state]);
  const move = useCallback(
    async (delta: number) => {
      const next = state.wheel(0, delta);
      await onOffsetChange?.(next.position.y);
    },
    [onOffsetChange, state],
  );
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: false,
        hidden: false,
        role: "region" as const,
        label,
      }),
      [id, label],
    ),
  );
  usePointerEvents(
    useMemo(
      () => [
        {
          id,
          type: "click" as const,
          listener: focus,
        },
        {
          id,
          type: "wheel" as const,
          listener: async (event: { readonly wheelY: number }) => {
            focus();
            await move(event.wheelY);
          },
        },
      ],
      [focus, id, move],
    ),
  );
  useTerminalInput(
    async (_input, key) => {
      if (key.upArrow) await move(-1);
      else if (key.downArrow) await move(1);
      else if (key.pageUp) await move(-safeHeight);
      else if (key.pageDown) await move(safeHeight);
      else return false;
      return true;
    },
    { enabled: focused, priority: 1_510 },
  );
  const safeOffset = snapshot.position.y;
  const visibleLines = lines
    .slice(safeOffset, safeOffset + safeHeight)
    .map((line, index) => ({
      key: `${safeOffset + index}:${line}`,
      line,
    }));
  return (
    <SemanticBox
      flexDirection="column"
      height={safeHeight}
      id={id}
      role="application"
      label={label}
    >
      {visibleLines.map(({ key, line }) => (
        <Text key={key}>{line}</Text>
      ))}
    </SemanticBox>
  );
}
