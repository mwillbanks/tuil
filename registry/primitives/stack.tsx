import { type SpacingToken, useTheme } from "@mwillbanks/tuil-theme";
import type { ReactNode } from "react";
import { Box, type BoxProps } from "./box";

export interface StackProps extends Omit<BoxProps, "gap"> {
  readonly direction?: "row" | "column";
  readonly gap?: number | SpacingToken;
}

export function Stack({
  direction = "column",
  gap,
  ...props
}: StackProps): ReactNode {
  const theme = useTheme();
  return (
    <Box
      flexDirection={direction}
      gap={typeof gap === "string" ? theme.spacing[gap] : gap}
      {...props}
    />
  );
}

export function HStack(props: Omit<StackProps, "direction">): ReactNode {
  return <Stack direction="row" {...props} />;
}

export function VStack(props: Omit<StackProps, "direction">): ReactNode {
  return <Stack direction="column" {...props} />;
}
