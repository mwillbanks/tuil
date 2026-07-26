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
import { diffLines as calculateLineChanges } from "diff";
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

export interface DiffLine {
  readonly id: string;
  readonly kind: "equal" | "added" | "removed";
  readonly value: string;
  readonly oldLine?: number;
  readonly newLine?: number;
}

export function createLineDiff(
  before: string,
  after: string,
): readonly DiffLine[] {
  const result: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const [changeIndex, change] of calculateLineChanges(
    before,
    after,
  ).entries()) {
    const kind = change.added ? "added" : change.removed ? "removed" : "equal";
    const lines = change.value.split("\n");
    if (change.value.endsWith("\n")) lines.pop();
    for (const [lineIndex, value] of lines.entries()) {
      result.push({
        id: `${changeIndex}:${lineIndex}:${kind}`,
        kind,
        value,
        oldLine: kind === "added" ? undefined : oldLine,
        newLine: kind === "removed" ? undefined : newLine,
      });
      if (kind !== "added") oldLine += 1;
      if (kind !== "removed") newLine += 1;
    }
  }
  return Object.freeze(result);
}

type DiffViewerSlots = {
  root: BoxProps;
  viewport: BoxProps;
  line: TextProps;
  status: TextProps;
};

export interface DiffViewerProps
  extends CommonComponentProps,
    SlottedComponentProps<
      DiffViewerSlots,
      { readonly focused: boolean; readonly activeLine: number }
    > {
  readonly before: string;
  readonly after: string;
  readonly height?: number;
  readonly width?: number;
  readonly context?: number;
  readonly staticLimit?: number;
  readonly autoFocus?: boolean;
}

function contextualDiff(
  lines: readonly DiffLine[],
  context: number | undefined,
): readonly DiffLine[] {
  if (context === undefined) return lines;
  const included = new Set<number>();
  for (const [index, line] of lines.entries()) {
    if (line.kind === "equal") continue;
    for (
      let candidate = Math.max(0, index - context);
      candidate <= Math.min(lines.length - 1, index + context);
      candidate += 1
    ) {
      included.add(candidate);
    }
  }
  return lines.filter((_line, index) => included.has(index));
}

export function DiffViewer({
  before,
  after,
  height = 15,
  width = 100,
  context,
  staticLimit = 2_000,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  ...props
}: DiffViewerProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const lines = useMemo(
    () => contextualDiff(createLineDiff(before, after), context),
    [after, before, context],
  );
  const [activeLine, setActiveLine] = useState(0);
  const [offset, setOffset] = useState(0);
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive,
        hidden: false,
        role: "status" as const,
        label: props.label ?? "Diff viewer",
      }),
      [disabled, id, interactive, props.label],
    ),
  );
  useEffect(() => {
    if (autoFocus && interactive) focus();
  }, [autoFocus, focus, interactive]);
  const move = useCallback(
    (next: number) => {
      const value = Math.min(lines.length - 1, Math.max(0, next));
      setActiveLine(Math.max(0, value));
      if (value < offset) setOffset(value);
      if (value >= offset + height) setOffset(value - height + 1);
    },
    [height, lines.length, offset],
  );
  useTerminalInput(
    async (_input, key) => {
      if (key.upArrow) {
        move(activeLine - 1);
        return true;
      }
      if (key.downArrow) {
        move(activeLine + 1);
        return true;
      }
      if (key.pageUp) {
        move(activeLine - height);
        return true;
      }
      if (key.pageDown) {
        move(activeLine + height);
        return true;
      }
      if (key.home) {
        move(0);
        return true;
      }
      if (key.end) {
        move(lines.length - 1);
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_500 },
  );
  const range = useTerminalVirtualizer({
    count: lines.length,
    viewportSize: height,
    scrollOffset: offset,
    overscan: 0,
  });
  const indexes = interactive
    ? getVisibleTerminalIndexes(range)
    : [...lines.keys()].slice(0, Math.max(0, staticLimit));
  const additions = lines.filter((line) => line.kind === "added").length;
  const removals = lines.filter((line) => line.kind === "removed").length;
  const state = { focused, activeLine };
  const Root = slots?.root ?? Box;
  const Viewport = slots?.viewport ?? Box;
  const Line = slots?.line ?? Text;
  const Status = slots?.status ?? Text;
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticNode
        id={id}
        role="status"
        label={props.label ?? "Diff viewer"}
        valueText={`${additions} additions, ${removals} removals`}
        metadata={{ ...props, disabled }}
      />
      <Viewport
        flexDirection="column"
        height={interactive ? height : undefined}
        overflow="hidden"
        {...resolveSlotProps(slotProps?.viewport, state, theme)}
      >
        {indexes.map((index) => {
          const line = lines[index];
          if (!line) return null;
          const marker =
            line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
          const number = `${line.oldLine ?? " "}:${line.newLine ?? " "}`;
          return (
            <Line
              key={line.id}
              inverse={focused && index === activeLine}
              color={
                line.kind === "added"
                  ? theme.colors.success.foreground
                  : line.kind === "removed"
                    ? theme.colors.danger.foreground
                    : undefined
              }
              {...resolveSlotProps(slotProps?.line, state, theme)}
            >
              {fitTerminalText(
                `${number.padStart(9)} ${marker} ${line.value}`,
                width,
              )}
            </Line>
          );
        })}
      </Viewport>
      <Status dimColor {...resolveSlotProps(slotProps?.status, state, theme)}>
        +{additions} -{removals}
      </Status>
    </Root>
  );
}
