import { useTheme } from "@mwillbanks/tuil-theme";
import type { ReactNode } from "react";
import { Text, type TextProps } from "./text";

export interface HeadingProps extends TextProps {
  readonly level?: 1 | 2 | 3 | 4;
}

export function Heading({
  level = 1,
  children,
  ...props
}: HeadingProps): ReactNode {
  const theme = useTheme();
  return (
    <Text
      bold={theme.typography.headingBold}
      role="heading"
      label={typeof children === "string" ? children : props.label}
      {...props}
    >
      {"#".repeat(level)} {children}
    </Text>
  );
}
