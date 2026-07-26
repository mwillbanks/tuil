import {
  type TextProps as TuilTextProps,
  useSemanticNode,
} from "@mwillbanks/tuil-ink";
import {
  resolveComponentProps,
  resolveSlotProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import { Text as InkText } from "ink";
import { type ReactNode, useId, useMemo } from "react";

export type TextProps = TuilTextProps;

export function Text({
  slots,
  slotProps,
  children,
  id,
  testId,
  role,
  label,
  description,
  disabled,
  readOnly,
  selected,
  checked,
  expanded,
  valueText,
  unstyled,
  variant,
  size,
  className,
  ...props
}: TextProps): ReactNode {
  const theme = useTheme();
  const generated = useId();
  const key = id ?? generated;
  const text =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : undefined;
  const semantics = useMemo(
    () => ({
      key,
      id: id ?? key,
      testId,
      role: role ?? "text",
      label: label ?? text,
      text,
      description,
      disabled,
      readOnly,
      selected,
      checked,
      expanded,
      valueText,
    }),
    [
      checked,
      description,
      disabled,
      expanded,
      id,
      key,
      label,
      readOnly,
      role,
      selected,
      testId,
      text,
      valueText,
    ],
  );
  useSemanticNode(semantics);
  const Root = slots?.root ?? InkText;
  const customization = resolveComponentProps(
    "Text",
    { variant, size, unstyled, className },
    {},
    theme,
  );
  return (
    <Root
      {...(customization as TuilTextProps)}
      {...props}
      {...resolveSlotProps(slotProps?.root, {}, theme)}
    >
      {children}
    </Root>
  );
}
