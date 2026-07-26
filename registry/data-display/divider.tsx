import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import type { ReactNode } from "react";
import { Text, type TextProps } from "./text";

export interface DividerProps
  extends SlottedComponentProps<{ root: TextProps }> {
  readonly id?: string;
  readonly testId?: string;
  readonly label?: string;
  readonly width?: number;
  readonly orientation?: "horizontal" | "vertical";
  readonly title?: string;
}

export function Divider({
  width = 40,
  orientation = "horizontal",
  title,
  slots,
  slotProps,
  ...props
}: DividerProps): ReactNode {
  const theme = useTheme();
  const Root = slots?.root ?? Text;
  const line = theme.borders.single[0];
  const content =
    orientation === "vertical"
      ? theme.borders.single[1]
      : title
        ? `${line.repeat(2)} ${title} ${line.repeat(Math.max(0, width - title.length - 4))}`
        : line.repeat(width);
  return (
    <Root
      {...props}
      {...resolveSlotProps(slotProps?.root, {}, theme)}
      label={props.label ?? title ?? "separator"}
    >
      {content}
    </Root>
  );
}
