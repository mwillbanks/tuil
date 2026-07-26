import type { ReactNode } from "react";
import { Box, type BoxProps } from "../primitives/box";
import { AppBar } from "./app-bar";
import { StatusBar } from "./status-bar";

function Main(props: BoxProps): ReactNode {
  return <Box flexGrow={1} {...props} />;
}

export function AppShell(props: BoxProps): ReactNode {
  return <Box flexDirection="column" role="application" {...props} />;
}

AppShell.AppBar = AppBar;
AppShell.Main = Main;
AppShell.StatusBar = StatusBar;
