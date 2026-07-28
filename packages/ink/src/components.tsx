import { useApp } from "@mwillbanks/tuil";
import {
  resolveTerminalViewport,
  type SemanticMetadata,
  type SemanticRole,
  type TerminalBounds,
  type TerminalViewport,
} from "@mwillbanks/tuil-core";
import { useFocusable } from "@mwillbanks/tuil-focus";
import { useHotkey, useHotkeys } from "@mwillbanks/tuil-hotkeys";
import type { LayoutNodeInput } from "@mwillbanks/tuil-renderer";
import {
  resolveComponentProps,
  resolveSlotProps,
  type SlottedComponentProps,
  type SpacingToken,
  useTheme,
} from "@mwillbanks/tuil-theme";
import {
  type DOMElement,
  Box as InkBox,
  type BoxProps as InkBoxProps,
  Text as InkText,
  type TextProps as InkTextProps,
  measureElement,
  useStdout,
} from "ink";
import {
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePointerEvent } from "./pointer.ts";
import {
  resolveSemanticNode,
  useSemanticNode,
  useSemanticRegistry,
} from "./semantics.ts";

const emptyHotkeys: readonly string[] = Object.freeze([]);

export interface CommonComponentProps extends SemanticMetadata {
  readonly variant?: string;
  readonly size?: "sm" | "md" | "lg";
  readonly unstyled?: boolean;
  readonly className?: string;
  readonly layout?: Partial<
    Omit<LayoutNodeInput, "id" | "semantics" | "children">
  >;
}

export interface TerminalSemanticNodeProps {
  readonly id: string;
  readonly role: SemanticRole;
  readonly label: string;
  readonly description?: string;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
  readonly valueText?: string;
  readonly metadata?: CommonComponentProps;
}

export function TerminalSemanticNode(props: TerminalSemanticNodeProps): null {
  useSemanticNode(
    useMemo(
      () =>
        resolveSemanticNode(
          {
            key: props.id,
            id: props.id,
            role: props.role,
            label: props.label,
            description: props.description,
            selected: props.selected,
            expanded: props.expanded,
            disabled: props.disabled,
            valueText: props.valueText,
          },
          props.metadata,
        ),
      [
        props.description,
        props.disabled,
        props.expanded,
        props.id,
        props.label,
        props.metadata,
        props.role,
        props.selected,
        props.valueText,
      ],
    ),
  );
  return null;
}

function semanticKey(id: string | undefined, generated: string): string {
  return id ?? generated;
}

function fallback<T>(value: T | undefined, defaultValue: T): T {
  return value === undefined ? defaultValue : value;
}

function semanticRegistration(
  node: SemanticMetadata & { readonly key: string },
  props: CommonComponentProps,
  measured: TerminalBounds | undefined,
  viewport: { readonly width: number; readonly height: number },
) {
  const layout: Partial<NonNullable<CommonComponentProps["layout"]>> =
    props.layout ?? {};
  const bounds = layout.bounds ?? measured;
  if (!bounds) return { ...node, layout: undefined };
  const role = node.role ?? "";
  return {
    ...node,
    layout: {
      parentId: layout.parentId,
      bounds,
      clip: fallback(layout.clip, { x: 0, y: 0, ...viewport }),
      zIndex: fallback(layout.zIndex, 0),
      focusable: fallback(
        layout.focusable,
        ["button", "checkbox", "link", "textbox"].includes(role),
      ),
      pointerEvents: fallback(layout.pointerEvents, "auto" as const),
      scrollContainerId: layout.scrollContainerId,
    },
  };
}

function useSemantics(
  props: CommonComponentProps,
  defaults: SemanticMetadata & { readonly text?: string },
): RefObject<DOMElement | null> {
  const app = useApp();
  const registry = useSemanticRegistry();
  const ref = useRef<DOMElement | null>(null);
  const generated = useId();
  const key = semanticKey(props.id, generated);
  const semanticDefaults = useMemo(
    () => ({
      id: defaults.id,
      testId: defaults.testId,
      role: defaults.role,
      label: defaults.label,
      description: defaults.description,
      disabled: defaults.disabled,
      readOnly: defaults.readOnly,
      selected: defaults.selected,
      checked: defaults.checked,
      expanded: defaults.expanded,
      valueText: defaults.valueText,
      text: defaults.text,
    }),
    [
      defaults.checked,
      defaults.description,
      defaults.disabled,
      defaults.expanded,
      defaults.id,
      defaults.label,
      defaults.readOnly,
      defaults.role,
      defaults.selected,
      defaults.testId,
      defaults.text,
      defaults.valueText,
    ],
  );
  const semanticProps = useMemo(
    () => ({
      id: props.id,
      testId: props.testId,
      role: props.role,
      label: props.label,
      description: props.description,
      disabled: props.disabled,
      readOnly: props.readOnly,
      selected: props.selected,
      checked: props.checked,
      expanded: props.expanded,
      valueText: props.valueText,
      layout: props.layout,
    }),
    [
      props.checked,
      props.description,
      props.disabled,
      props.expanded,
      props.id,
      props.label,
      props.layout,
      props.readOnly,
      props.role,
      props.selected,
      props.testId,
      props.valueText,
    ],
  );
  const node = useMemo(
    () => ({
      ...semanticDefaults,
      ...Object.fromEntries(
        Object.entries(semanticProps).filter(
          ([, value]) => value !== undefined,
        ),
      ),
      key,
      id: semanticProps.id ?? key,
    }),
    [key, semanticDefaults, semanticProps],
  );
  useLayoutEffect(() => {
    const measured = ref.current ? measureElement(ref.current) : undefined;
    return registry.register(
      semanticRegistration(node, semanticProps, measured, {
        width: app.capabilities.width,
        height: app.capabilities.height,
      }),
    );
  }, [
    app.capabilities.height,
    app.capabilities.width,
    node,
    registry,
    semanticProps,
  ]);
  return ref;
}

function useSpacing(
  value: number | SpacingToken | undefined,
): number | undefined {
  const theme = useTheme();
  return typeof value === "string" ? theme.spacing[value] : value;
}

type BoxSlots = {
  root: InkBoxProps;
};

export interface BoxProps
  extends Omit<InkBoxProps, "padding" | "margin">,
    CommonComponentProps,
    SlottedComponentProps<BoxSlots> {
  readonly padding?: number | SpacingToken;
  readonly margin?: number | SpacingToken;
  readonly children?: ReactNode;
}

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
  layout,
  ...props
}: BoxProps): ReactNode {
  const theme = useTheme();
  const semanticRef = useSemantics(
    {
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
      layout,
    },
    {},
  );
  const Root = slots?.root ?? InkBox;
  const customization = resolveComponentProps(
    "Box",
    { variant, size, unstyled, className },
    {},
    theme,
  );
  const resolved = resolveSlotProps(slotProps?.root, {}, theme);
  return (
    <Root
      ref={semanticRef}
      {...(customization as InkBoxProps)}
      {...props}
      {...resolved}
      padding={useSpacing(padding)}
      margin={useSpacing(margin)}
    >
      {children}
    </Root>
  );
}

export interface StackProps extends Omit<BoxProps, "gap"> {
  readonly direction?: "row" | "column";
  readonly gap?: number | SpacingToken;
}

export function Stack({
  direction = "column",
  gap,
  ...props
}: StackProps): ReactNode {
  return <Box flexDirection={direction} gap={useSpacing(gap)} {...props} />;
}

export function HStack(props: Omit<StackProps, "direction">): ReactNode {
  return <Stack direction="row" {...props} />;
}

export function VStack(props: Omit<StackProps, "direction">): ReactNode {
  return <Stack direction="column" {...props} />;
}

export interface ResponsiveStackProps extends Omit<StackProps, "direction"> {
  readonly directions?: Partial<
    Readonly<Record<TerminalViewport, StackProps["direction"]>>
  >;
}

export function useTerminalViewport(): TerminalViewport {
  const { width } = useTerminalSize();
  return resolveTerminalViewport(width);
}

export interface TerminalSize {
  readonly width: number;
  readonly height: number;
}

export function useTerminalSize(): TerminalSize {
  const app = useApp();
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => ({
    width: stdout.columns ?? app.capabilities.width,
    height: stdout.rows ?? app.capabilities.height,
  }));
  useEffect(() => {
    const updateSize = () => {
      setSize({
        width: stdout.columns ?? app.capabilities.width,
        height: stdout.rows ?? app.capabilities.height,
      });
    };
    updateSize();
    stdout.on("resize", updateSize);
    return () => {
      stdout.off("resize", updateSize);
    };
  }, [app.capabilities.height, app.capabilities.width, stdout]);
  return size;
}

export function ResponsiveStack({
  directions,
  ...props
}: ResponsiveStackProps): ReactNode {
  const viewport = useTerminalViewport();
  const direction =
    directions?.[viewport] ?? (viewport === "compact" ? "column" : "row");
  return <Stack direction={direction} {...props} />;
}

export interface ContainerProps extends BoxProps {
  readonly maxWidth?: number;
}

export function Container({
  maxWidth = 80,
  width = "100%",
  ...props
}: ContainerProps): ReactNode {
  return <Box width={width} maxWidth={maxWidth} {...props} />;
}

type TextSlots = {
  root: InkTextProps;
};

export interface TextProps
  extends InkTextProps,
    CommonComponentProps,
    SlottedComponentProps<TextSlots> {}

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
  layout,
  ...props
}: TextProps): ReactNode {
  const theme = useTheme();
  const value =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : undefined;
  const semanticRef = useSemantics(
    {
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
      layout,
    },
    { role: role ?? "text", text: value, label: label ?? value },
  );
  const Root = slots?.root ?? InkText;
  const customization = resolveComponentProps(
    "Text",
    { variant, size, unstyled, className },
    {},
    theme,
  );
  return (
    <InkBox ref={semanticRef}>
      <Root
        {...(customization as InkTextProps)}
        {...props}
        {...resolveSlotProps(slotProps?.root, {}, theme)}
      >
        {children}
      </Root>
    </InkBox>
  );
}

export interface HeadingProps extends TextProps {
  readonly level?: 1 | 2 | 3 | 4;
}

export function Heading({
  level = 1,
  children,
  ...props
}: HeadingProps): ReactNode {
  const theme = useTheme();
  const prefix = level === 1 ? "# " : `${"#".repeat(level)} `;
  return (
    <Text
      bold={theme.typography.headingBold}
      role="heading"
      label={typeof children === "string" ? children : props.label}
      {...props}
    >
      {prefix}
      {children}
    </Text>
  );
}

type DividerSlots = { root: TextProps };

export interface DividerProps
  extends CommonComponentProps,
    SlottedComponentProps<DividerSlots> {
  readonly width?: number;
  readonly orientation?: "horizontal" | "vertical";
  readonly title?: string;
}

export function Divider({
  width = 40,
  orientation = "horizontal",
  title,
  slots,
  slotProps,
  ...props
}: DividerProps): ReactNode {
  const theme = useTheme();
  const line = theme.borders.single[0];
  const content =
    orientation === "vertical"
      ? theme.borders.single[1]
      : title
        ? `${line.repeat(2)} ${title} ${line.repeat(Math.max(0, width - title.length - 4))}`
        : line.repeat(width);
  return (
    <Text
      {...props}
      slots={slots}
      slotProps={slotProps}
      label={props.label ?? title ?? "separator"}
    >
      {content}
    </Text>
  );
}

type ButtonSlots = {
  root: InkBoxProps;
  label: InkTextProps;
  prefix: InkTextProps;
  suffix: InkTextProps;
};

export interface ButtonProps
  extends CommonComponentProps,
    SlottedComponentProps<
      ButtonSlots,
      { readonly focused: boolean; readonly disabled: boolean }
    > {
  readonly children?: ReactNode;
  readonly onPress?: () => void | Promise<void>;
  readonly command?: string;
  readonly hotkeys?: readonly string[];
  readonly autoFocus?: boolean;
  readonly prefix?: ReactNode;
  readonly suffix?: ReactNode;
  readonly focusOrder?: number;
  readonly focusScopeId?: string;
}

export function Button({
  children,
  onPress,
  command,
  hotkeys = emptyHotkeys,
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
  const activate = useCallback(async () => {
    if (disabled || readOnly) return;
    if (command) {
      await app.commands.execute(command, { source: id });
    }
    await onPress?.();
  }, [app.commands, command, disabled, id, onPress, readOnly]);
  const activateFromPointer = useCallback(() => {
    void activate();
  }, [activate]);
  const enabled = !disabled && !readOnly;
  const isFocusedAndEnabled = useCallback(
    () => app.focus.focusedId === id && enabled,
    [app.focus, enabled, id],
  );
  const isEnabled = useCallback(() => enabled, [enabled]);
  const hotkeyOptions = useMemo(
    () => ({
      scope: "application" as const,
      priority: 100,
      enabled: isFocusedAndEnabled,
      title: label,
      commandId: command,
    }),
    [command, isFocusedAndEnabled, label],
  );
  const groupedHotkeys = useMemo(
    () => Object.fromEntries(hotkeys.map((keys) => [keys, activate])),
    [activate, hotkeys],
  );
  const groupedHotkeyOptions = useMemo(
    () => ({
      scope: "application" as const,
      enabled: isEnabled,
      title: label,
      commandId: command,
    }),
    [command, isEnabled, label],
  );
  const pointerOptions = useMemo(() => ({ enabled }), [enabled]);
  usePointerEvent(id, "click", activateFromPointer, pointerOptions);
  useHotkey("enter", activate, hotkeyOptions);
  useHotkey("space", activate, hotkeyOptions);
  useHotkeys(groupedHotkeys, groupedHotkeyOptions);
  const semanticRef = useSemantics(
    { ...props, id, label, disabled, readOnly, role: "button" },
    { role: "button", label },
  );
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
      ref={semanticRef}
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

type SpinnerSlots = { root: TextProps };

export interface SpinnerProps
  extends CommonComponentProps,
    SlottedComponentProps<SpinnerSlots> {
  readonly label?: string;
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
  const symbol =
    app.mode === "interactive"
      ? theme.motion.spinnerFrames[frame]
      : theme.icons.pending;
  return (
    <Text
      {...props}
      slots={slots}
      slotProps={slotProps}
      role="status"
      label={label}
    >
      {symbol} {label}
    </Text>
  );
}

type ProgressSlots = { root: TextProps };

export interface ProgressProps
  extends CommonComponentProps,
    SlottedComponentProps<
      ProgressSlots,
      { readonly percent: number; readonly complete: boolean }
    > {
  readonly value: number;
  readonly max?: number;
  readonly width?: number;
  readonly showValue?: boolean;
}

export function Progress({
  value,
  max = 100,
  width = 20,
  showValue = true,
  slots,
  slotProps,
  ...props
}: ProgressProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const complete = Math.round(width * ratio);
  const completeGlyph = app.capabilities.unicode ? "█" : "#";
  const remainingGlyph = app.capabilities.unicode ? "░" : "-";
  const percent = Math.round(ratio * 100);
  const rootSlotProps = resolveSlotProps(
    slotProps?.root,
    { percent, complete: ratio >= 1 },
    theme,
  );
  return (
    <Text
      {...props}
      slots={slots}
      slotProps={{ root: rootSlotProps }}
      role="progressbar"
      label={props.label ?? `${percent}%`}
      valueText={`${percent}%`}
      color={theme.colors.primary.foreground}
    >
      [
      {`${completeGlyph.repeat(complete)}${remainingGlyph.repeat(width - complete)}`}
      ]{showValue ? ` ${percent}%` : ""}
    </Text>
  );
}

export interface AlertProps
  extends PropsWithChildren<CommonComponentProps>,
    SlottedComponentProps<
      {
        root: BoxProps;
        icon: TextProps;
        title: TextProps;
        content: TextProps;
      },
      { readonly tone: "info" | "success" | "warning" | "danger" }
    > {
  readonly tone?: "info" | "success" | "warning" | "danger";
  readonly title?: string;
}

export function Alert({
  tone = "info",
  title,
  children,
  slots,
  slotProps,
  ...props
}: AlertProps): ReactNode {
  const theme = useTheme();
  const icon =
    tone === "success"
      ? theme.icons.success
      : tone === "warning"
        ? theme.icons.warning
        : tone === "danger"
          ? theme.icons.error
          : "i";
  const state = { tone };
  const Root = slots?.root ?? Box;
  const Icon = slots?.icon ?? Text;
  const Title = slots?.title ?? Text;
  const Content = slots?.content ?? Text;
  return (
    <Root
      {...props}
      borderStyle={props.unstyled ? undefined : "round"}
      borderColor={props.unstyled ? undefined : theme.colors[tone].border}
      padding={props.unstyled ? undefined : "sm"}
      role="alert"
      label={props.label ?? title}
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <Icon
        color={theme.colors[tone].foreground}
        {...resolveSlotProps(slotProps?.icon, state, theme)}
      >
        {icon}
      </Icon>
      {title ? (
        <Title
          bold
          color={theme.colors[tone].foreground}
          {...resolveSlotProps(slotProps?.title, state, theme)}
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

interface RegionProps extends BoxProps {
  readonly componentName: string;
}

function Region({ componentName, ...props }: RegionProps): ReactNode {
  const theme = useTheme();
  const defaults = theme.components[componentName]?.defaultProps ?? {};
  return <Box {...(defaults as InkBoxProps)} {...props} />;
}

export function AppBar(props: BoxProps): ReactNode {
  return <Region componentName="AppBar" flexDirection="row" {...props} />;
}

export function StatusBar(props: BoxProps): ReactNode {
  return (
    <Region
      componentName="StatusBar"
      flexDirection="row"
      role="status"
      {...props}
    />
  );
}

export function AppShell(props: BoxProps): ReactNode {
  return (
    <Region
      componentName="AppShell"
      flexDirection="column"
      role="application"
      {...props}
    />
  );
}

AppShell.AppBar = AppBar;
AppShell.Main = function Main(props: BoxProps): ReactNode {
  return <Region componentName="Main" flexGrow={1} {...props} />;
};
AppShell.StatusBar = StatusBar;
