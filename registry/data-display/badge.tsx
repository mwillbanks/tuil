import { useTheme } from "@mwillbanks/tuil-theme";
import type { ReactNode } from "react";
import { Text, type TextProps } from "./text";

export interface BadgeProps extends TextProps {
  readonly tone?: "neutral" | "success" | "warning" | "danger" | "info";
}

export function Badge({
  tone = "neutral",
  children,
  ...props
}: BadgeProps): ReactNode {
  const theme = useTheme();
  const color =
    tone === "neutral" ? theme.colors.muted : theme.colors[tone].foreground;
  return (
    <Text color={color} {...props}>
      [{children}]
    </Text>
  );
}
