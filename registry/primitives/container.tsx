import type { ReactNode } from "react";
import { Box, type BoxProps } from "./box";

export interface ContainerProps extends BoxProps {
  readonly maxWidth?: number;
}

export function Container({
  maxWidth = 80,
  width = "100%",
  ...props
}: ContainerProps): ReactNode {
  return <Box width={width} maxWidth={maxWidth} {...props} />;
}
