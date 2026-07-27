import { defineStoryFactory } from "@fumadocs/story/next/client";
import { ReferenceStory } from "@/components/reference-story";

const { defineStory } = defineStoryFactory();

export const shellStory = defineStory({
  Component: ReferenceStory,
  displayName: "Application shell",
  args: [
    {
      variant: "AppShell",
      initial: {
        name: "AppShell",
        category: "application",
        frame:
          "┌ tuil deployment ──────────────────────┐\n│ Navigation        Workspace            │\n│                   Release ready         │\n└ main · online · 4 services ────────────┘",
        interaction: "layout slots",
        emits: "child events",
      },
    },
    {
      variant: "AppBar",
      initial: {
        name: "AppBar",
        category: "application",
        frame: "tuil deployment                  ? help",
        interaction: "composable children",
        emits: "none",
      },
    },
    {
      variant: "StatusBar",
      initial: {
        name: "StatusBar",
        category: "application",
        frame: "main · online · 4 services · 82×24",
        interaction: "composable children",
        emits: "none",
      },
    },
  ],
});

export const layoutStory = defineStory({
  Component: ReferenceStory,
  displayName: "Layout primitives",
  args: [
    {
      variant: "Box",
      initial: {
        name: "Box",
        category: "layout",
        frame:
          "┌──────────────────────────────┐\n│ padded terminal region       │\n└──────────────────────────────┘",
        interaction: "Ink box props",
        emits: "none",
      },
    },
    {
      variant: "Stack",
      initial: {
        name: "Stack",
        category: "layout",
        frame: "Build\nTests\nRelease",
        interaction: "direction + gap",
        emits: "none",
      },
    },
    {
      variant: "ResizablePane",
      initial: {
        name: "ResizablePane",
        category: "layout",
        frame: "Files          │ Preview\nsrc/app.tsx    │ Ready",
        interaction: "arrow keys resize",
        emits: "onSizeChange",
      },
    },
  ],
});

export const buttonStory = defineStory({
  Component: ReferenceStory,
  displayName: "Button",
  args: [
    {
      variant: "Default",
      initial: {
        name: "Button",
        category: "input",
        frame: "› Run build",
        interaction: "enter or space",
        emits: "onPress",
      },
    },
    {
      variant: "Disabled",
      initial: {
        name: "Button",
        category: "input",
        frame: "  Run build (disabled)",
        interaction: "not focusable",
        emits: "none",
      },
    },
  ],
});

export const typographyStory = defineStory({
  Component: ReferenceStory,
  displayName: "Typography and status",
  args: [
    {
      variant: "Heading",
      initial: {
        name: "Heading",
        category: "data display",
        frame: "BUILD PIPELINE\n──────────────",
        interaction: "read-only",
        emits: "none",
      },
    },
    {
      variant: "Badge",
      initial: {
        name: "Badge",
        category: "data display",
        frame: "[ RUNNING ]  [ READY ]  [ FAILED ]",
        interaction: "read-only",
        emits: "none",
      },
    },
    {
      variant: "Divider",
      initial: {
        name: "Divider",
        category: "data display",
        frame: "Overview ─────────────────────",
        interaction: "read-only",
        emits: "none",
      },
    },
  ],
});

export const feedbackStory = defineStory({
  Component: ReferenceStory,
  displayName: "Feedback",
  args: [
    {
      variant: "Alert",
      initial: {
        name: "Alert",
        category: "feedback",
        frame: "⚠ Deployment requires approval",
        interaction: "read-only",
        emits: "none",
      },
    },
    {
      variant: "Progress",
      initial: {
        name: "Progress",
        category: "feedback",
        frame: "Compiling  ████████░░  80%",
        interaction: "read-only",
        emits: "none",
      },
    },
    {
      variant: "Spinner",
      initial: {
        name: "Spinner",
        category: "feedback",
        frame: "⠹ Resolving dependencies",
        interaction: "reduced-motion aware",
        emits: "none",
      },
    },
  ],
});

export const overlaysStory = defineStory({
  Component: ReferenceStory,
  displayName: "Overlays",
  args: [
    {
      variant: "Dialog",
      initial: {
        name: "Dialog",
        category: "overlay",
        frame:
          "┌ Confirm deployment ──────────┐\n│ Deploy version 0.1.0?         │\n│        Cancel   [ Confirm ]    │\n└───────────────────────────────┘",
        interaction: "focus trap + escape",
        emits: "onOpenChange",
      },
    },
    {
      variant: "CommandPalette",
      initial: {
        name: "CommandPalette",
        category: "overlay",
        frame:
          "⌘  Search commands…\n› Deploy application\n  Open playground\n  Toggle theme",
        interaction: "type + arrows + enter",
        emits: "onSelect",
      },
    },
    {
      variant: "Toast",
      initial: {
        name: "Toast",
        category: "overlay",
        frame: "✓ Build completed in 2.4s",
        interaction: "timeout or dismiss",
        emits: "toast lifecycle",
      },
    },
  ],
});

export const formsStory = defineStory({
  Component: ReferenceStory,
  displayName: "Forms and controls",
  args: [
    {
      variant: "TextInput",
      initial: {
        name: "TextInput",
        category: "form",
        frame: "Project name\n› tuil-app_",
        interaction: "edit + submit",
        emits: "onValueChange, onSubmit",
      },
    },
    {
      variant: "Select",
      initial: {
        name: "Select",
        category: "form",
        frame: "Language\n● TypeScript\n○ JavaScript",
        interaction: "arrows + enter",
        emits: "onValueChange",
      },
    },
    {
      variant: "MultiSelect",
      initial: {
        name: "MultiSelect",
        category: "form",
        frame: "Features\n[x] Router\n[x] Forms\n[ ] Images",
        interaction: "arrows + space",
        emits: "onValueChange",
      },
    },
    {
      variant: "ValidationSummary",
      initial: {
        name: "ValidationSummary",
        category: "form",
        frame: "2 issues\n• Project name is required\n• Select a template",
        interaction: "read + focus invalid field",
        emits: "form state",
      },
    },
  ],
});

export const transferStory = defineStory({
  Component: ReferenceStory,
  displayName: "Transfer list",
  args: [
    {
      variant: "Default",
      initial: {
        name: "TransferList",
        category: "form",
        frame:
          "Available       │ Selected\n› API           │ ✓ Router\n  Workflow      │ ✓ Forms",
        interaction: "arrows + space + tab",
        emits: "onValueChange",
      },
    },
  ],
});

export const navigationStory = defineStory({
  Component: ReferenceStory,
  displayName: "Navigation",
  args: [
    {
      variant: "Tabs",
      initial: {
        name: "Tabs",
        category: "navigation",
        frame: "[ Overview ]  Settings  Logs\n\nRelease is ready.",
        interaction: "left/right + enter",
        emits: "onValueChange",
      },
    },
    {
      variant: "Menu",
      initial: {
        name: "Menu",
        category: "navigation",
        frame: "› New project\n  Open…\n  Exit",
        interaction: "arrows + enter",
        emits: "onSelect",
      },
    },
    {
      variant: "Breadcrumbs",
      initial: {
        name: "Breadcrumbs",
        category: "navigation",
        frame: "Projects › tuil › Releases › 0.1.0",
        interaction: "left/right + enter",
        emits: "onSelect",
      },
    },
    {
      variant: "Stepper",
      initial: {
        name: "Stepper",
        category: "navigation",
        frame: "✓ Configure  ● Review  ○ Publish",
        interaction: "workflow driven",
        emits: "onStepChange",
      },
    },
  ],
});

export const tableStory = defineStory({
  Component: ReferenceStory,
  displayName: "Tables",
  args: [
    {
      variant: "Table",
      initial: {
        name: "Table",
        category: "data display",
        frame:
          "Task       Status\nAPI        ready\nDocs       running\nRelease    queued",
        interaction: "cell navigation + activate",
        emits: "onActivate, onSelectionChange",
      },
    },
    {
      variant: "DataTable",
      initial: {
        name: "DataTable",
        category: "data display",
        frame:
          "Task       Status ↑\nAPI        ready\nDocs       running\nRelease    queued",
        interaction: "sort + select + activate",
        emits: "onActivate, table state",
      },
    },
  ],
});

export const treeStory = defineStory({
  Component: ReferenceStory,
  displayName: "Tree",
  args: [
    {
      variant: "Default",
      initial: {
        name: "Tree",
        category: "data display",
        frame: "▾ src\n  ├ app.tsx\n  └ theme.ts\n▸ tests",
        interaction: "arrows + expand",
        emits: "onActivate, onExpandedChange",
      },
    },
  ],
});

export const logsStory = defineStory({
  Component: ReferenceStory,
  displayName: "Logs and structured data",
  args: [
    {
      variant: "LogViewer",
      initial: {
        name: "LogViewer",
        category: "data display",
        frame:
          "12:01:04 INFO  compile complete\n12:01:05 INFO  tests passed\n12:01:06 WARN  release pending",
        interaction: "scroll + filter + follow",
        emits: "onFollowChange",
      },
    },
    {
      variant: "JsonViewer",
      initial: {
        name: "JsonViewer",
        category: "data display",
        frame: '▾ app\n  id: "tuil"\n  ready: true\n  plugins: 4',
        interaction: "expand + collapse",
        emits: "onExpandedChange",
      },
    },
    {
      variant: "DiffViewer",
      initial: {
        name: "DiffViewer",
        category: "data display",
        frame: "- status: queued\n+ status: ready",
        interaction: "scroll",
        emits: "none",
      },
    },
  ],
});

export const virtualStory = defineStory({
  Component: ReferenceStory,
  displayName: "Virtual list",
  args: [
    {
      variant: "Default",
      initial: {
        name: "VirtualList",
        category: "data display",
        frame:
          "1024 items · rows 248–259\n› service-0248\n  service-0249\n  service-0250",
        interaction: "scroll + active item",
        emits: "onRangeChange",
      },
    },
  ],
});

export const workflowStory = defineStory({
  Component: ReferenceStory,
  displayName: "Workflow UI",
  args: [
    {
      variant: "Workflow",
      initial: {
        name: "Workflow",
        category: "workflow",
        frame:
          "Create project\n✓ Template\n● Features\n○ Confirm\n\n[ Back ]              [ Next ]",
        interaction: "next, back, skip, cancel",
        emits: "workflow:*",
      },
    },
    {
      variant: "OperationTree",
      initial: {
        name: "OperationTree",
        category: "workflow",
        frame: "▾ Build\n  ✓ Compile\n  ● Test  82%\n  ○ Package",
        interaction: "expand + inspect",
        emits: "operation snapshots",
      },
    },
    {
      variant: "HelpOverlay",
      initial: {
        name: "HelpOverlay",
        category: "workflow",
        frame:
          "Keyboard shortcuts\nn / p  next / previous\n?      help\nq      quit",
        interaction: "escape to close",
        emits: "onOpenChange",
      },
    },
  ],
});

export const initializerStory = defineStory({
  Component: ReferenceStory,
  displayName: "Project initializer",
  args: [
    {
      variant: "Default",
      initial: {
        name: "InitWizard",
        category: "application block",
        frame:
          "Create a tuil app\n\nProject name  tuil-app\nTemplate      dashboard\nFeatures      router, forms\n\n                    [ Create ]",
        interaction: "guided workflow",
        emits: "onComplete, onCancel",
      },
    },
  ],
});

export const imageStory = defineStory({
  Component: ReferenceStory,
  displayName: "Terminal image",
  args: [
    {
      variant: "Fallback",
      initial: {
        name: "Image",
        category: "media",
        frame: "[ tuil logo · 24×8 · image fallback ]",
        interaction: "capability selected",
        emits: "none",
      },
    },
  ],
});
