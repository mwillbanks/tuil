import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  useSemanticNode,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly command?: string;
  readonly content?: ReactNode;
  readonly items?: readonly NavigationItem[];
}

function enabledIndex(
  items: readonly { readonly disabled?: boolean }[],
  start: number,
  direction: 1 | -1,
): number {
  if (items.length === 0) return -1;
  for (let offset = 1; offset <= items.length; offset += 1) {
    const index = (start + direction * offset + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return start;
}

function edgeIndex(
  items: readonly { readonly disabled?: boolean }[],
  fromEnd: boolean,
): number {
  const indexes = [...items.keys()];
  if (fromEnd) indexes.reverse();
  return indexes.find((index) => !items[index]?.disabled) ?? -1;
}

function SemanticItem(props: {
  readonly id: string;
  readonly role: "tab" | "menuitem" | "button";
  readonly label: string;
  readonly description?: string;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
}): null {
  useSemanticNode(
    useMemo(
      () => ({
        key: props.id,
        id: props.id,
        role: props.role,
        label: props.label,
        description: props.description,
        selected: props.selected,
        expanded: props.expanded,
        disabled: props.disabled,
      }),
      [props],
    ),
  );
  return null;
}

function SemanticContainer(props: {
  readonly id: string;
  readonly role: "navigation" | "menu" | "tabpanel" | "status";
  readonly label: string;
  readonly valueText?: string;
  readonly children?: ReactNode;
}): ReactNode {
  useSemanticNode(
    useMemo(
      () => ({
        key: props.id,
        id: props.id,
        role: props.role,
        label: props.label,
        valueText: props.valueText,
      }),
      [props.id, props.label, props.role, props.valueText],
    ),
  );
  return props.children;
}

type NavigationSlots = {
  root: BoxProps;
  list: BoxProps;
  item: TextProps;
  panel: BoxProps;
};

type NavigationListSlots = Omit<NavigationSlots, "panel">;

export interface TabsProps
  extends CommonComponentProps,
    SlottedComponentProps<NavigationSlots> {
  readonly items: readonly NavigationItem[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void | Promise<void>;
  readonly activationMode?: "automatic" | "manual";
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  activationMode = "automatic",
  slots,
  slotProps,
  disabled = false,
  ...props
}: TabsProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const first = edgeIndex(items, false);
  const fallback = items[first]?.id ?? "";
  const [internal, setInternal] = useState(defaultValue ?? fallback);
  const selected = value ?? internal;
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selected),
  );
  const [active, setActive] = useState(selectedIndex);
  const activeRef = useRef(active);
  activeRef.current = active;
  const { focused } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: false,
        role: "tab",
        label: props.label ?? "Tabs",
      }),
      [disabled, id, props.label],
    ),
  );
  useEffect(() => setActive(selectedIndex), [selectedIndex]);
  const select = useCallback(
    async (index: number) => {
      const item = items[index];
      if (!item || item.disabled || disabled) return;
      setActive(index);
      if (value === undefined) setInternal(item.id);
      await onValueChange?.(item.id);
    },
    [disabled, items, onValueChange, value],
  );
  const move = useCallback(
    async (direction: 1 | -1) => {
      const next = enabledIndex(items, activeRef.current, direction);
      if (next < 0) return;
      setActive(next);
      if (activationMode === "automatic") await select(next);
    },
    [activationMode, items, select],
  );
  useTerminalInput(
    async (input, key) => {
      if (key.leftArrow || key.upArrow || input === "h" || input === "k") {
        await move(-1);
        return true;
      }
      if (key.rightArrow || key.downArrow || input === "l" || input === "j") {
        await move(1);
        return true;
      }
      if (key.return || input === " ") {
        await select(activeRef.current);
        return true;
      }
      if (input === "g") {
        const next = edgeIndex(items, false);
        if (next >= 0) await select(next);
        return true;
      }
      if (input === "G") {
        const next = edgeIndex(items, true);
        if (next >= 0) await select(next);
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_500 },
  );
  const Root = slots?.root ?? Box;
  const List = slots?.list ?? Box;
  const Item = slots?.item ?? Text;
  const Panel = slots?.panel ?? Box;
  const state = { focused, disabled };
  const selectedItem = items.find((item) => item.id === selected);
  return (
    <SemanticContainer id={id} role="navigation" label={props.label ?? "Tabs"}>
      <Root
        flexDirection="column"
        {...resolveSlotProps(slotProps?.root, state, theme)}
      >
        <List
          flexDirection="row"
          gap={1}
          {...resolveSlotProps(slotProps?.list, state, theme)}
        >
          {items.map((item, index) => (
            <Item
              key={item.id}
              bold={focused && index === active}
              underline={item.id === selected}
              dimColor={item.disabled}
              color={
                item.id === selected
                  ? theme.colors.primary.foreground
                  : undefined
              }
              {...resolveSlotProps(slotProps?.item, state, theme)}
            >
              <SemanticItem
                id={`${id}:tab:${item.id}`}
                role="tab"
                label={item.label}
                description={item.description}
                selected={item.id === selected}
                disabled={item.disabled}
              />
              {app.mode === "interactive" && focused && index === active
                ? app.capabilities.unicode
                  ? "▶ "
                  : "> "
                : ""}
              {item.label}
            </Item>
          ))}
        </List>
        <SemanticContainer
          id={`${id}:panel:${selected}`}
          role="tabpanel"
          label={selectedItem?.label ?? selected}
        >
          <Panel {...resolveSlotProps(slotProps?.panel, state, theme)}>
            {typeof selectedItem?.content === "string" ||
            typeof selectedItem?.content === "number" ? (
              <Text>{selectedItem.content}</Text>
            ) : (
              selectedItem?.content
            )}
          </Panel>
        </SemanticContainer>
        {app.mode === "interactive" && !focused ? (
          <Text dimColor>Tab to focus</Text>
        ) : null}
      </Root>
    </SemanticContainer>
  );
}

export interface MenuProps
  extends CommonComponentProps,
    SlottedComponentProps<NavigationListSlots> {
  readonly items: readonly NavigationItem[];
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void | Promise<void>;
  readonly onSelect?: (item: NavigationItem) => void | Promise<void>;
}

export function Menu({
  items,
  open,
  defaultOpen = true,
  onOpenChange,
  onSelect,
  slots,
  slotProps,
  disabled = false,
  ...props
}: MenuProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const expanded = open ?? internalOpen;
  const [activePath, setActivePath] = useState<readonly number[]>([
    Math.max(0, edgeIndex(items, false)),
  ]);
  const pathRef = useRef(activePath);
  pathRef.current = activePath;
  const currentItems =
    pathRef.current
      .slice(0, -1)
      .reduce<readonly NavigationItem[]>(
        (list, index) => list[index]?.items ?? [],
        items,
      ) ?? items;
  const { focused } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: !expanded,
        role: "menu",
        label: props.label ?? "Menu",
      }),
      [disabled, expanded, id, props.label],
    ),
  );
  const setOpen = useCallback(
    async (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      await onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const activate = useCallback(async () => {
    const item = currentItems[pathRef.current.at(-1) ?? 0];
    if (!item || item.disabled) return;
    if (item.items?.length) {
      const firstChild = edgeIndex(item.items, false);
      setActivePath([...pathRef.current, Math.max(0, firstChild)]);
      return;
    }
    if (item.command) {
      await app.commands.execute(item.command, { source: id });
    }
    await onSelect?.(item);
    await setOpen(false);
  }, [app.commands, currentItems, id, onSelect, setOpen]);
  useTerminalInput(
    async (input, key) => {
      const path = pathRef.current;
      const index = path.at(-1) ?? 0;
      if (key.upArrow || input === "k") {
        setActivePath([
          ...path.slice(0, -1),
          enabledIndex(currentItems, index, -1),
        ]);
        return true;
      }
      if (key.downArrow || input === "j") {
        setActivePath([
          ...path.slice(0, -1),
          enabledIndex(currentItems, index, 1),
        ]);
        return true;
      }
      if (key.rightArrow || key.return || input === "l" || input === " ") {
        await activate();
        return true;
      }
      if (key.leftArrow || input === "h") {
        if (path.length > 1) setActivePath(path.slice(0, -1));
        else await setOpen(false);
        return true;
      }
      if (key.escape) {
        await setOpen(false);
        return true;
      }
      return false;
    },
    { enabled: focused && expanded && !disabled, priority: 1_600 },
  );
  if (!expanded) return null;
  const Root = slots?.root ?? Box;
  const List = slots?.list ?? Box;
  const Item = slots?.item ?? Text;
  const state = { focused, disabled };
  return (
    <SemanticContainer id={id} role="menu" label={props.label ?? "Menu"}>
      <Root {...resolveSlotProps(slotProps?.root, state, theme)}>
        <List
          flexDirection="column"
          {...resolveSlotProps(slotProps?.list, state, theme)}
        >
          {currentItems.map((item, index) => (
            <Item
              key={item.id}
              bold={focused && index === activePath.at(-1)}
              dimColor={item.disabled}
              {...resolveSlotProps(slotProps?.item, state, theme)}
            >
              <SemanticItem
                id={`${id}:item:${item.id}`}
                role="menuitem"
                label={item.label}
                description={item.description}
                disabled={item.disabled}
                expanded={item.items ? index === activePath.at(-1) : undefined}
              />
              {focused && index === activePath.at(-1) ? "> " : "  "}
              {item.label}
              {item.command ? ` (${item.command})` : ""}
              {item.items ? " >" : ""}
            </Item>
          ))}
        </List>
      </Root>
    </SemanticContainer>
  );
}

export interface MenubarMenu {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavigationItem[];
  readonly disabled?: boolean;
}

export interface MenubarProps
  extends CommonComponentProps,
    SlottedComponentProps<NavigationListSlots> {
  readonly menus: readonly MenubarMenu[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (id: string) => void | Promise<void>;
  readonly onSelect?: (item: NavigationItem) => void | Promise<void>;
}

export function Menubar({
  menus,
  value,
  defaultValue,
  onValueChange,
  onSelect,
  slots,
  slotProps,
  disabled = false,
  ...props
}: MenubarProps): ReactNode {
  const generated = useId();
  const theme = useTheme();
  const id = props.id ?? generated;
  const fallback = menus[edgeIndex(menus, false)]?.id ?? "";
  const [internal, setInternal] = useState(defaultValue ?? fallback);
  const selected = value ?? internal;
  const active = Math.max(
    0,
    menus.findIndex((menu) => menu.id === selected),
  );
  const { focused } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: false,
        role: "menu",
        label: props.label ?? "Menubar",
      }),
      [disabled, id, props.label],
    ),
  );
  const selectMenu = useCallback(
    async (index: number) => {
      const menu = menus[index];
      if (!menu || menu.disabled) return;
      if (value === undefined) setInternal(menu.id);
      await onValueChange?.(menu.id);
    },
    [menus, onValueChange, value],
  );
  useTerminalInput(
    async (_input, key) => {
      if (key.leftArrow) {
        await selectMenu(enabledIndex(menus, active, -1));
        return true;
      }
      if (key.rightArrow) {
        await selectMenu(enabledIndex(menus, active, 1));
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_700 },
  );
  const menu = menus[active];
  const Root = slots?.root ?? Box;
  const List = slots?.list ?? Box;
  const Item = slots?.item ?? Text;
  const state = { focused, disabled };
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticContainer id={id} role="menu" label={props.label ?? "Menubar"}>
        <List
          flexDirection="row"
          gap={1}
          {...resolveSlotProps(slotProps?.list, state, theme)}
        >
          {menus.map((candidate, index) => (
            <Item
              key={candidate.id}
              bold={focused && index === active}
              underline={index === active}
              dimColor={candidate.disabled}
              {...resolveSlotProps(slotProps?.item, state, theme)}
            >
              <SemanticItem
                id={`${id}:menu:${candidate.id}`}
                role="menuitem"
                label={candidate.label}
                selected={index === active}
                disabled={candidate.disabled}
              />
              {candidate.label}
            </Item>
          ))}
        </List>
      </SemanticContainer>
      {menu ? (
        <Menu
          id={`${id}:${menu.id}`}
          label={menu.label}
          items={menu.items}
          open
          onSelect={onSelect}
        />
      ) : null}
    </Root>
  );
}

export interface BreadcrumbItem {
  readonly id: string;
  readonly label: string;
  readonly command?: string;
  readonly disabled?: boolean;
}

export interface BreadcrumbsProps
  extends CommonComponentProps,
    SlottedComponentProps<NavigationListSlots> {
  readonly items: readonly BreadcrumbItem[];
  readonly separator?: string;
  readonly onSelect?: (item: BreadcrumbItem) => void | Promise<void>;
}

export function Breadcrumbs({
  items,
  separator,
  onSelect,
  slots,
  slotProps,
  disabled = false,
  ...props
}: BreadcrumbsProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const current = Math.max(0, items.length - 1);
  const [active, setActive] = useState(current);
  const { focused } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: false,
        role: "navigation",
        label: props.label ?? "Breadcrumbs",
      }),
      [disabled, id, props.label],
    ),
  );
  useTerminalInput(
    async (_input, key) => {
      if (key.leftArrow) {
        setActive(enabledIndex(items, active, -1));
        return true;
      }
      if (key.rightArrow) {
        setActive(enabledIndex(items, active, 1));
        return true;
      }
      if (key.return) {
        const item = items[active];
        if (!item || item.disabled) return true;
        if (item.command) {
          await app.commands.execute(item.command, { source: id });
        }
        await onSelect?.(item);
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_400 },
  );
  const Root = slots?.root ?? Box;
  const List = slots?.list ?? Box;
  const Item = slots?.item ?? Text;
  const state = { focused, disabled };
  return (
    <SemanticContainer
      id={id}
      role="navigation"
      label={props.label ?? "Breadcrumbs"}
    >
      <Root {...resolveSlotProps(slotProps?.root, state, theme)}>
        <List
          flexDirection="row"
          {...resolveSlotProps(slotProps?.list, state, theme)}
        >
          {items.map((item, index) => (
            <Item
              key={item.id}
              bold={index === current || (focused && index === active)}
              dimColor={item.disabled}
              {...resolveSlotProps(slotProps?.item, state, theme)}
            >
              <SemanticItem
                id={`${id}:crumb:${item.id}`}
                role="button"
                label={item.label}
                selected={index === current}
                disabled={item.disabled}
              />
              {index > 0
                ? ` ${separator ?? (app.capabilities.unicode ? "›" : ">")} `
                : ""}
              {item.label}
            </Item>
          ))}
        </List>
      </Root>
    </SemanticContainer>
  );
}

export type StepStatus =
  | "pending"
  | "current"
  | "completed"
  | "error"
  | "skipped";

export interface StepperItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly status?: StepStatus;
}

export interface StepperProps
  extends CommonComponentProps,
    SlottedComponentProps<NavigationListSlots> {
  readonly steps: readonly StepperItem[];
  readonly current?: string;
  readonly orientation?: "horizontal" | "vertical";
}

export function Stepper({
  steps,
  current,
  orientation = "horizontal",
  slots,
  slotProps,
  ...props
}: StepperProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === current || step.status === "current"),
  );
  const Root = slots?.root ?? Box;
  const List = slots?.list ?? Box;
  const Item = slots?.item ?? Text;
  const state = { current: currentIndex };
  return (
    <SemanticContainer
      id={id}
      role="status"
      label={props.label ?? "Workflow progress"}
      valueText={`${currentIndex + 1} of ${steps.length}`}
    >
      <Root {...resolveSlotProps(slotProps?.root, state, theme)}>
        <List
          flexDirection={orientation === "vertical" ? "column" : "row"}
          gap={1}
          {...resolveSlotProps(slotProps?.list, state, theme)}
        >
          {steps.map((step, index) => {
            const status =
              step.status ??
              (index < currentIndex
                ? "completed"
                : index === currentIndex
                  ? "current"
                  : "pending");
            const marker =
              status === "completed"
                ? app.capabilities.unicode
                  ? "✓"
                  : "x"
                : status === "error"
                  ? "!"
                  : status === "skipped"
                    ? "-"
                    : status === "current"
                      ? app.capabilities.unicode
                        ? "●"
                        : "*"
                      : app.capabilities.unicode
                        ? "○"
                        : "o";
            return (
              <Item
                key={step.id}
                bold={status === "current"}
                dimColor={status === "pending" || status === "skipped"}
                color={
                  status === "error"
                    ? theme.colors.danger.foreground
                    : status === "completed"
                      ? theme.colors.success.foreground
                      : undefined
                }
                {...resolveSlotProps(slotProps?.item, state, theme)}
              >
                <SemanticItem
                  id={`${id}:step:${step.id}`}
                  role="button"
                  label={step.label}
                  description={step.description}
                  selected={status === "current"}
                />
                [{marker}] {step.label}
              </Item>
            );
          })}
        </List>
      </Root>
    </SemanticContainer>
  );
}
