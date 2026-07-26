import {
  type BoxProps as TuilBoxProps,
  useSemanticNode,
} from "@mwillbanks/tuil-ink";
import {
  resolveComponentProps,
  resolveSlotProps,
  type SpacingToken,
  useTheme,
} from "@mwillbanks/tuil-theme";
import { Box as InkBox } from "ink";
import { type ReactNode, useId, useMemo } from "react";

export type BoxProps = TuilBoxProps;

export function Box({
  slots,
  slotProps,
  padding,
  margin,
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
}: BoxProps): ReactNode {
  const theme = useTheme();
  const generated = useId();
  const key = id ?? generated;
  const semantics = useMemo(
    () => ({
      key,
      id: id ?? key,
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
      valueText,
    ],
  );
  useSemanticNode(semantics);
  const Root = slots?.root ?? InkBox;
  const customization = resolveComponentProps(
    "Box",
    { variant, size, unstyled, className },
    {},
    theme,
  );
  const resolveSpacing = (value: number | SpacingToken | undefined) =>
    typeof value === "string" ? theme.spacing[value] : value;
  return (
    <Root
      {...(customization as TuilBoxProps)}
      {...props}
      {...resolveSlotProps(slotProps?.root, {}, theme)}
      padding={resolveSpacing(padding)}
      margin={resolveSpacing(margin)}
    >
      {children}
    </Root>
  );
}
