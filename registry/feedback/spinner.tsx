import { useApp } from "@mwillbanks/tuil";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import { type ReactNode, useEffect, useState } from "react";
import { Text, type TextProps } from "../data-display/text";

export interface SpinnerProps
  extends SlottedComponentProps<{ root: TextProps }> {
  readonly id?: string;
  readonly testId?: string;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}

export function Spinner({
  label = "Loading",
  slots,
  slotProps,
  ...props
}: SpinnerProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (app.mode !== "interactive" || !theme.motion.enabled) return;
    const timer = setInterval(
      () =>
        setFrame((value) => (value + 1) % theme.motion.spinnerFrames.length),
      theme.motion.interval,
    );
    return () => clearInterval(timer);
  }, [app.mode, theme]);
  const Root = slots?.root ?? Text;
  const symbol =
    app.mode === "interactive"
      ? theme.motion.spinnerFrames[frame]
      : theme.icons.pending;
  return (
    <Root
      {...props}
      {...resolveSlotProps(slotProps?.root, {}, theme)}
      role="status"
      label={label}
    >
      {symbol} {label}
    </Root>
  );
}
