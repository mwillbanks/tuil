import type { SemanticRole } from "@mwillbanks/tuil-core";
import registryIndex from "../../apps/registry/public/registry.json";
import { registryExportName } from "../../tooling/registry/names.ts";

export interface ComponentAcceptanceEntry {
  readonly name: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly storyId: string;
  readonly storySource: string;
  readonly storyExport: string;
  readonly docsPath: string;
  readonly docsSource: string;
  readonly testSource: string;
  readonly fixtureId: string;
  readonly snapshotId: string;
  readonly expectedRole: SemanticRole;
  readonly expectedLabel?: string;
  readonly capabilities: ComponentCapabilityContract;
  readonly interaction?: ComponentInteractionContract;
  readonly staticContract: string;
  readonly themeContract: string;
}

export interface ComponentInteractionContract {
  readonly focusId?: string;
  readonly focusRole?: SemanticRole;
  readonly focusLabel?: string;
  readonly keys: readonly string[];
  readonly expectedEvents: readonly string[];
  readonly pointer: boolean;
  readonly pointerTargetId?: string;
  readonly pointerCallback: boolean;
  readonly pointerPreparationKeys: readonly string[];
}

export interface ComponentCapabilityContract {
  readonly semanticRole: SemanticRole;
  readonly semanticLabel?: string;
  readonly callbacks: readonly string[];
  readonly keyboard: boolean;
  readonly focus: boolean;
  readonly pointer: boolean;
  readonly theme: true;
  readonly static: true;
  readonly interaction?: ComponentInteractionContract;
}

interface ComponentContractOptions {
  readonly semanticLabel?: string;
  readonly callbacks?: readonly string[];
  readonly keys?: readonly string[];
  readonly expectedEvent?: string;
  readonly expectedEvents?: readonly string[];
  readonly pointer?: boolean;
  readonly focus?: boolean;
  readonly focusId?: string;
  readonly focusRole?: SemanticRole;
  readonly focusLabel?: string;
  readonly pointerTargetId?: string;
  readonly pointerCallback?: boolean;
  readonly pointerPreparationKeys?: readonly string[];
}

function expectedContractEvents(
  options: ComponentContractOptions,
): readonly string[] {
  return (
    options.expectedEvents ??
    (options.expectedEvent ? [options.expectedEvent] : [])
  );
}

function componentInteraction(
  options: ComponentContractOptions,
  expectedEvents: readonly string[],
): ComponentInteractionContract | undefined {
  if (!options.keys?.length || expectedEvents.length === 0) return undefined;
  return Object.freeze({
    keys: Object.freeze([...options.keys]),
    expectedEvents: Object.freeze([...expectedEvents]),
    pointer: options.pointer ?? false,
    focusId: options.focusId,
    focusRole: options.focusRole,
    focusLabel: options.focusLabel,
    pointerTargetId: options.pointerTargetId,
    pointerCallback:
      options.pointerCallback ??
      Boolean(options.pointer && options.callbacks?.length),
    pointerPreparationKeys: Object.freeze([
      ...(options.pointerPreparationKeys ?? []),
    ]),
  });
}

function componentContract(
  semanticRole: SemanticRole,
  options: ComponentContractOptions = {},
): ComponentCapabilityContract {
  const interactive = Boolean(options.keys?.length);
  const expectedEvents = expectedContractEvents(options);
  return Object.freeze({
    semanticRole,
    semanticLabel: options.semanticLabel,
    callbacks: Object.freeze([...(options.callbacks ?? [])]),
    keyboard: interactive,
    focus: options.focus ?? interactive,
    pointer: options.pointer ?? false,
    theme: true,
    static: true,
    interaction: componentInteraction(options, expectedEvents),
  });
}

const textEdit = {
  callbacks: ["onValueChange", "onSubmit"],
  keys: ["Z", "enter"],
  expectedEvents: ["value:acceptanceZ", "submit:acceptanceZ"],
  pointer: true,
  pointerCallback: false,
} as const;
const multilineEdit = {
  callbacks: ["onValueChange"],
  keys: ["Z"],
  expectedEvent: "value:acceptanceZ",
  pointer: true,
  pointerCallback: false,
} as const;

const componentCapabilityContracts: Readonly<
  Record<string, ComponentCapabilityContract>
> = Object.freeze({
  alert: componentContract("alert"),
  "app-bar": componentContract("application"),
  "app-shell": componentContract("application"),
  autocomplete: componentContract("textbox", {
    callbacks: ["onValueChange", "onOptionSelect"],
    keys: ["t", "w", "o", "enter"],
    expectedEvents: ["value:t", "option:two"],
    pointer: true,
    pointerTargetId: "acceptance-autocomplete:two",
    pointerPreparationKeys: ["t", "w", "o"],
  }),
  badge: componentContract("application"),
  "bar-chart": componentContract("text"),
  box: componentContract("application"),
  breadcrumbs: componentContract("navigation", {
    callbacks: ["onSelect"],
    keys: ["enter"],
    expectedEvent: "select:two",
    pointer: true,
    pointerTargetId: "acceptance-breadcrumbs:crumb:one",
  }),
  button: componentContract("button", {
    callbacks: ["onPress"],
    keys: ["enter"],
    expectedEvent: "press",
    pointer: true,
  }),
  checkbox: componentContract("checkbox", {
    callbacks: ["onCheckedChange"],
    keys: ["space"],
    expectedEvent: "checked:false",
  }),
  "code-editor": componentContract("textbox", multilineEdit),
  "code-viewer": componentContract("application", {
    callbacks: ["onSelectedLineChange", "onCopy"],
    keys: ["arrowDown", "ctrl+c"],
    expectedEvents: ["line:1", "copy:"],
    pointer: true,
    pointerCallback: false,
  }),
  "command-line": componentContract("textbox", textEdit),
  "command-palette": componentContract("dialog", {
    semanticLabel: "Command palette",
    callbacks: ["commands.execute"],
    keys: ["enter"],
    expectedEvent: "command",
    focusRole: "textbox",
    focusLabel: "Command search",
  }),
  "confirm-dialog": componentContract("dialog", {
    callbacks: ["onConfirm"],
    keys: ["tab", "enter"],
    expectedEvent: "confirm",
    focusRole: "button",
    focusLabel: "Cancel",
  }),
  container: componentContract("application"),
  "data-table": componentContract("table", {
    callbacks: ["onActivate"],
    keys: ["enter"],
    expectedEvent: "activate:one:value",
    pointer: true,
    pointerTargetId: "acceptance-data-table:cell:0:value",
  }),
  "date-time-input": componentContract("textbox", textEdit),
  default: componentContract("application"),
  dialog: componentContract("dialog", {
    callbacks: ["onOpenChange"],
    keys: ["escape"],
    expectedEvent: "open:false",
    focus: false,
  }),
  "diff-viewer": componentContract("status"),
  divider: componentContract("application"),
  drawer: componentContract("dialog", {
    callbacks: ["onOpenChange"],
    keys: ["escape"],
    expectedEvent: "open:false",
    focus: false,
  }),
  "editable-table-cell": componentContract("textbox", textEdit),
  "editable-tree-node": componentContract("textbox", textEdit),
  "error-boundary": componentContract("text", {
    semanticLabel: "error-boundary content",
  }),
  field: componentContract("form"),
  footer: componentContract("text", { semanticLabel: "footer content" }),
  "form-field-editor": componentContract("textbox", multilineEdit),
  header: componentContract("text", { semanticLabel: "header content" }),
  heading: componentContract("heading"),
  "help-overlay": componentContract("dialog", {
    callbacks: ["onOpenChange"],
    keys: ["escape"],
    expectedEvent: "open:false",
    focusId: "acceptance-help-overlay:search",
  }),
  "init-wizard": componentContract("application", {
    semanticLabel: "Workflow tuil.init",
  }),
  "inline-editor": componentContract("textbox", textEdit),
  "json-viewer": componentContract("tree", {
    callbacks: ["onExpandedChange"],
    keys: ["enter"],
    expectedEvent: "expanded:",
  }),
  "log-viewer": componentContract("application", {
    callbacks: ["onFollowChange"],
    keys: ["p"],
    expectedEvent: "follow:false",
  }),
  "markdown-viewer": componentContract("application", {
    callbacks: ["onSelectedBlockChange"],
    keys: ["arrowDown"],
    expectedEvent: "block:1",
    pointer: true,
    pointerCallback: false,
  }),
  menu: componentContract("menu", {
    callbacks: ["onSelect", "onOpenChange"],
    keys: ["enter"],
    expectedEvents: ["select:one", "open:false"],
    pointer: true,
    pointerTargetId: "acceptance-menu:item:one",
  }),
  menubar: componentContract("menu", {
    callbacks: ["onValueChange"],
    keys: ["arrowRight"],
    expectedEvent: "value:one",
    pointer: true,
    pointerTargetId: "acceptance-menubar:menu:one",
  }),
  "multi-select": componentContract("listbox", {
    callbacks: ["onValueChange"],
    keys: ["space"],
    expectedEvent: "value:",
    pointer: true,
    pointerTargetId: "acceptance-multi-select:one",
  }),
  "number-input": componentContract("textbox", {
    callbacks: ["onValueChange"],
    keys: ["arrowUp"],
    expectedEvent: "value:2",
  }),
  "operation-list": componentContract("status", {
    semanticLabel: "Operations",
  }),
  "operation-tree": componentContract("tree", {
    semanticLabel: "Operation tree",
    callbacks: ["onValueChange", "onExpandedChange"],
    keys: ["arrowRight", "enter"],
    expectedEvents: ["operation:", "operation-expanded:"],
  }),
  outline: componentContract("navigation"),
  pagination: componentContract("navigation", {
    callbacks: ["onPageChange"],
    keys: ["arrowRight"],
    expectedEvent: "page:2",
  }),
  "pane-tabs": componentContract("text", {
    semanticLabel: "pane-tabs content",
  }),
  "password-input": componentContract("textbox", {
    ...textEdit,
    expectedEvents: ["value:[redacted]", "submit:[redacted]"],
  }),
  popover: componentContract("dialog", {
    callbacks: ["onOpenChange"],
    keys: ["escape"],
    expectedEvent: "open:false",
    focus: false,
  }),
  progress: componentContract("progressbar"),
  "radio-group": componentContract("radio", {
    semanticLabel: "One",
    callbacks: ["onValueChange"],
    keys: ["arrowRight", "enter"],
    expectedEvent: "value:two",
    pointer: true,
    pointerTargetId: "acceptance-radio-group:one",
  }),
  "resizable-pane": componentContract("application", {
    callbacks: ["onSizeChange"],
    keys: ["end"],
    expectedEvent: "size:30",
  }),
  "rich-diff-viewer": componentContract("application", {
    callbacks: ["onResolveHunk"],
    keys: ["a"],
    expectedEvent: "resolve:0:apply",
    pointer: true,
    pointerCallback: false,
  }),
  "scroll-area": componentContract("application"),
  "search-input": componentContract("textbox", textEdit),
  select: componentContract("listbox", {
    callbacks: ["onValueChange", "onOpenChange"],
    keys: ["enter", "arrowDown", "enter"],
    expectedEvents: ["value:two", "open:"],
    pointer: true,
    pointerTargetId: "acceptance-select:two",
    pointerPreparationKeys: ["enter"],
  }),
  sidebar: componentContract("text", { semanticLabel: "sidebar content" }),
  skeleton: componentContract("text"),
  slider: componentContract("slider", {
    callbacks: ["onValueChange"],
    keys: ["arrowRight"],
    expectedEvent: "value:2",
    pointer: true,
  }),
  spinner: componentContract("status"),
  "splash-screen": componentContract("status"),
  "split-pane": componentContract("application", {
    callbacks: ["onSizesChange"],
    keys: ["arrowRight"],
    expectedEvent: "sizes:",
  }),
  stack: componentContract("application"),
  "status-bar": componentContract("status"),
  stepper: componentContract("status"),
  "structured-content": componentContract("text"),
  switch: componentContract("switch", {
    callbacks: ["onCheckedChange"],
    keys: ["space"],
    expectedEvent: "checked:false",
  }),
  "tab-select": componentContract("navigation", {
    callbacks: ["onValueChange"],
    keys: ["arrowRight"],
    expectedEvent: "value:two",
    pointer: true,
    pointerTargetId: "acceptance-tab-select:tab:one",
  }),
  table: componentContract("table", {
    callbacks: ["onActivate", "onSelectionChange"],
    keys: ["space", "enter"],
    expectedEvents: ["activate:one:value", "selection:one"],
    pointer: true,
    pointerTargetId: "acceptance-table:cell:one:value",
  }),
  tabs: componentContract("navigation", {
    callbacks: ["onValueChange"],
    keys: ["arrowRight"],
    expectedEvent: "value:two",
    pointer: true,
    pointerTargetId: "acceptance-tabs:tab:one",
  }),
  "terminal-platform-plugin": componentContract("application"),
  "text-area": componentContract("textbox", multilineEdit),
  "text-input": componentContract("textbox", textEdit),
  text: componentContract("text"),
  timeline: componentContract("text"),
  toast: componentContract("status", { semanticLabel: "Acceptance" }),
  tooltip: componentContract("status", {
    semanticLabel: "Help for acceptance-tooltip",
    callbacks: ["onOpenChange"],
    keys: ["f1"],
    expectedEvent: "open:false",
    focusId: "acceptance-tooltip",
  }),
  "transfer-list": componentContract("form", {
    callbacks: ["onValueChange", "onTransfer"],
    keys: ["enter"],
    expectedEvents: ["value:one,two", "transfer:two:select"],
  }),
  tree: componentContract("tree", {
    callbacks: ["onSelect", "onExpandedChange"],
    keys: ["arrowRight", "enter"],
    expectedEvents: ["select:one", "expanded:one"],
    pointer: true,
    pointerTargetId: "acceptance-tree:item:one",
  }),
  "virtual-list": componentContract("listbox", {
    callbacks: ["onOffsetChange", "onActiveIndexChange", "onSelect"],
    keys: ["arrowDown", "arrowDown", "arrowDown", "enter"],
    expectedEvents: ["offset:", "active:", "virtual-select:four"],
    pointer: true,
    pointerTargetId: "acceptance-virtual-list:item:one",
  }),
  workflow: componentContract("application", {
    semanticLabel: "Workflow acceptance",
  }),
});

export const componentAcceptanceInventory: readonly ComponentAcceptanceEntry[] =
  Object.freeze(
    registryIndex.items.map((item) => {
      const capabilities = componentCapabilityContracts[item.name];
      if (!capabilities) {
        throw new Error(`Missing component capability contract "${item.name}"`);
      }
      const fixtureId =
        item.name === "data-table"
          ? "acceptance-data-table"
          : `acceptance-${item.name}`;
      return Object.freeze({
        ...item,
        storyId: `component-acceptance--${item.name}`,
        storySource: "apps/showcase/src/component-acceptance.stories.tsx",
        storyExport: registryExportName(item.name),
        docsPath: `/docs/reference/components/acceptance-catalog#${item.title
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, "-")
          .replaceAll(/^-|-$/g, "")}`,
        docsSource:
          "apps/docs/content/docs/reference/components/acceptance-catalog.mdx",
        testSource: "tests/component-acceptance.test.ts",
        fixtureId,
        snapshotId: `component-acceptance:${item.name}:static`,
        expectedRole: capabilities.semanticRole,
        expectedLabel:
          capabilities.semanticLabel ??
          (capabilities.semanticRole === "text"
            ? undefined
            : `${item.name} acceptance`),
        capabilities,
        interaction: capabilities.interaction
          ? Object.freeze({
              ...capabilities.interaction,
              focusId:
                capabilities.focus &&
                !capabilities.interaction.focusId &&
                !capabilities.interaction.focusRole
                  ? fixtureId
                  : capabilities.interaction.focusId,
            })
          : undefined,
        staticContract: `${item.name}:deterministic-static`,
        themeContract: `${item.name}:theme-render`,
      });
    }),
  );

export function validateComponentAcceptanceInventory(): void {
  const names = new Set<string>();
  const stories = new Set<string>();
  const fixtures = new Set<string>();
  const snapshots = new Set<string>();
  const contractNames = new Set(Object.keys(componentCapabilityContracts));
  for (const entry of componentAcceptanceInventory) {
    if (names.has(entry.name))
      throw new Error(`Duplicate component acceptance entry "${entry.name}"`);
    if (stories.has(entry.storyId))
      throw new Error(`Duplicate component story "${entry.storyId}"`);
    if (fixtures.has(entry.fixtureId))
      throw new Error(`Duplicate component fixture "${entry.fixtureId}"`);
    if (snapshots.has(entry.snapshotId))
      throw new Error(`Duplicate component snapshot "${entry.snapshotId}"`);
    names.add(entry.name);
    stories.add(entry.storyId);
    fixtures.add(entry.fixtureId);
    snapshots.add(entry.snapshotId);
    contractNames.delete(entry.name);
    if (
      entry.capabilities.callbacks.length !==
      (entry.interaction?.expectedEvents.length ?? 0)
    ) {
      throw new Error(
        `Component acceptance entry "${entry.name}" must assert one event for every declared callback`,
      );
    }
  }
  if (contractNames.size > 0) {
    throw new Error(
      `Unknown component capability contracts: ${[...contractNames].join(", ")}`,
    );
  }
}

function markdownCodeList(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(", ");
}

function acceptanceFocusText(
  interaction: ComponentInteractionContract | undefined,
): string {
  if (interaction?.focusId) return `id \`${interaction.focusId}\``;
  const descriptors = [
    interaction?.focusRole ? `role \`${interaction.focusRole}\`` : undefined,
    interaction?.focusLabel ? `label \`${interaction.focusLabel}\`` : undefined,
  ].filter((value): value is string => Boolean(value));
  return descriptors.length > 0 ? descriptors.join(" and ") : "not focusable";
}

function acceptancePointerText(
  interaction: ComponentInteractionContract | undefined,
): string {
  if (!interaction?.pointer) return "not supported";
  const assertion = interaction.pointerCallback
    ? "callback state asserted"
    : "hit testing and focus asserted";
  return `measured target \`${interaction.pointerTargetId ?? interaction.focusId}\`; ${assertion}`;
}

export function componentAcceptanceDocumentationLines(
  entry: ComponentAcceptanceEntry,
): readonly string[] {
  const interaction = entry.interaction;
  const semanticLabel = entry.expectedLabel
    ? ` labelled \`${entry.expectedLabel}\``
    : "";
  const keyboard = interaction
    ? `${markdownCodeList(interaction.keys)} -> ${markdownCodeList(interaction.expectedEvents)}`
    : "not supported";
  return Object.freeze([
    `- Registry name: \`${entry.name}\``,
    `- Story: \`${entry.storyId}\``,
    `- Fixture: \`${entry.fixtureId}\``,
    `- Semantics: role \`${entry.expectedRole}\`${semanticLabel}`,
    `- Callbacks: ${
      entry.capabilities.callbacks.length > 0
        ? markdownCodeList(entry.capabilities.callbacks)
        : "none"
    }`,
    `- Keyboard: ${keyboard}`,
    `- Focus: ${acceptanceFocusText(interaction)}`,
    `- Pointer: ${acceptancePointerText(interaction)}`,
    `- Theme: live update asserted by \`${entry.themeContract}\``,
    `- Static: deterministic output asserted by \`${entry.staticContract}\``,
    `- Behavior: ${entry.description}`,
  ]);
}
