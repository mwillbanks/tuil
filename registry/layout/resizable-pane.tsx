import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  TerminalSemanticNode,
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

type ResizablePaneSlots = {
  root: BoxProps;
  content: BoxProps;
  handle: TextProps;
};

export interface ResizablePaneProps
  extends CommonComponentProps,
    SlottedComponentProps<
      ResizablePaneSlots,
      { readonly focused: boolean; readonly size: number }
    > {
  readonly children?: ReactNode;
  readonly direction?: "horizontal" | "vertical";
  readonly extent?: number;
  readonly defaultExtent?: number;
  readonly minSize?: number;
  readonly maxSize?: number;
  readonly resizeStep?: number;
  readonly onSizeChange?: (size: number) => void | Promise<void>;
  readonly autoFocus?: boolean;
}

export function ResizablePane({
  children,
  direction = "horizontal",
  extent,
  defaultExtent = 40,
  minSize = 1,
  maxSize = 200,
  resizeStep = 1,
  onSizeChange,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  ...props
}: ResizablePaneProps): ReactNode {
  if (
    !Number.isFinite(minSize) ||
    !Number.isFinite(maxSize) ||
    minSize < 0 ||
    maxSize < minSize
  ) {
    throw new RangeError("ResizablePane requires 0 <= minSize <= maxSize");
  }
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const [internal, setInternal] = useState(defaultExtent);
  const current = Math.min(maxSize, Math.max(minSize, extent ?? internal));
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive,
        hidden: false,
        role: "application" as const,
        label: props.label ?? "Resizable pane",
      }),
      [disabled, id, interactive, props.label],
    ),
  );
  useEffect(() => {
    if (autoFocus && interactive) focus();
  }, [autoFocus, focus, interactive]);
  const resize = useCallback(
    async (next: number) => {
      if (readOnly) return;
      const value = Math.min(maxSize, Math.max(minSize, Math.floor(next)));
      if (extent === undefined) setInternal(value);
      await onSizeChange?.(value);
    },
    [extent, maxSize, minSize, onSizeChange, readOnly],
  );
  useTerminalInput(
    async (input, key) => {
      const decrease = direction === "horizontal" ? key.leftArrow : key.upArrow;
      const increase =
        direction === "horizontal" ? key.rightArrow : key.downArrow;
      if (decrease || input === "-") {
        await resize(current - Math.abs(resizeStep));
        return true;
      }
      if (increase || input === "+") {
        await resize(current + Math.abs(resizeStep));
        return true;
      }
      if (key.home) {
        await resize(minSize);
        return true;
      }
      if (key.end) {
        await resize(maxSize);
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_530 },
  );
  const state = { focused, size: current };
  const Root = slots?.root ?? Box;
  const Content = slots?.content ?? Box;
  const Handle = slots?.handle ?? Text;
  return (
    <Root
      flexDirection={direction === "horizontal" ? "row" : "column"}
      width={direction === "horizontal" ? current : undefined}
      height={direction === "vertical" ? current : undefined}
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <TerminalSemanticNode
        id={id}
        role="application"
        label={props.label ?? "Resizable pane"}
        valueText={`${current} cells`}
        metadata={{ ...props, disabled, readOnly }}
      />
      <Content
        flexGrow={1}
        overflow="hidden"
        {...resolveSlotProps(slotProps?.content, state, theme)}
      >
        {children}
      </Content>
      <Handle
        inverse={focused}
        bold={focused}
        {...resolveSlotProps(slotProps?.handle, state, theme)}
      >
        <TerminalSemanticNode
          id={`${id}:handle`}
          role="button"
          label={`Resize ${props.label ?? "pane"}`}
          selected={focused}
          disabled={disabled || readOnly}
          valueText={`${current} cells`}
        />
        {direction === "horizontal"
          ? app.capabilities.unicode
            ? "│"
            : "|"
          : app.capabilities.unicode
            ? "─"
            : "-"}
      </Handle>
    </Root>
  );
}
