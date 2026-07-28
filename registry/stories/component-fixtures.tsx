import { useFocusable } from "@mwillbanks/tuil-focus";
import { Box, Text } from "@mwillbanks/tuil-ink";
import { defineTuilStories } from "@mwillbanks/tuil-story";
import { useTheme } from "@mwillbanks/tuil-theme";
import {
  createWorkflow,
  defineStep,
  defineWorkflow,
} from "@mwillbanks/tuil-workflow";
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  type ComponentType,
  createElement,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import registryIndex from "../../apps/registry/public/registry.json";
import * as initWizard from "../blocks/init-wizard.tsx";
import * as appBar from "../components/app-bar.tsx";
import * as appShell from "../components/app-shell.tsx";
import * as button from "../components/button.tsx";
import * as statusBar from "../components/status-bar.tsx";
import * as badge from "../data-display/badge.tsx";
import * as complexData from "../data-display/complex-data.tsx";
import * as diffViewer from "../data-display/diff-viewer.tsx";
import * as divider from "../data-display/divider.tsx";
import * as heading from "../data-display/heading.tsx";
import * as jsonViewer from "../data-display/json-viewer.tsx";
import * as logViewer from "../data-display/log-viewer.tsx";
import * as richContent from "../data-display/rich-content.tsx";
import * as text from "../data-display/text.tsx";
import * as tree from "../data-display/tree.tsx";
import * as virtualList from "../data-display/virtual-list.tsx";
import * as alert from "../feedback/alert.tsx";
import * as overlays from "../feedback/overlays.tsx";
import * as progress from "../feedback/progress.tsx";
import * as spinner from "../feedback/spinner.tsx";
import * as controls from "../forms/controls.tsx";
import * as transferList from "../forms/transfer-list.tsx";
import * as panes from "../layout/panes.tsx";
import * as resizablePane from "../layout/resizable-pane.tsx";
import * as navigation from "../navigation/navigation.tsx";
import * as primitiveBox from "../primitives/box.tsx";
import * as container from "../primitives/container.tsx";
import * as stack from "../primitives/stack.tsx";
import { theme } from "../themes/default.ts";
import * as workflow from "../workflows/workflow.tsx";
import { componentAcceptanceInventory } from "./component-acceptance.ts";

const componentExports = Object.freeze(
  Object.assign(
    {},
    initWizard,
    appBar,
    appShell,
    button,
    statusBar,
    badge,
    complexData,
    diffViewer,
    divider,
    heading,
    jsonViewer,
    logViewer,
    richContent,
    text,
    tree,
    virtualList,
    alert,
    overlays,
    progress,
    spinner,
    controls,
    transferList,
    panes,
    resizablePane,
    navigation,
    primitiveBox,
    container,
    stack,
    workflow,
  ) as Readonly<Record<string, unknown>>,
);

const exportOverrides: Readonly<Record<string, string>> = Object.freeze({
  default: "ThemePreview",
  "structured-content": "StructuredContentSummary",
});

const acceptanceEntries = new Map(
  componentAcceptanceInventory.map((entry) => [entry.name, entry]),
);

function exportName(name: string): string {
  return (
    exportOverrides[name] ??
    name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("")
  );
}

type AcceptanceRecorder = (event: string) => void;
type InteractionPropsFactory = (
  record: AcceptanceRecorder,
) => Readonly<Record<string, unknown>>;

const textInputNames = new Set([
  "code-editor",
  "command-line",
  "date-time-input",
  "editable-table-cell",
  "editable-tree-node",
  "form-field-editor",
  "inline-editor",
  "password-input",
  "search-input",
  "text-area",
  "text-input",
]);

const acceptanceOptions = Object.freeze([
  Object.freeze({ value: "one", label: "One" }),
  Object.freeze({ value: "two", label: "Two" }),
]);

const acceptanceItems = Object.freeze([
  Object.freeze({ id: "one", label: "One", content: "One panel" }),
  Object.freeze({ id: "two", label: "Two", content: "Two panel" }),
]);
const acceptanceVirtualItems = Object.freeze([
  ...acceptanceItems,
  Object.freeze({ id: "three", label: "Three", content: "Three panel" }),
  Object.freeze({ id: "four", label: "Four", content: "Four panel" }),
]);

const acceptanceTreeItems = Object.freeze([
  Object.freeze({
    id: "one",
    label: "One",
    children: Object.freeze([Object.freeze({ id: "child", label: "Child" })]),
  }),
  Object.freeze({ id: "two", label: "Two" }),
]);

const acceptanceOperations = Object.freeze([
  Object.freeze({
    id: "one",
    title: "One",
    status: "running" as const,
    attempt: 1,
    children: Object.freeze([
      Object.freeze({
        id: "child",
        title: "Child",
        status: "pending" as const,
        attempt: 1,
        children: Object.freeze([]),
        metadata: Object.freeze({}),
        logs: Object.freeze([]),
      }),
    ]),
    metadata: Object.freeze({}),
    logs: Object.freeze([]),
  }),
]);

const acceptanceDataTableRows = [{ id: "one", value: "One" }];
const acceptanceDataTableColumnHelper =
  createColumnHelper<(typeof acceptanceDataTableRows)[number]>();
const acceptanceDataTableColumns = [
  acceptanceDataTableColumnHelper.accessor("value", { header: "Value" }),
];

const containerChildrenNames = new Set([
  "app-bar",
  "app-shell",
  "box",
  "container",
  "dialog",
  "drawer",
  "error-boundary",
  "field",
  "footer",
  "header",
  "pane-tabs",
  "popover",
  "resizable-pane",
  "scroll-area",
  "sidebar",
  "stack",
  "status-bar",
  "toast-provider",
  "tooltip",
]);

const openByDefaultNames = new Set([
  "command-palette",
  "confirm-dialog",
  "help-overlay",
  "menu",
  "tooltip",
]);

const selectableValueNames = new Set([
  "select",
  "multi-select",
  "tab-select",
  "autocomplete",
  "radio-group",
  "tabs",
  "menubar",
]);

function acceptanceDefaultValue(name: string): unknown {
  if (name === "multi-select" || name === "transfer-list") return ["one"];
  if (name === "number-input") return 1;
  if (selectableValueNames.has(name))
    return name === "autocomplete" ? "" : "one";
  return "acceptance";
}

function acceptanceItemLabel(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof value.label === "string"
    ? value.label
    : String(value);
}

function acceptanceItemKey(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
    ? value.id
    : String(value);
}

const checkedInteractionProps: InteractionPropsFactory = (record) => ({
  autoFocus: true,
  onCheckedChange: (value: boolean) => record(`checked:${value}`),
});

const textInteractionProps: InteractionPropsFactory = (record) => ({
  autoFocus: true,
  onValueChange: (value: string) => record(`value:${value}`),
  onSubmit: (value: string) => record(`submit:${value}`),
});

const numericInteractionProps: InteractionPropsFactory = (record) => ({
  autoFocus: true,
  onValueChange: (value: number) => record(`value:${value}`),
});

const selectionInteractionProps: InteractionPropsFactory = (record) => ({
  autoFocus: true,
  onValueChange: (value: string) => record(`value:${value}`),
  onOpenChange: (value: boolean) => record(`open:${value}`),
});

const tabInteractionProps: InteractionPropsFactory = (record) => ({
  autoFocus: true,
  onValueChange: (value: string) => record(`value:${value}`),
});

const interactionPropFactories: Readonly<
  Record<string, InteractionPropsFactory>
> = Object.freeze({
  button: (record) => ({
    autoFocus: true,
    onPress: () => record("press"),
  }),
  checkbox: checkedInteractionProps,
  switch: checkedInteractionProps,
  "number-input": numericInteractionProps,
  slider: numericInteractionProps,
  "radio-group": selectionInteractionProps,
  select: selectionInteractionProps,
  "multi-select": (record) => ({
    autoFocus: true,
    onValueChange: (value: readonly string[]) =>
      record(`value:${value.join(",")}`),
  }),
  autocomplete: (record) => ({
    autoFocus: true,
    onValueChange: (value: string) => record(`value:${value}`),
    onOptionSelect: (value: { readonly value: string }) =>
      record(`option:${value.value}`),
  }),
  tabs: tabInteractionProps,
  "tab-select": tabInteractionProps,
  menubar: tabInteractionProps,
  breadcrumbs: (record) => ({
    autoFocus: true,
    onSelect: (value: { readonly id: string }) => record(`select:${value.id}`),
  }),
  tree: (record) => ({
    autoFocus: true,
    onSelect: (value: { readonly id: string }) => record(`select:${value.id}`),
    onExpandedChange: (value: readonly string[]) =>
      record(`expanded:${value.join(",")}`),
  }),
  "transfer-list": (record) => ({
    autoFocus: true,
    onValueChange: (value: readonly string[]) =>
      record(`value:${value.join(",")}`),
    onTransfer: (
      value: { readonly id: string },
      direction: "select" | "remove",
    ) => record(`transfer:${value.id}:${direction}`),
  }),
  "resizable-pane": (record) => ({
    autoFocus: true,
    onSizeChange: (value: number) => record(`size:${value}`),
  }),
  "split-pane": (record) => ({
    autoFocus: true,
    onSizesChange: (value: readonly number[]) =>
      record(`sizes:${value.join(",")}`),
  }),
  pagination: (record) => ({
    autoFocus: true,
    page: 1,
    pageCount: 3,
    onPageChange: (value: number) => record(`page:${value}`),
  }),
  menu: (record) => ({
    autoFocus: true,
    onSelect: (value: { readonly id: string }) => record(`select:${value.id}`),
  }),
  table: (record) => ({
    autoFocus: true,
    onActivate: (
      row: { readonly id: string },
      column: { readonly id: string },
    ) => record(`activate:${row.id}:${column.id}`),
    onSelectionChange: (value: readonly string[]) =>
      record(`selection:${value.join(",")}`),
  }),
  "data-table": (record) => ({
    onActivate: (row: { readonly id: string }, columnId: string) =>
      record(`activate:${row.id}:${columnId}`),
  }),
  "virtual-list": (record) => ({
    autoFocus: true,
    onOffsetChange: (value: number) => record(`offset:${value}`),
    onActiveIndexChange: (value: number) => record(`active:${value}`),
    onSelect: (value: { readonly id: string }) =>
      record(`virtual-select:${value.id}`),
  }),
  "json-viewer": (record) => ({
    autoFocus: true,
    onExpandedChange: (value: readonly string[]) =>
      record(`expanded:${value.join(",")}`),
  }),
  "log-viewer": (record) => ({
    autoFocus: true,
    onFollowChange: (value: boolean) => record(`follow:${value}`),
  }),
  "markdown-viewer": (record) => ({
    autoFocus: true,
    selectable: true,
    onSelectedBlockChange: (value: number) => record(`block:${value}`),
  }),
  "code-viewer": (record) => ({
    autoFocus: true,
    clipboard: { write: () => {} },
    onCopy: (value: string) => record(`copy:${value}`),
    onSelectedLineChange: (value: number) => record(`line:${value}`),
  }),
  "rich-diff-viewer": (record) => ({
    autoFocus: true,
    onResolveHunk: (index: number, decision: "apply" | "reject") =>
      record(`resolve:${index}:${decision}`),
  }),
  "operation-tree": (record) => ({
    onValueChange: (value: string) => record(`operation:${value}`),
    onExpandedChange: (value: readonly string[]) =>
      record(`operation-expanded:${value.join(",")}`),
  }),
  "password-input": (record) => ({
    autoFocus: true,
    onValueChange: () => record("value:[redacted]"),
    onSubmit: () => record("submit:[redacted]"),
  }),
});

function interactionProps(
  name: string,
  record: AcceptanceRecorder,
): Readonly<Record<string, unknown>> {
  const factory = interactionPropFactories[name];
  if (factory) return factory(record);
  return textInputNames.has(name) ? textInteractionProps(record) : {};
}

function fixtureChildren(name: string): ReactNode {
  const content = `${name} content`;
  return containerChildrenNames.has(name)
    ? createElement(Text, null, content)
    : content;
}

function fixtureSource(name: string): string {
  return name.includes("diff")
    ? "@@ -1 +1 @@\n-old\n+new"
    : "# Acceptance\nSecond";
}

function fixtureValue(name: string): unknown {
  if (name === "slider" || name === "progress") return 1;
  return name === "json-viewer" ? { acceptance: true } : undefined;
}

function fixtureItems(name: string): readonly unknown[] {
  if (name === "tree") return acceptanceTreeItems;
  if (name === "virtual-list") return acceptanceVirtualItems;
  return acceptanceItems;
}

function fixtureLines(name: string): number | readonly string[] {
  return name === "skeleton" ? 2 : ["INFO acceptance"];
}

function fixtureProps(
  name: string,
  record: AcceptanceRecorder,
): Readonly<Record<string, unknown>> {
  const acceptanceEntry = acceptanceEntries.get(name);
  if (!acceptanceEntry) {
    throw new Error(`Missing component acceptance entry "${name}"`);
  }
  const openByDefault = openByDefaultNames.has(name);
  return Object.freeze({
    id: `acceptance-${name}`,
    targetId: `acceptance-${name}`,
    role: acceptanceEntry.expectedRole,
    initialName: "acceptance-app",
    onComplete: () => {},
    onCancel: () => {},
    label: acceptanceEntry.expectedLabel,
    title: `${name} acceptance`,
    children: fixtureChildren(name),
    source: fixtureSource(name),
    before: "old",
    after: "new",
    value: fixtureValue(name),
    max: 10,
    defaultValue: acceptanceDefaultValue(name),
    defaultChecked: true,
    defaultOpen: openByDefault,
    open: openByDefault ? true : undefined,
    onConfirm: () => record("confirm"),
    onOpenChange: (value: boolean) => record(`open:${value}`),
    items: fixtureItems(name),
    menus: [{ id: "one", label: "One", items: acceptanceItems }],
    options: acceptanceOptions,
    operations: name === "operation-tree" ? acceptanceOperations : [],
    commands: [
      {
        id: "acceptance.command",
        title: "Acceptance command",
        execute: () => record("command"),
      },
    ],
    rows: [{ id: "one", value: "One" }],
    lines: fixtureLines(name),
    labels: ["One"],
    columns: [
      {
        id: "value",
        header: "Value",
        accessor: (row: { readonly value: string }) => row.value,
      },
    ],
    panes: [
      { id: "one", content: createElement(Text, null, "One pane") },
      { id: "two", content: createElement(Text, null, "Two pane") },
    ],
    defaultSizes: [50, 50],
    defaultExtent: 10,
    minSize: 1,
    maxSize: 30,
    steps: [{ id: "one", label: "One", status: "complete" }],
    toast: {
      id: "acceptance",
      title: "Acceptance",
      variant: "info",
      duration: 1_000,
    },
    data: [{ label: "One", value: 1 }],
    renderItem: acceptanceItemLabel,
    getItemKey: acceptanceItemKey,
    getRowKey: acceptanceItemKey,
    height: name === "virtual-list" ? 2 : 3,
    width: 30,
    ...interactionProps(name, record),
  });
}

function ThemePreview(): ReactNode {
  return (
    <Text
      id="acceptance-default"
      role="application"
      label="default acceptance"
      color={theme.colors.primary.foreground}
    >
      {theme.id} theme tokens
    </Text>
  );
}

function TerminalPlatformPluginPreview(): ReactNode {
  return (
    <Box
      id="acceptance-terminal-platform-plugin"
      role="application"
      label="terminal-platform-plugin acceptance"
    >
      <Text>plugin terminal-platform-plugin@0.2.0</Text>
    </Box>
  );
}

function DialogPreview(props: {
  readonly name: "dialog" | "drawer" | "popover";
  readonly onOpenChange?: (open: boolean) => void | Promise<void>;
}): ReactNode {
  const DialogComponent =
    props.name === "dialog"
      ? overlays.Dialog
      : props.name === "drawer"
        ? overlays.Drawer
        : overlays.Popover;
  return (
    <DialogComponent
      id={`acceptance-${props.name}`}
      defaultOpen
      onOpenChange={props.onOpenChange}
    >
      <DialogComponent.Content label={`${props.name} acceptance`}>
        <DialogComponent.Title>{props.name} acceptance</DialogComponent.Title>
        <DialogComponent.Description>
          {props.name} content
        </DialogComponent.Description>
      </DialogComponent.Content>
    </DialogComponent>
  );
}

function TooltipPreview(props: {
  readonly onOpenChange?: (open: boolean) => void | Promise<void>;
}): ReactNode {
  useFocusable(
    useMemo(
      () => ({
        id: "acceptance-tooltip",
        disabled: false,
        hidden: false,
        role: "button" as const,
        label: "Tooltip target",
      }),
      [],
    ),
  );
  return (
    <overlays.Tooltip
      targetId="acceptance-tooltip"
      content="tooltip content"
      open
      delay={0}
      onOpenChange={props.onOpenChange}
    >
      <Text
        id="acceptance-tooltip"
        role="button"
        label="Tooltip target"
        layout={{ focusable: true }}
      >
        Tooltip target
      </Text>
    </overlays.Tooltip>
  );
}

function DataTablePreview(props: {
  readonly onActivate?: (
    row: { readonly id: string; readonly value: string },
    columnId: string,
  ) => void | Promise<void>;
}): ReactNode {
  const table = useReactTable({
    data: acceptanceDataTableRows,
    columns: acceptanceDataTableColumns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <complexData.DataTable
      id="acceptance-data-table"
      label="data-table acceptance"
      table={table}
      height={3}
      width={30}
      onActivate={props.onActivate}
    />
  );
}

function WorkflowPreview(): ReactNode {
  const runner = useMemo(
    () =>
      createWorkflow(
        defineWorkflow({
          id: "acceptance",
          version: 1,
          initialState: {},
          steps: {
            ready: defineStep({
              title: "Ready",
              component: "Acceptance ready",
            }),
          },
          transitions: [],
        }),
      ),
    [],
  );
  return createElement(
    workflow.Workflow,
    { workflow: runner, autoStart: false },
    createElement(workflow.Workflow.Stepper),
  );
}

const componentPreviewOverrides: Readonly<
  Record<string, ComponentType<Readonly<Record<string, unknown>>>>
> = Object.freeze({
  default: ThemePreview,
  dialog: (props) => (
    <DialogPreview
      name="dialog"
      onOpenChange={
        props["onOpenChange"] as
          | ((open: boolean) => void | Promise<void>)
          | undefined
      }
    />
  ),
  drawer: (props) => (
    <DialogPreview
      name="drawer"
      onOpenChange={
        props["onOpenChange"] as
          | ((open: boolean) => void | Promise<void>)
          | undefined
      }
    />
  ),
  popover: (props) => (
    <DialogPreview
      name="popover"
      onOpenChange={
        props["onOpenChange"] as
          | ((open: boolean) => void | Promise<void>)
          | undefined
      }
    />
  ),
  tooltip: (props) => (
    <TooltipPreview
      onOpenChange={
        props["onOpenChange"] as
          | ((open: boolean) => void | Promise<void>)
          | undefined
      }
    />
  ),
  "terminal-platform-plugin": TerminalPlatformPluginPreview,
  "data-table": (props) => (
    <DataTablePreview
      onActivate={
        props["onActivate"] as
          | ((
              row: { readonly id: string; readonly value: string },
              columnId: string,
            ) => void | Promise<void>)
          | undefined
      }
    />
  ),
  workflow: WorkflowPreview,
});

function acceptanceComponent(
  name: string,
): ComponentType<Readonly<Record<string, unknown>>> | undefined {
  return (
    componentPreviewOverrides[name] ??
    (componentExports[exportName(name)] as
      | ComponentType<Readonly<Record<string, unknown>>>
      | undefined)
  );
}

export function componentAcceptanceFixture(name: string): ReactNode {
  return <ActualComponentAcceptanceFixture name={name} />;
}

function ActualComponentAcceptanceFixture(props: {
  readonly name: string;
}): ReactNode {
  const theme = useTheme();
  const [events, setEvents] = useState<readonly string[]>([]);
  const record = useCallback((event: string) => {
    setEvents((current) => [...current, event]);
  }, []);
  const name = props.name;
  const nameOfExport = exportName(name);
  const Component = acceptanceComponent(name);
  const propsForComponent = useMemo(
    () => fixtureProps(name, record),
    [name, record],
  );
  if (!Component)
    throw new Error(
      `Registry component "${name}" is missing export "${nameOfExport}"`,
    );
  const component = createElement(Component, propsForComponent);
  return (
    <>
      {component}
      <Text color={theme.colors.primary.foreground}>
        acceptance-state:{name} · events:{events.join("|") || "none"} · theme:
        {theme.id}
      </Text>
    </>
  );
}

export function ComponentAcceptancePreview(props: {
  readonly name: string;
}): ReactNode {
  return componentAcceptanceFixture(props.name);
}

export const componentAcceptanceStoryVariants = Object.freeze(
  Object.fromEntries(
    registryIndex.items.map((item) => [
      exportName(item.name),
      Object.freeze({ args: Object.freeze({ name: item.name }) }),
    ]),
  ),
);

export const componentAcceptanceStories = defineTuilStories({
  component: ComponentAcceptancePreview,
  stories: componentAcceptanceStoryVariants,
});
