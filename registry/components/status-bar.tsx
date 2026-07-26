import type { ReactNode } from "react";
import { Box, type BoxProps } from "../primitives/box";

export function StatusBar(props: BoxProps): ReactNode {
  return <Box flexDirection="row" role="status" {...props} />;
}
