import { useApp } from "@mwillbanks/tuil";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import type { ReactNode } from "react";
import { Text, type TextProps } from "../data-display/text";

interface ProgressState {
  readonly percent: number;
  readonly complete: boolean;
}

export interface ProgressProps
  extends SlottedComponentProps<{ root: TextProps }, ProgressState> {
  readonly id?: string;
  readonly testId?: string;
  readonly label?: string;
  readonly value: number;
  readonly max?: number;
  readonly width?: number;
  readonly showValue?: boolean;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}

export function Progress({
  value,
  max = 100,
  width = 20,
  showValue = true,
  slots,
  slotProps,
  ...props
}: ProgressProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const completeCells = Math.round(width * ratio);
  const percent = Math.round(ratio * 100);
  const completeGlyph = app.capabilities.unicode ? "█" : "#";
  const remainingGlyph = app.capabilities.unicode ? "░" : "-";
  const Root = slots?.root ?? Text;
  return (
    <Root
      {...props}
      {...resolveSlotProps(
        slotProps?.root,
        { percent, complete: ratio >= 1 },
        theme,
      )}
      role="progressbar"
      label={props.label ?? `${percent}%`}
      valueText={`${percent}%`}
      color={theme.colors.primary.foreground}
    >
      [
      {`${completeGlyph.repeat(completeCells)}${remainingGlyph.repeat(width - completeCells)}`}
      ]{showValue ? ` ${percent}%` : ""}
    </Root>
  );
}
