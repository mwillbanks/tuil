import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
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

function SemanticPaneNode(props: {
  readonly id: string;
  readonly role: "application" | "button";
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

function resolvePaneSizes(
  panes: readonly SplitPaneItem[],
  sizes: readonly number[] | undefined,
): readonly number[] {
  const count = panes.length;
  if (count === 0) return Object.freeze([]);
  const source =
    sizes?.length === count ? sizes : Array.from({ length: count }, () => 1);
  const positive = source.map((size) =>
    Number.isFinite(size) ? Math.max(0, size) : 0,
  );
  const total = positive.reduce((sum, size) => sum + size, 0);
  const normalized =
    total === 0
      ? Array.from({ length: count }, () => 100 / count)
      : positive.map((size) => (size / total) * 100);
  const minimums = panes.map((pane) => {
    const minimum = pane.minSize ?? 0;
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
      throw new RangeError(
        `Pane "${pane.id}" requires a minSize between 0 and 100`,
      );
    }
    return minimum;
  });
  const maximums = panes.map((pane, index) => {
    const maximum = pane.maxSize ?? 100;
    if (!Number.isFinite(maximum) || maximum < 0 || maximum > 100) {
      throw new RangeError(
        `Pane "${pane.id}" requires a maxSize between 0 and 100`,
      );
    }
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
  const result = normalized.map((size, index) =>
    Math.min(maximums[index] ?? 100, Math.max(minimums[index] ?? 0, size)),
  );
  for (let pass = 0; pass < count * 2; pass += 1) {
    const delta = 100 - result.reduce((sum, value) => sum + value, 0);
    if (Math.abs(delta) < 0.000_001) break;
    const candidates = result
      .map((_value, index) => index)
      .filter((index) =>
        delta > 0
          ? (result[index] ?? 0) < (maximums[index] ?? 100)
          : (result[index] ?? 0) > (minimums[index] ?? 0),
      );
    if (candidates.length === 0) {
      throw new RangeError("Split pane constraints cannot total 100%");
    }
    const share = delta / candidates.length;
    for (const index of candidates) {
      result[index] = Math.min(
        maximums[index] ?? 100,
        Math.max(minimums[index] ?? 0, (result[index] ?? 0) + share),
      );
    }
  }
  return Object.freeze(result);
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
    async (delta: number) => {
      const left = panes[activeDivider];
      const right = panes[activeDivider + 1];
      if (!left || !right || readOnly) return;
      const next = [...resolvedSizes];
      const leftMinimum = Math.max(0, left.minSize ?? 0);
      const rightMinimum = Math.max(0, right.minSize ?? 0);
      const leftMaximum = Math.min(100, left.maxSize ?? 100);
      const rightMaximum = Math.min(100, right.maxSize ?? 100);
      const applied = Math.max(
        leftMinimum - (next[activeDivider] ?? 0),
        (next[activeDivider + 1] ?? 0) - rightMaximum,
        Math.min(
          leftMaximum - (next[activeDivider] ?? 0),
          (next[activeDivider + 1] ?? 0) - rightMinimum,
          delta,
        ),
      );
      next[activeDivider] = (next[activeDivider] ?? 0) + applied;
      next[activeDivider + 1] = (next[activeDivider + 1] ?? 0) - applied;
      await setSizes(next);
    },
    [activeDivider, panes, readOnly, resolvedSizes, setSizes],
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
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticPaneNode
        id={id}
        role="application"
        label={props.label ?? "Split pane"}
        valueText={resolvedSizes
          .map((size) => `${Math.round(size)}%`)
          .join(", ")}
        metadata={{ ...props, disabled, readOnly }}
      />
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
              <Divider
                bold={focused && index === activeDivider}
                inverse={focused && index === activeDivider}
                {...resolveSlotProps(slotProps?.divider, state, theme)}
              >
                <SemanticPaneNode
                  id={`${id}:divider:${pane.id}`}
                  role="button"
                  label={`Resize ${pane.id}`}
                  selected={index === activeDivider}
                  disabled={disabled || readOnly}
                  valueText={`${Math.round(resolvedSizes[index] ?? 0)}%`}
                />
                {orientation === "horizontal"
                  ? app.capabilities.unicode
                    ? "│"
                    : "|"
                  : app.capabilities.unicode
                    ? "─"
                    : "-"}
              </Divider>
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
  );
}
