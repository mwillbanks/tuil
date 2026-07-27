import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

interface PackageGuidance {
  readonly operation: string;
  readonly lifecycle: string;
  readonly events: string;
  readonly example: string;
}

const packageGuidance: Readonly<Record<string, PackageGuidance>> = {
  cli: {
    operation:
      "The CLI validates configuration, resolves registry dependency graphs, plans every write, and only then applies source-owned files. Initializers and installers share the same conflict-safe transaction boundary.",
    lifecycle:
      "arguments → validation → plan → conflict check → write → receipt",
    events:
      "The CLI does not publish runtime events. It reports deterministic command results and actionable errors to the invoking process.",
    example: "npx @mwillbanks/tuil create my-terminal-app",
  },
  core: {
    operation:
      "Core owns the framework-neutral contracts used by every adapter: lifecycle stages, services, commands, terminal capabilities, semantic metadata, disposables, and render-mode resolution.",
    lifecycle:
      "configuration → initialization → mount → ready → stop → disposal",
    events:
      "Core defines lifecycle state but does not own the event transport. The umbrella runtime projects lifecycle transitions onto `app:*` events.",
    example:
      'const lifecycle = new Lifecycle();\nawait lifecycle.transition("initializing");',
  },
  devtools: {
    operation:
      "Devtools subscribes to runtime snapshots without changing application state. The overlay exposes lifecycle, focus, services, commands, plugins, events, capabilities, and theme information.",
    lifecycle: "mount inspector → subscribe → render snapshots → unsubscribe",
    events:
      "Reads the runtime event history and observer stream. It does not emit application events.",
    example: "render(<TuilDevtools />);",
  },
  events: {
    operation:
      "The typed event bus validates declared event names, schedules by priority, supports capture/target/bubble routing, redacts observed payloads, and keeps a bounded diagnostic history.",
    lifecycle: "declare → subscribe → emit → route phases → observe → dispose",
    events:
      "`EventBus.emit()` produces `TuilEvent` objects with source, target, metadata, priority, phase, cancellation, and propagation controls.",
    example:
      'const events = new EventBus(defineEvents({ "build:done": event<{ id: string }>() }));\nawait events.emit("build:done", { id: "42" });',
  },
  focus: {
    operation:
      "Focus scopes register semantic targets, order traversal deterministically, support directional movement, suspend or restore nested scopes, and expose an observable snapshot.",
    lifecycle:
      "register scope → register node → activate → move → suspend/restore → dispose",
    events:
      "Focus changes are exposed through subscriptions; components use them with `useSyncExternalStore` rather than a separate event name.",
    example:
      'const focus = new FocusManager();\nfocus.register({ id: "save", scopeId: "dialog" });\nfocus.focus("save");',
  },
  form: {
    operation:
      "Form state coordinates field registration, values, touched and dirty state, sync or async validators, submission, reset, and framework adapters.",
    lifecycle:
      "register fields → edit → validate → submit or reject → reset/dispose",
    events:
      "State changes are subscription-based. UI controls expose `onValueChange`, `onSubmit`, and field-level callbacks.",
    example:
      'const form = createForm({ initialValues: { name: "" }, onSubmit: async (values) => save(values) });',
  },
  hotkeys: {
    operation:
      "Hotkey bindings normalize terminal input, match chords and sequences, honor active scopes, resolve priorities, and dispose cleanly.",
    lifecycle: "register → scope match → sequence match → dispatch → dispose",
    events:
      "Bindings invoke handlers directly. Dispatch failures are routed to the caller-supplied error handler.",
    example:
      'hotkeys.register({ keys: "ctrl+s", scope: "application", handler: save });',
  },
  ink: {
    operation:
      "The Ink adapter composes runtime, theme, focus, hotkeys, semantics, overlays, and terminal input around Ink rendering. It supports interactive output, static output, and capability-aware fallbacks.",
    lifecycle:
      "create runtime tree → attach input → render → wait or snapshot → unmount",
    events:
      "Input first flows through overlay handlers, scoped terminal handlers, hotkeys, then focus traversal. Application events remain on the runtime event bus.",
    example:
      "const instance = render(<App />, { app });\nawait instance.waitUntilExit();",
  },
  operations: {
    operation:
      "Operation executors track progress, retries, cancellation, timeouts, dependencies, rollback, logs, and immutable observable snapshots.",
    lifecycle:
      "idle → running → succeeded | failed | cancelled → optional rollback",
    events:
      "Executors expose snapshot subscriptions and operation progress rather than stringly typed global events.",
    example:
      'const operation = defineOperation({ id: "build", run: async ({ progress }) => progress(1) });',
  },
  plugin: {
    operation:
      "Plugins declare capabilities and dependencies, register services, commands, events, and typed extension points, then activate in dependency order with deterministic reverse teardown.",
    lifecycle:
      "resolve graph → register → initialize → activate → deactivate → dispose",
    events:
      "Plugins may declare or subscribe to the host application event map. Plugin health is exposed as an observable runtime surface.",
    example:
      'const plugin = createPlugin({ id: "analytics", activate(context) { return context.events.observe(track); } });',
  },
  registry: {
    operation:
      "Registry sources describe source-owned components, blocks, themes, dependencies, files, and integrity metadata. HTTP sources enforce secure URL and package metadata boundaries.",
    lifecycle:
      "load source → validate manifest → resolve dependencies → verify files → install",
    events:
      "Registry resolution returns explicit results and diagnostics. It does not emit runtime application events.",
    example:
      'const source = new HttpRegistrySource({ id: "official", url: "https://example.com/registry.json" });',
  },
  router: {
    operation:
      "The terminal router matches typed routes, executes guards and loaders, manages history and layouts, exposes navigation surfaces, and restores focus after transitions.",
    lifecycle:
      "intent → match → before guards → loader → commit → focus restore → after hooks",
    events:
      "`router:navigation-start`, `router:navigation-complete`, `router:navigation-cancel`, and `router:navigation-error` describe transition outcomes.",
    example:
      'const router = createRouter(defineRoutes({ home: route({ path: "/" }) }));\nawait router.navigate("home");',
  },
  story: {
    operation:
      "Portable stories combine component args with terminal capabilities, themes, semantic nodes, focus state, events, ANSI output, and an action history. Adapters expose the same story to tests, browsers, static docs, and Storybook.",
    lifecycle:
      "register story → open session → render → interact/update → close",
    events:
      "Every rendered frame captures the runtime's observed event history and story action timeline.",
    example:
      'export const stories = defineTuilStories({ component: Button, stories: { Default: { args: { children: "Run" } } } });',
  },
  testing: {
    operation:
      "Testing contracts query semantic output instead of terminal coordinates, define portable stories, and provide screen-style role, label, state, and text assertions.",
    lifecycle: "render → query semantics → interact → assert → cleanup",
    events:
      "Story and test results expose captured runtime events for deterministic assertions.",
    example:
      'expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();',
  },
  "testing-ink": {
    operation:
      "The Ink test renderer creates a real tuil runtime and semantic registry around `ink-testing-library`, then coordinates input, resize, frame, event, focus, and cleanup helpers.",
    lifecycle: "render runtime → interact → flush → inspect → unmount",
    events:
      "Tests can inspect event history and wait on rendered state after input settles.",
    example:
      'const view = renderTuil(<Button id="run">Run</Button>);\nawait view.press("enter");',
  },
  theme: {
    operation:
      "Themes normalize token sets, component defaults, slots, variants, terminal capabilities, and spacing. Registries resolve named themes while `ThemeController` provides live observable switching.",
    lifecycle: "define → normalize → register → resolve → switch → unsubscribe",
    events:
      "Theme changes use `ThemeController.subscribe()` so React consumers remain consistent with `useSyncExternalStore`.",
    example:
      'const themes = createDefaultThemeRegistry();\napp.themeController.set(themes.resolve("default-light"));',
  },
  tuil: {
    operation:
      "The umbrella runtime owns the application boundary: lifecycle, services, commands, focus, hotkeys, event bus, terminal capabilities, theme controller, plugins, extension registries, and the root component.",
    lifecycle:
      "configure → initialize → mount → ready → stop → dispose all owned resources",
    events:
      "`app:configure`, `app:initialize`, `app:mount`, `app:ready`, `app:error`, `app:stop`, and `app:dispose` are always declared.",
    example:
      'const app = createApp({ id: "demo", component: App });\nrender(<App />, { app });',
  },
  virtual: {
    operation:
      "Terminal virtualization adapts TanStack Virtual measurements to rows and columns, returning visible indexes, overscan, before/after space, and fixed-width text fitting.",
    lifecycle:
      "measure viewport → project range → render visible rows → remeasure",
    events:
      "Virtualization is pure or subscription-driven at the component layer; no global events are emitted.",
    example:
      "const range = useTerminalVirtualizer({ count: 10_000, viewportSize: 20, scrollOffset });",
  },
  workflow: {
    operation:
      "Workflow runners coordinate typed state, guarded transitions, validation, nested and parallel work, operations, persistence, migration, retry, cancellation, and compensation.",
    lifecycle:
      "idle → running → blocked | completed | failed | cancelled | rolling-back",
    events:
      "`workflow:start`, `workflow:step-enter`, `workflow:step-leave`, `workflow:validate`, `workflow:skip`, `workflow:back`, `workflow:resume`, `workflow:retry`, `workflow:rollback`, `workflow:cancel`, `workflow:complete`, and `workflow:error`.",
    example:
      'const runner = createWorkflow(defineWorkflow({ id: "setup", version: 1, initialState: {}, steps, transitions }));',
  },
};

interface ComponentGroup {
  readonly slug: string;
  readonly title: string;
  readonly icon: string;
  readonly story: string;
  readonly registryItems?: readonly string[];
  readonly files: readonly string[];
  readonly components: readonly string[];
  readonly summary: string;
  readonly interaction: string;
  readonly events: string;
}

const componentGroups: readonly ComponentGroup[] = [
  {
    slug: "application-shell",
    title: "Application shell",
    icon: "SquaresFour",
    story: "shellStory",
    registryItems: ["app-shell", "app-bar", "status-bar"],
    files: [
      "registry/components/app-shell.tsx",
      "registry/components/app-bar.tsx",
      "registry/components/status-bar.tsx",
    ],
    components: ["AppShell", "AppBar", "StatusBar"],
    summary:
      "Compose full-screen terminal applications from a main content region, top application bar, and bottom status surface.",
    interaction:
      "These are structural components. Child navigation, commands, and controls own interaction.",
    events:
      "Shell components forward child behavior and do not emit their own events.",
  },
  {
    slug: "layout",
    title: "Layout and panes",
    icon: "Boxes",
    story: "layoutStory",
    registryItems: [
      "box",
      "container",
      "stack",
      "split-pane",
      "resizable-pane",
    ],
    files: [
      "registry/primitives/box.tsx",
      "registry/primitives/container.tsx",
      "registry/primitives/stack.tsx",
      "registry/layout/panes.tsx",
      "registry/layout/resizable-pane.tsx",
    ],
    components: [
      "Box",
      "Container",
      "Stack",
      "HStack",
      "VStack",
      "Pane",
      "SplitPane",
      "ResizablePane",
    ],
    summary:
      "Build capability-aware rows, columns, bounded containers, split panes, and keyboard-resizable regions.",
    interaction:
      "Resizable panes consume scoped arrow-key input while passive layout primitives only project Ink layout props.",
    events:
      "`ResizablePane` reports size changes through `onSizeChange`; other layout components are passive.",
  },
  {
    slug: "button",
    title: "Button",
    icon: "CursorClick",
    story: "buttonStory",
    registryItems: ["button"],
    files: ["registry/components/button.tsx"],
    components: ["Button"],
    summary:
      "A semantic, focusable terminal action with theme variants, disabled state, and keyboard activation.",
    interaction:
      "Enter and Space invoke `onPress` while the button is enabled.",
    events: "`onPress` may be synchronous or asynchronous.",
  },
  {
    slug: "typography-status",
    title: "Typography and status",
    icon: "BookOpenText",
    story: "typographyStory",
    registryItems: ["text", "heading", "divider", "badge"],
    files: [
      "registry/data-display/text.tsx",
      "registry/data-display/heading.tsx",
      "registry/data-display/divider.tsx",
      "registry/data-display/badge.tsx",
    ],
    components: ["Text", "Heading", "Divider", "Badge"],
    summary:
      "Render styled terminal copy, hierarchy, separators, labels, and compact status signals with semantic metadata.",
    interaction:
      "Read-only presentation; accessibility lives in semantic role and label metadata.",
    events: "No events are emitted.",
  },
  {
    slug: "feedback",
    title: "Feedback",
    icon: "Lightning",
    story: "feedbackStory",
    registryItems: ["alert", "progress", "spinner"],
    files: [
      "registry/feedback/alert.tsx",
      "registry/feedback/progress.tsx",
      "registry/feedback/spinner.tsx",
    ],
    components: ["Alert", "Progress", "Spinner"],
    summary:
      "Communicate messages, completion, and pending work with theme tokens and reduced-motion behavior.",
    interaction: "Read-only; update props as application state changes.",
    events: "No events are emitted.",
  },
  {
    slug: "overlays",
    title: "Dialogs, toasts, and overlays",
    icon: "Browser",
    story: "overlaysStory",
    registryItems: [
      "dialog",
      "confirm-dialog",
      "tooltip",
      "toast",
      "command-palette",
    ],
    files: ["registry/feedback/overlays.tsx"],
    components: [
      "Dialog",
      "Dialog.Trigger",
      "Dialog.Content",
      "Dialog.Title",
      "Dialog.Description",
      "Dialog.Confirm",
      "Dialog.Cancel",
      "ConfirmDialog",
      "Tooltip",
      "ToastProvider",
      "useToast",
      "Toast",
      "ToastViewport",
      "CommandPalette",
    ],
    summary:
      "Layer focus-trapped dialogs, contextual help, transient notices, and searchable command execution over an application.",
    interaction:
      "The top overlay receives input before application hotkeys. Escape closes dismissible overlays and focus returns to the prior node.",
    events:
      "Open state and selections flow through `onOpenChange`, `onPress`, command callbacks, and the toast API.",
  },
  {
    slug: "forms",
    title: "Forms and controls",
    icon: "BracketsCurly",
    story: "formsStory",
    registryItems: [
      "field",
      "text-input",
      "text-area",
      "number-input",
      "checkbox",
      "switch",
      "radio-group",
      "select",
      "multi-select",
      "autocomplete",
    ],
    files: ["registry/forms/controls.tsx"],
    components: [
      "Form",
      "ValidationSummary",
      "Field",
      "FieldLabel",
      "FieldDescription",
      "FieldError",
      "FieldHint",
      "FieldGroup",
      "FieldSet",
      "TextInput",
      "TextArea",
      "NumberInput",
      "Checkbox",
      "Switch",
      "RadioGroup",
      "Select",
      "MultiSelect",
      "Autocomplete",
    ],
    summary:
      "Connect semantic terminal controls to typed form state, validation, descriptions, errors, hints, and submission.",
    interaction:
      "Text controls edit directly; choice controls use arrows and Space or Enter; `Form` coordinates validation and submission.",
    events:
      "Controls expose `onValueChange`, `onSubmit`, focus, selection, and validation callbacks.",
  },
  {
    slug: "transfer-list",
    title: "Transfer list",
    icon: "ArrowsClockwise",
    story: "transferStory",
    registryItems: ["transfer-list"],
    files: ["registry/forms/transfer-list.tsx"],
    components: ["TransferList"],
    summary:
      "Move typed items between available and selected collections without losing keyboard focus or semantic identity.",
    interaction:
      "Arrow keys navigate, Space selects, and Tab changes the active collection.",
    events: "`onValueChange` receives the selected item set.",
  },
  {
    slug: "navigation",
    title: "Navigation",
    icon: "Compass",
    story: "navigationStory",
    registryItems: ["tabs", "menu", "menubar", "breadcrumbs", "stepper"],
    files: ["registry/navigation/navigation.tsx"],
    components: ["Tabs", "Menu", "Menubar", "Breadcrumbs", "Stepper"],
    summary:
      "Provide terminal-native local navigation, command menus, hierarchical trails, and workflow progress.",
    interaction:
      "Arrow keys move within the active navigation model; Enter selects or activates.",
    events:
      "Selections and value changes are reported through component callbacks.",
  },
  {
    slug: "tables",
    title: "Tables",
    icon: "ListBullets",
    story: "tableStory",
    registryItems: ["table", "data-table"],
    files: ["registry/data-display/complex-data.tsx"],
    components: ["Table", "DataTable"],
    summary:
      "Render typed rows and columns with terminal-width fitting, virtualization, sorting, selection, and cell activation.",
    interaction:
      "Arrow keys navigate cells or rows; Space toggles selection; Enter activates; configured keys sort columns.",
    events:
      "`onActivate`, `onSelectionChange`, `onToggleSelection`, and `onSortColumn` expose table intent.",
  },
  {
    slug: "tree",
    title: "Tree",
    icon: "TreeStructure",
    story: "treeStory",
    registryItems: ["tree"],
    files: ["registry/data-display/tree.tsx"],
    components: ["Tree"],
    summary:
      "Display nested typed data with stable IDs, expansion state, virtual rows, and semantic tree nodes.",
    interaction:
      "Up and Down move, Right expands, Left collapses or moves to the parent, and Enter activates.",
    events: "Expansion and activation are surfaced through callbacks.",
  },
  {
    slug: "structured-viewers",
    title: "Logs, JSON, and diffs",
    icon: "Database",
    story: "logsStory",
    registryItems: ["log-viewer", "json-viewer", "diff-viewer"],
    files: [
      "registry/data-display/log-viewer.tsx",
      "registry/data-display/json-viewer.tsx",
      "registry/data-display/diff-viewer.tsx",
    ],
    components: [
      "LogViewer",
      "JsonViewer",
      "flattenJson",
      "DiffViewer",
      "createLineDiff",
    ],
    summary:
      "Inspect streaming logs, expandable structured values, and line-oriented changes in terminal-bounded viewports.",
    interaction:
      "Viewers scroll and filter; JSON nodes expand or collapse; diff output remains deterministic in static mode.",
    events:
      "`LogViewer` reports follow state; JSON expansion can be controlled; pure transformation helpers emit nothing.",
  },
  {
    slug: "virtual-list",
    title: "Virtual list",
    icon: "FlowArrow",
    story: "virtualStory",
    registryItems: ["virtual-list"],
    files: ["registry/data-display/virtual-list.tsx"],
    components: ["VirtualList"],
    summary:
      "Render large collections by projecting only the terminal-visible range plus configurable overscan.",
    interaction:
      "The host controls scroll offset and active item while the component maintains semantic row identity.",
    events: "Range and activation changes are exposed through callbacks.",
  },
  {
    slug: "workflow",
    title: "Workflow UI",
    icon: "FlowArrow",
    story: "workflowStory",
    registryItems: [
      "workflow",
      "operation-list",
      "operation-tree",
      "splash-screen",
      "help-overlay",
    ],
    files: ["registry/workflows/workflow.tsx"],
    components: [
      "Workflow",
      "Workflow.Header",
      "Workflow.Body",
      "Workflow.Footer",
      "Workflow.Progress",
      "Workflow.Errors",
      "Workflow.Next",
      "Workflow.Back",
      "Workflow.Skip",
      "Workflow.Cancel",
      "OperationList",
      "OperationTree",
      "SplashScreen",
      "HelpOverlay",
    ],
    summary:
      "Bind observable workflow and operation snapshots to guided terminal flows, progress, errors, cancellation, splash state, and contextual help.",
    interaction:
      "Controls call the runner's next, back, skip, retry, cancel, and rollback operations with transition locking.",
    events:
      "The runner emits the complete `workflow:*` lifecycle; operation components reflect operation snapshots and callbacks.",
  },
  {
    slug: "initializer",
    title: "Project initializer",
    icon: "RocketLaunch",
    story: "initializerStory",
    registryItems: ["init-wizard"],
    files: ["registry/blocks/init-wizard.tsx"],
    components: ["InitWizard"],
    summary:
      "A complete source-owned application block combining forms, navigation, dialogs, operations, themes, and workflow state into a project creator.",
    interaction:
      "The guided flow validates names, template choice, features, confirmation, cancellation, and capability-aware static fallbacks.",
    events:
      "`onComplete` returns validated answers and `onCancel` reports abandonment.",
  },
  {
    slug: "terminal-image",
    title: "Terminal image",
    icon: "Aperture",
    story: "imageStory",
    files: ["packages/ink/src/image.tsx"],
    components: ["Image", "resolveImageProtocol", "renderImageFallback"],
    summary:
      "Render terminal images when the capability profile permits them and deterministic text fallbacks everywhere else.",
    interaction:
      "Image output follows terminal capability detection and explicit dimensions.",
    events: "No events are emitted.",
  },
];

interface ApiSymbol {
  readonly name: string;
  readonly kind: string;
  readonly file: string;
}

type MaskMode =
  | "code"
  | "single"
  | "double"
  | "template"
  | "template-expression"
  | "line-comment"
  | "block-comment";

interface MaskContext {
  readonly mode: MaskMode;
  braceDepth?: number;
}

interface MaskState {
  readonly chars: string[];
  readonly stack: MaskContext[];
}

function hideCharacter(state: MaskState, index: number): void {
  if (state.chars[index] !== "\n" && state.chars[index] !== "\r") {
    state.chars[index] = " ";
  }
}

function hiddenContext(char: string | undefined, next: string | undefined) {
  if (char === "/" && next === "/") return { mode: "line-comment" } as const;
  if (char === "/" && next === "*") return { mode: "block-comment" } as const;
  if (char === "'") return { mode: "single" } as const;
  if (char === '"') return { mode: "double" } as const;
  if (char === "`") return { mode: "template" } as const;
  return undefined;
}

function maskCode(state: MaskState, index: number): number {
  const context = hiddenContext(state.chars[index], state.chars[index + 1]);
  if (!context) return index + 1;
  state.stack.push(context);
  hideCharacter(state, index);
  return index + 1;
}

function maskLineComment(state: MaskState, index: number): number {
  hideCharacter(state, index);
  if (state.chars[index] === "\n" || state.chars[index] === "\r") {
    state.stack.pop();
  }
  return index + 1;
}

function maskBlockComment(state: MaskState, index: number): number {
  hideCharacter(state, index);
  if (state.chars[index] !== "*" || state.chars[index + 1] !== "/") {
    return index + 1;
  }
  hideCharacter(state, index + 1);
  state.stack.pop();
  return index + 2;
}

function maskQuote(state: MaskState, index: number): number {
  const context = state.stack.at(-1) as MaskContext;
  const quote = context.mode === "single" ? "'" : '"';
  const char = state.chars[index];
  hideCharacter(state, index);
  if (char === "\\") {
    hideCharacter(state, index + 1);
    return index + 2;
  }
  if (char === quote) state.stack.pop();
  return index + 1;
}

function maskTemplate(state: MaskState, index: number): number {
  const char = state.chars[index];
  const next = state.chars[index + 1];
  hideCharacter(state, index);
  if (char === "\\") {
    hideCharacter(state, index + 1);
    return index + 2;
  }
  if (char === "`") {
    state.stack.pop();
    return index + 1;
  }
  if (char === "$" && next === "{") {
    hideCharacter(state, index + 1);
    state.stack.push({ mode: "template-expression", braceDepth: 0 });
    return index + 2;
  }
  return index + 1;
}

function maskTemplateExpression(state: MaskState, index: number): number {
  const context = state.stack.at(-1) as MaskContext;
  const char = state.chars[index];
  const nested = hiddenContext(char, state.chars[index + 1]);
  hideCharacter(state, index);
  if (nested) {
    state.stack.push(nested);
  } else if (char === "{") {
    context.braceDepth = (context.braceDepth ?? 0) + 1;
  } else if (char === "}" && (context.braceDepth ?? 0) === 0) {
    state.stack.pop();
  } else if (char === "}") {
    context.braceDepth = (context.braceDepth ?? 0) - 1;
  }
  return index + 1;
}

const maskHandlers: Readonly<
  Record<MaskMode, (state: MaskState, index: number) => number>
> = {
  code: maskCode,
  "line-comment": maskLineComment,
  "block-comment": maskBlockComment,
  single: maskQuote,
  double: maskQuote,
  template: maskTemplate,
  "template-expression": maskTemplateExpression,
};

function maskedSource(content: string): string {
  const state: MaskState = {
    chars: content.split(""),
    stack: [{ mode: "code" }],
  };
  let index = 0;
  while (index < state.chars.length) {
    const context = state.stack.at(-1) as MaskContext;
    index = maskHandlers[context.mode](state, index);
  }
  return state.chars.join("");
}

function exportedName(specifier: string): string | undefined {
  const name = specifier
    .trim()
    .replace(/^type\s+/, "")
    .split(/\s+as\s+/)
    .at(-1);
  return name && /^[A-Za-z_$][\w$]*$/.test(name) ? name : undefined;
}

function declaredPublicSymbols(masked: string, file: string): ApiSymbol[] {
  const symbols: ApiSymbol[] = [];
  for (const match of masked.matchAll(
    /^export\s+(?:declare\s+)?(?:async\s+)?(class|function|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    const rawKind = match[1];
    const name = match[2];
    if (!rawKind || !name) continue;
    symbols.push({
      name,
      kind: ["const", "let", "var"].includes(rawKind) ? "constant" : rawKind,
      file,
    });
  }
  return symbols;
}

function namedPublicSymbols(
  masked: string,
  runtimeExports: ReadonlySet<string>,
  file: string,
): ApiSymbol[] {
  const symbols: ApiSymbol[] = [];
  for (const match of masked.matchAll(/^export\s+(type\s+)?\{([^}]*)\}/gm)) {
    const typeOnly = Boolean(match[1]);
    for (const rawSpecifier of (match[2] ?? "").split(",")) {
      const name = exportedName(rawSpecifier);
      if (
        name &&
        (typeOnly ||
          rawSpecifier.trim().startsWith("type ") ||
          runtimeExports.has(name))
      ) {
        symbols.push({ name, kind: "export", file });
      }
    }
  }
  return symbols;
}

function starExportSpecifiers(content: string, masked: string): string[] {
  const specifiers: string[] = [];
  for (const match of content.matchAll(
    /^export\s+\*\s+from\s+["']([^"']+)["']/gm,
  )) {
    if (match.index !== undefined && masked.startsWith("export", match.index)) {
      const specifier = match[1];
      if (specifier) specifiers.push(specifier);
    }
  }
  return specifiers;
}

async function scanPublicExports(
  content: string,
  file: string,
): Promise<{
  readonly symbols: ApiSymbol[];
  readonly starExports: readonly string[];
}> {
  const masked = maskedSource(content);
  const runtimeExports = new Set(
    (
      await new Bun.Transpiler({
        loader: file.endsWith(".tsx") ? "tsx" : "ts",
      }).scan(content)
    ).exports,
  );
  return {
    symbols: [
      ...declaredPublicSymbols(masked, file),
      ...namedPublicSymbols(masked, runtimeExports, file),
    ],
    starExports: starExportSpecifiers(content, masked),
  };
}

async function existingSourceFile(base: string): Promise<string | undefined> {
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return undefined;
}

async function resolveExportSource(
  workspace: string,
  currentFile: string,
  specifier: string,
): Promise<string | undefined> {
  if (specifier.startsWith(".")) {
    return existingSourceFile(resolve(dirname(currentFile), specifier));
  }
  const match = /^@mwillbanks\/tuil(?:-([^/]+))?(?:\/(.+))?$/.exec(specifier);
  if (!match) return undefined;
  const packageDirectory = match[1] ?? "tuil";
  const entrypoint = match[2] ?? "index";
  return existingSourceFile(
    resolve(workspace, "packages", packageDirectory, "src", entrypoint),
  );
}

async function publicSourceEntrypoints(
  workspace: string,
  directory: string,
  exportMap: Readonly<Record<string, unknown>>,
): Promise<string[]> {
  const entrypoints: string[] = [];
  for (const subpath of Object.keys(exportMap)) {
    const entrypoint = subpath === "." ? "index" : subpath.replace(/^\.\//, "");
    const file = await existingSourceFile(
      resolve(workspace, "packages", directory, "src", entrypoint),
    );
    if (!file) {
      throw new Error(
        `Cannot map the public export ${subpath} for ${directory} to source`,
      );
    }
    entrypoints.push(file);
  }
  return entrypoints;
}

async function exportedSymbols(
  workspace: string,
  entrypoints: readonly string[],
): Promise<ApiSymbol[]> {
  const symbols: ApiSymbol[] = [];
  const visited = new Set<string>();
  async function visit(file: string): Promise<void> {
    if (visited.has(file)) return;
    visited.add(file);
    const content = await readFile(file, "utf8");
    const relativeFile = relative(workspace, file);
    const publicExports = await scanPublicExports(content, relativeFile);
    symbols.push(...publicExports.symbols);
    for (const specifier of publicExports.starExports) {
      const target = await resolveExportSource(workspace, file, specifier);
      if (target) await visit(target);
    }
  }
  for (const entrypoint of entrypoints) await visit(entrypoint);
  return [
    ...new Map(
      symbols
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((symbol) => [`${symbol.name}:${symbol.kind}`, symbol]),
    ).values(),
  ];
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function symbolTable(symbols: readonly ApiSymbol[]): string {
  if (symbols.length === 0) return "No public declarations were discovered.";
  return [
    "| Export | Kind | Source |",
    "| --- | --- | --- |",
    ...symbols.map(
      (symbol) =>
        `| \`${escapeTable(symbol.name)}\` | ${symbol.kind} | \`${escapeTable(symbol.file)}\` |`,
    ),
  ].join("\n");
}

function mermaidLifecycle(value: string): string {
  const stages = value.split("→").map((stage) => stage.trim());
  return [
    "```mermaid",
    "flowchart LR",
    ...stages.map((stage, index) => `  S${index}["${stage}"]`),
    ...stages.slice(1).map((_stage, index) => `  S${index} --> S${index + 1}`),
    "```",
  ].join("\n");
}

async function packagePage(
  workspace: string,
  directory: string,
): Promise<{ readonly slug: string; readonly title: string }> {
  const manifestPath = resolve(
    workspace,
    "packages",
    directory,
    "package.json",
  );
  const manifest = (await Bun.file(manifestPath).json()) as {
    readonly name: string;
    readonly description: string;
    readonly exports: Readonly<Record<string, unknown>>;
  };
  const guidance = packageGuidance[directory];
  if (!guidance) throw new Error(`Missing package docs for ${directory}`);
  const symbols = await exportedSymbols(
    workspace,
    await publicSourceEntrypoints(workspace, directory, manifest.exports),
  );
  const content = `---
title: ${JSON.stringify(manifest.name)}
description: ${JSON.stringify(manifest.description)}
icon: Package
---

## Overview

${manifest.description}

\`${manifest.name}\` is independently installable and also participates in the
umbrella \`@mwillbanks/tuil\` runtime where applicable.

## Installation

\`\`\`npm
npm install ${manifest.name}
\`\`\`

## How it operates

${guidance.operation}

${mermaidLifecycle(guidance.lifecycle)}

## API

${symbolTable(symbols)}

## Events and lifecycle

${guidance.events}

All subscriptions and registrations return a disposer or belong to an owning
runtime that disposes them in reverse order.

## Example

\`\`\`tsx
${guidance.example}
\`\`\`

## Related

- [Package architecture](/docs/concepts/packages)
- [Events](/docs/concepts/events)
- [Testing](/docs/guides/testing)
`;
  const output = resolve(
    workspace,
    "apps/docs/content/docs/reference/packages",
    directory,
    "index.mdx",
  );
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, content, "utf8");
  return { slug: directory, title: manifest.name };
}

async function componentPage(
  workspace: string,
  group: ComponentGroup,
): Promise<void> {
  const discovered = await exportedSymbols(
    workspace,
    group.files.map((file) => resolve(workspace, file)),
  );
  const byName = new Map(discovered.map((symbol) => [symbol.name, symbol]));
  const symbols = group.components.map(
    (name): ApiSymbol =>
      byName.get(name) ?? {
        name,
        kind: name.includes(".") ? "subcomponent" : "component",
        file: group.files[0] ?? "registry",
      },
  );
  const exampleImport = group.files[0]?.startsWith("registry/")
    ? `@/components/tuil/${group.files[0]
        .replace(/^registry\//, "")
        .replace(/\.tsx$/, "")}`
    : "@mwillbanks/tuil-ink";
  const install = group.registryItems
    ? `## Installation

\`\`\`npm
npx @mwillbanks/tuil add ${group.registryItems.join(" ")}
\`\`\`

The CLI writes source-owned components beneath the destination configured in
\`tuil.config.ts\`; the default import below assumes \`src/components/tuil\`.

`
    : "";
  const content = `---
title: ${JSON.stringify(group.title)}
description: ${JSON.stringify(group.summary)}
icon: ${group.icon}
---

import { ${group.story} as ComponentStory } from '@/components/reference-stories.story';

## Overview

${group.summary}

${install}<ComponentStory.WithControl />

## Components and subcomponents

${symbolTable(symbols)}

## Interaction

${group.interaction}

## API and events

${group.events}

Every interactive component publishes semantic roles, labels, state, and focus
identity through the renderer's \`SemanticRegistry\`. Callback failures flow to
the owning application's error boundary.

${mermaidLifecycle(
  "props and runtime state → semantic registration → focus and input routing → callback or state update → rerender",
)}

## Example

\`\`\`tsx
import type { ComponentProps } from "react";
import { ${group.components[0]} } from "${exampleImport}";

export function Example(props: ComponentProps<typeof ${group.components[0]}>) {
  return <${group.components[0]} {...props} />;
}
\`\`\`

Registry-installed components are source-owned: customize the generated file in
your application, and use the package reference for the shared runtime contracts.
`;
  const output = resolve(
    workspace,
    "apps/docs/content/docs/reference/components",
    group.slug,
    "index.mdx",
  );
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, content, "utf8");
}

export async function generateReferenceDocs(): Promise<void> {
  const workspace = resolve(import.meta.dir, "../..");
  const packageDirectories = (
    await readdir(resolve(workspace, "packages"), {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const packages = [];
  for (const directory of packageDirectories) {
    packages.push(await packagePage(workspace, directory));
  }
  for (const group of componentGroups) {
    await componentPage(workspace, group);
  }

  await writeFile(
    resolve(workspace, "apps/docs/content/docs/reference/packages/meta.json"),
    `${JSON.stringify(
      {
        title: "Packages",
        icon: "Package",
        pages: ["index", ...packages.map((entry) => entry.slug)],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    resolve(workspace, "apps/docs/content/docs/reference/components/meta.json"),
    `${JSON.stringify(
      {
        title: "Components",
        icon: "Cube",
        pages: ["index", ...componentGroups.map((group) => group.slug)],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

await (import.meta.main ? generateReferenceDocs() : undefined);
