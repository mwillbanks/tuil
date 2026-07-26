import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import type { ReactNode } from "react";
import { Text, type TextProps } from "../data-display/text";
import { Box, type BoxProps } from "../primitives/box";

type Tone = "info" | "success" | "warning" | "danger";

export interface AlertProps
  extends SlottedComponentProps<
    {
      root: BoxProps;
      icon: TextProps;
      title: TextProps;
      content: TextProps;
    },
    { readonly tone: Tone }
  > {
  readonly id?: string;
  readonly testId?: string;
  readonly label?: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly tone?: Tone;
  readonly title?: string;
  readonly children?: ReactNode;
}

export function Alert({
  tone = "info",
  title,
  children,
  slots,
  slotProps,
  unstyled,
  ...props
}: AlertProps): ReactNode {
  const theme = useTheme();
  const state = { tone };
  const Root = slots?.root ?? Box;
  const Icon = slots?.icon ?? Text;
  const Title = slots?.title ?? Text;
  const Content = slots?.content ?? Text;
  const icon =
    tone === "success"
      ? theme.icons.success
      : tone === "warning"
        ? theme.icons.warning
        : tone === "danger"
          ? theme.icons.error
          : "i";
  return (
    <Root
      {...props}
      {...resolveSlotProps(slotProps?.root, state, theme)}
      borderStyle={unstyled ? undefined : "round"}
      borderColor={unstyled ? undefined : theme.colors[tone].border}
      padding={unstyled ? undefined : "sm"}
      role="alert"
      label={props.label ?? title}
    >
      <Icon
        {...resolveSlotProps(slotProps?.icon, state, theme)}
        color={theme.colors[tone].foreground}
      >
        {icon}
      </Icon>
      {title ? (
        <Title
          {...resolveSlotProps(slotProps?.title, state, theme)}
          bold
          color={theme.colors[tone].foreground}
        >
          {title}
        </Title>
      ) : null}
      {children ? (
        <Content {...resolveSlotProps(slotProps?.content, state, theme)}>
          {children}
        </Content>
      ) : null}
    </Root>
  );
}
