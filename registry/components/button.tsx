import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import { useHotkey, useHotkeys } from "@mwillbanks/tuil-hotkeys";
import {
  type ButtonProps as TuilButtonProps,
  useSemanticNode,
} from "@mwillbanks/tuil-ink";
import {
  resolveComponentProps,
  resolveSlotProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import {
  Box as InkBox,
  type BoxProps as InkBoxProps,
  Text as InkText,
} from "ink";
import { type ReactNode, useEffect, useId, useMemo } from "react";

export type ButtonProps = TuilButtonProps;

export function Button({
  children,
  onPress,
  command,
  hotkeys = [],
  autoFocus,
  focusOrder,
  focusScopeId,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  prefix,
  suffix,
  variant = "solid",
  size,
  unstyled,
  className,
  ...props
}: ButtonProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const label = props.label ?? (typeof children === "string" ? children : id);
  const focusable = useMemo(
    () => ({
      id,
      scopeId: focusScopeId,
      disabled,
      hidden: false,
      order: focusOrder,
      role: "button",
      label,
    }),
    [disabled, focusOrder, focusScopeId, id, label],
  );
  const { focused, focus } = useFocusable(focusable);
  useEffect(() => {
    if (autoFocus) focus();
  }, [autoFocus, focus]);
  const activate = async () => {
    if (disabled || readOnly) return;
    if (command) {
      await app.commands.execute(command, { source: id });
    }
    await onPress?.();
  };
  useHotkey("enter", activate, {
    scope: "application",
    priority: 100,
    enabled: () => app.focus.focusedId === id && !disabled && !readOnly,
    title: label,
    commandId: command,
  });
  useHotkey("space", activate, {
    scope: "application",
    priority: 100,
    enabled: () => app.focus.focusedId === id && !disabled && !readOnly,
    title: label,
    commandId: command,
  });
  useHotkeys(Object.fromEntries(hotkeys.map((keys) => [keys, activate])), {
    scope: "application",
    enabled: () => !disabled && !readOnly,
    title: label,
    commandId: command,
  });
  const semanticNode = useMemo(
    () => ({
      key: id,
      id,
      testId: props.testId,
      role: "button" as const,
      label,
      description: props.description,
      disabled,
      readOnly,
    }),
    [disabled, id, label, props.description, props.testId, readOnly],
  );
  useSemanticNode(semanticNode);
  const state = { focused, disabled };
  const Root = slots?.root ?? InkBox;
  const Label = slots?.label ?? InkText;
  const Prefix = slots?.prefix ?? InkText;
  const Suffix = slots?.suffix ?? InkText;
  const color =
    variant === "danger"
      ? theme.colors.danger.foreground
      : theme.colors.primary.foreground;
  const marker =
    app.mode === "interactive"
      ? focused
        ? app.capabilities.unicode
          ? "▶"
          : ">"
        : " "
      : "-";
  const customization = resolveComponentProps(
    "Button",
    { variant, size, unstyled, className },
    state,
    theme,
  );
  return (
    <Root
      {...(customization as InkBoxProps)}
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <Prefix {...resolveSlotProps(slotProps?.prefix, state, theme)}>
        {prefix ?? marker}
      </Prefix>
      <Label
        color={disabled ? theme.colors.muted : color}
        bold={focused}
        dimColor={disabled}
        {...resolveSlotProps(slotProps?.label, state, theme)}
      >
        {app.mode === "interactive"
          ? `[ ${children} ]`
          : String(children ?? label)}
      </Label>
      {suffix ? (
        <Suffix {...resolveSlotProps(slotProps?.suffix, state, theme)}>
          {suffix}
        </Suffix>
      ) : null}
    </Root>
  );
}
