import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  Box as SemanticBox,
  usePointerEvents,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  type ComponentType,
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
  readonly parentId: string;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <SemanticBox
      id={props.id}
      role={props.role}
      label={props.label}
      description={props.description}
      selected={props.selected}
      expanded={props.expanded}
      disabled={props.disabled}
      layout={{ parentId: props.parentId, zIndex: 1 }}
    >
      {props.children}
    </SemanticBox>
  );
}

function SemanticContainer(props: {
  readonly id: string;
  readonly role: "navigation" | "menu" | "tabpanel" | "status";
  readonly label: string;
  readonly valueText?: string;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <SemanticBox
      id={props.id}
      role={props.role}
      label={props.label}
      valueText={props.valueText}
    >
      {props.children}
    </SemanticBox>
  );
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
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const { focused, focus } = useFocusable(
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
  usePointerEvents(
    useMemo(
      () =>
        items.map((item, index) => ({
          id: `${id}:tab:${item.id}`,
          type: "click" as const,
          enabled: !disabled && !item.disabled,
          listener: async () => {
            focus();
            await select(index);
          },
        })),
      [disabled, focus, id, items, select],
    ),
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
            <SemanticItem
              key={item.id}
              id={`${id}:tab:${item.id}`}
              parentId={id}
              role="tab"
              label={item.label}
              description={item.description}
              selected={item.id === selected}
              disabled={item.disabled}
            >
              <Item
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
                {app.mode === "interactive" && focused && index === active
                  ? app.capabilities.unicode
                    ? "▶ "
                    : "> "
                  : ""}
                {item.label}
              </Item>
            </SemanticItem>
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
  useEffect(() => {
    pathRef.current = activePath;
  }, [activePath]);
  const currentItems =
    activePath
      .slice(0, -1)
      .reduce<readonly NavigationItem[]>(
        (list, index) => list[index]?.items ?? [],
        items,
      ) ?? items;
  const { focused, focus } = useFocusable(
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
  usePointerEvents(
    useMemo(
      () =>
        currentItems.map((item, index) => ({
          id: `${id}:item:${item.id}`,
          type: "click" as const,
          enabled: !disabled && !item.disabled,
          listener: async () => {
            focus();
            setActivePath([...pathRef.current.slice(0, -1), index]);
            if (item.items?.length) {
              setActivePath([
                ...pathRef.current.slice(0, -1),
                index,
                Math.max(0, edgeIndex(item.items, false)),
              ]);
              return;
            }
            if (item.command) {
              await app.commands.execute(item.command, { source: id });
            }
            await onSelect?.(item);
            await setOpen(false);
          },
        })),
      [app.commands, currentItems, disabled, focus, id, onSelect, setOpen],
    ),
  );
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
            <SemanticItem
              key={item.id}
              id={`${id}:item:${item.id}`}
              parentId={id}
              role="menuitem"
              label={item.label}
              description={item.description}
              disabled={item.disabled}
              expanded={item.items ? index === activePath.at(-1) : undefined}
            >
              <Item
                bold={focused && index === activePath.at(-1)}
                dimColor={item.disabled}
                {...resolveSlotProps(slotProps?.item, state, theme)}
              >
                {focused && index === activePath.at(-1) ? "> " : "  "}
                {item.label}
                {item.command ? ` (${item.command})` : ""}
                {item.items ? " >" : ""}
              </Item>
            </SemanticItem>
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
  const { focused, focus } = useFocusable(
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
  usePointerEvents(
    useMemo(
      () =>
        menus.map((candidate, index) => ({
          id: `${id}:menu:${candidate.id}`,
          type: "click" as const,
          enabled: !disabled && !candidate.disabled,
          listener: async () => {
            focus();
            await selectMenu(index);
          },
        })),
      [disabled, focus, id, menus, selectMenu],
    ),
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
            <SemanticItem
              key={candidate.id}
              id={`${id}:menu:${candidate.id}`}
              parentId={id}
              role="menuitem"
              label={candidate.label}
              selected={index === active}
              disabled={candidate.disabled}
            >
              <Item
                bold={focused && index === active}
                underline={index === active}
                dimColor={candidate.disabled}
                {...resolveSlotProps(slotProps?.item, state, theme)}
              >
                {candidate.label}
              </Item>
            </SemanticItem>
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

function breadcrumbSeparator(
  index: number,
  separator: string | undefined,
  unicode: boolean,
): string {
  if (index === 0) return "";
  return ` ${separator ?? (unicode ? "›" : ">")} `;
}

function BreadcrumbTrail(props: {
  readonly active: number;
  readonly current: number;
  readonly focused: boolean;
  readonly id: string;
  readonly itemComponent: ComponentType<TextProps>;
  readonly items: readonly BreadcrumbItem[];
  readonly separator?: string;
  readonly slotProps:
    | NonNullable<BreadcrumbsProps["slotProps"]>["item"]
    | undefined;
  readonly state: { readonly focused: boolean; readonly disabled: boolean };
  readonly theme: ReturnType<typeof useTheme>;
  readonly unicode: boolean;
}): ReactNode {
  const Item = props.itemComponent;
  return props.items.map((item, index) => (
    <SemanticItem
      key={item.id}
      id={`${props.id}:crumb:${item.id}`}
      parentId={props.id}
      role="button"
      label={item.label}
      selected={index === props.current}
      disabled={item.disabled}
    >
      <Item
        bold={
          index === props.current || (props.focused && index === props.active)
        }
        dimColor={item.disabled}
        {...resolveSlotProps(props.slotProps, props.state, props.theme)}
      >
        {breadcrumbSeparator(index, props.separator, props.unicode)}
        {item.label}
      </Item>
    </SemanticItem>
  ));
}

function useBreadcrumbController(options: {
  readonly disabled: boolean;
  readonly id: string;
  readonly items: readonly BreadcrumbItem[];
  readonly label: string;
  readonly onSelect?: (item: BreadcrumbItem) => void | Promise<void>;
}): {
  readonly active: number;
  readonly current: number;
  readonly focused: boolean;
  readonly unicode: boolean;
} {
  const { disabled, id, items, label, onSelect } = options;
  const app = useApp();
  const current = Math.max(0, items.length - 1);
  const [active, setActive] = useState(current);
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: false,
        role: "navigation",
        label,
      }),
      [disabled, id, label],
    ),
  );
  const activate = useCallback(
    async (index: number) => {
      const item = items[index];
      if (!item || item.disabled || disabled) return;
      setActive(index);
      focus();
      if (item.command) {
        await app.commands.execute(item.command, { source: id });
      }
      await onSelect?.(item);
    },
    [app.commands, disabled, focus, id, items, onSelect],
  );
  usePointerEvents(
    useMemo(
      () =>
        items.map((item, index) => ({
          id: `${id}:crumb:${item.id}`,
          type: "click" as const,
          enabled: !disabled && !item.disabled,
          listener: () => activate(index),
        })),
      [activate, disabled, id, items],
    ),
  );
  useTerminalInput(
    async (_input, key) => {
      if (key.leftArrow) setActive(enabledIndex(items, active, -1));
      else if (key.rightArrow) setActive(enabledIndex(items, active, 1));
      else if (key.return) await activate(active);
      else return false;
      return true;
    },
    { enabled: focused && !disabled, priority: 1_400 },
  );
  return {
    active,
    current,
    focused,
    unicode: app.capabilities.unicode,
  };
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
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const controller = useBreadcrumbController({
    disabled,
    id,
    items,
    label: props.label ?? "Breadcrumbs",
    onSelect,
  });
  const Root = slots?.root ?? Box;
  const List = slots?.list ?? Box;
  const Item = slots?.item ?? Text;
  const state = { focused: controller.focused, disabled };
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
          <BreadcrumbTrail
            active={controller.active}
            current={controller.current}
            focused={controller.focused}
            id={id}
            itemComponent={Item}
            items={items}
            separator={separator}
            slotProps={slotProps?.item}
            state={state}
            theme={theme}
            unicode={controller.unicode}
          />
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
              <SemanticItem
                key={step.id}
                id={`${id}:step:${step.id}`}
                parentId={id}
                role="button"
                label={step.label}
                description={step.description}
                selected={status === "current"}
              >
                <Item
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
                  [{marker}] {step.label}
                </Item>
              </SemanticItem>
            );
          })}
        </List>
      </Root>
    </SemanticContainer>
  );
}

export type TabSelectProps = TabsProps;
export const TabSelect = Tabs;

export interface PaginationProps extends CommonComponentProps {
  readonly page: number;
  readonly pageCount: number;
  readonly onPageChange?: (page: number) => void | Promise<void>;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  disabled = false,
  ...props
}: PaginationProps): ReactNode {
  const id = props.id ?? "pagination";
  const safeCount = Math.max(1, Math.floor(pageCount));
  const safePage = Math.max(1, Math.min(safeCount, Math.floor(page)));
  const { focused } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: false,
        role: "button",
        label: props.label ?? "Pagination",
      }),
      [disabled, id, props.label],
    ),
  );
  useTerminalInput(
    async (_input, key) => {
      if (key.leftArrow || key.pageUp) {
        await onPageChange?.(Math.max(1, safePage - 1));
        return true;
      }
      if (key.rightArrow || key.pageDown) {
        await onPageChange?.(Math.min(safeCount, safePage + 1));
        return true;
      }
      if (key.home) {
        await onPageChange?.(1);
        return true;
      }
      if (key.end) {
        await onPageChange?.(safeCount);
        return true;
      }
      return false;
    },
    { enabled: focused, priority: 2_000 },
  );
  return (
    <SemanticContainer
      id={id}
      role="navigation"
      label={props.label ?? "Pagination"}
      valueText={`${safePage} of ${safeCount}`}
    >
      <Text
        bold={focused}
        dimColor={disabled}
      >{`‹ ${safePage}/${safeCount} ›`}</Text>
    </SemanticContainer>
  );
}

export interface OutlineItem {
  readonly id: string;
  readonly label: string;
  readonly depth?: number;
  readonly selected?: boolean;
}

export function Outline(props: {
  readonly id?: string;
  readonly label?: string;
  readonly items: readonly OutlineItem[];
}): ReactNode {
  const id = props.id ?? "outline";
  return (
    <SemanticContainer
      id={id}
      role="navigation"
      label={props.label ?? "Outline"}
    >
      <Box flexDirection="column">
        {props.items.map((item) => (
          <Text key={item.id} bold={item.selected}>
            {"  ".repeat(item.depth ?? 0)}
            {item.selected ? "› " : "  "}
            {item.label}
          </Text>
        ))}
      </Box>
    </SemanticContainer>
  );
}
