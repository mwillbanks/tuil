import type { ReactNode } from "react";
import { Box, type BoxProps } from "../primitives/box";

export function AppBar(props: BoxProps): ReactNode {
  return <Box flexDirection="row" {...props} />;
}
