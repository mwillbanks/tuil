import type { Meta, StoryObj } from "@storybook/react";
import {
  createShowcaseStorybookAdapter,
  showcaseStory,
} from "./storybook-adapter.ts";

const browserStorySet = {
  id: "component-acceptance",
  title: "Components/Acceptance",
  stories: {
    Alert: { args: { name: "alert" } },
    AppBar: { args: { name: "app-bar" } },
    AppShell: { args: { name: "app-shell" } },
    Autocomplete: { args: { name: "autocomplete" } },
    Badge: { args: { name: "badge" } },
    BarChart: { args: { name: "bar-chart" } },
    Box: { args: { name: "box" } },
    Breadcrumbs: { args: { name: "breadcrumbs" } },
    Button: { args: { name: "button" } },
    Checkbox: { args: { name: "checkbox" } },
    CodeEditor: { args: { name: "code-editor" } },
    CodeViewer: { args: { name: "code-viewer" } },
    CommandLine: { args: { name: "command-line" } },
    CommandPalette: { args: { name: "command-palette" } },
    ConfirmDialog: { args: { name: "confirm-dialog" } },
    Container: { args: { name: "container" } },
    DataTable: { args: { name: "data-table" } },
    DateTimeInput: { args: { name: "date-time-input" } },
    DefaultTheme: { args: { name: "default" } },
    Dialog: { args: { name: "dialog" } },
    DiffViewer: { args: { name: "diff-viewer" } },
    Divider: { args: { name: "divider" } },
    Drawer: { args: { name: "drawer" } },
    EditableTableCell: { args: { name: "editable-table-cell" } },
    EditableTreeNode: { args: { name: "editable-tree-node" } },
    ErrorBoundary: { args: { name: "error-boundary" } },
    Field: { args: { name: "field" } },
    Footer: { args: { name: "footer" } },
    FormFieldEditor: { args: { name: "form-field-editor" } },
    Header: { args: { name: "header" } },
    Heading: { args: { name: "heading" } },
    HelpOverlay: { args: { name: "help-overlay" } },
    InitWizard: { args: { name: "init-wizard" } },
    InlineEditor: { args: { name: "inline-editor" } },
    JsonViewer: { args: { name: "json-viewer" } },
    LogViewer: { args: { name: "log-viewer" } },
    MarkdownViewer: { args: { name: "markdown-viewer" } },
    Menu: { args: { name: "menu" } },
    Menubar: { args: { name: "menubar" } },
    MultiSelect: { args: { name: "multi-select" } },
    NumberInput: { args: { name: "number-input" } },
    OperationList: { args: { name: "operation-list" } },
    OperationTree: { args: { name: "operation-tree" } },
    Outline: { args: { name: "outline" } },
    Pagination: { args: { name: "pagination" } },
    PaneTabs: { args: { name: "pane-tabs" } },
    PasswordInput: { args: { name: "password-input" } },
    Popover: { args: { name: "popover" } },
    Progress: { args: { name: "progress" } },
    RadioGroup: { args: { name: "radio-group" } },
    ResizablePane: { args: { name: "resizable-pane" } },
    RichDiffViewer: { args: { name: "rich-diff-viewer" } },
    ScrollArea: { args: { name: "scroll-area" } },
    SearchInput: { args: { name: "search-input" } },
    Select: { args: { name: "select" } },
    Sidebar: { args: { name: "sidebar" } },
    Skeleton: { args: { name: "skeleton" } },
    Slider: { args: { name: "slider" } },
    Spinner: { args: { name: "spinner" } },
    SplashScreen: { args: { name: "splash-screen" } },
    SplitPane: { args: { name: "split-pane" } },
    Stack: { args: { name: "stack" } },
    StatusBar: { args: { name: "status-bar" } },
    Stepper: { args: { name: "stepper" } },
    StructuredContent: { args: { name: "structured-content" } },
    Switch: { args: { name: "switch" } },
    TabSelect: { args: { name: "tab-select" } },
    Table: { args: { name: "table" } },
    Tabs: { args: { name: "tabs" } },
    TerminalPlatformPlugin: { args: { name: "terminal-platform-plugin" } },
    TextArea: { args: { name: "text-area" } },
    TextInput: { args: { name: "text-input" } },
    Text: { args: { name: "text" } },
    Timeline: { args: { name: "timeline" } },
    Toast: { args: { name: "toast" } },
    Tooltip: { args: { name: "tooltip" } },
    TransferList: { args: { name: "transfer-list" } },
    Tree: { args: { name: "tree" } },
    VirtualList: { args: { name: "virtual-list" } },
    Workflow: { args: { name: "workflow" } },
  },
} as const;

const adapter = createShowcaseStorybookAdapter(browserStorySet);

const meta = {
  title: "Components/Acceptance",
  argTypes: adapter.meta.argTypes,
} satisfies Meta<Record<string, unknown>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Alert: Story = showcaseStory(
  adapter,
  "Alert",
  "component acceptance",
);

export const AppBar: Story = showcaseStory(
  adapter,
  "AppBar",
  "component acceptance",
);

export const AppShell: Story = showcaseStory(
  adapter,
  "AppShell",
  "component acceptance",
);

export const Autocomplete: Story = showcaseStory(
  adapter,
  "Autocomplete",
  "component acceptance",
);

export const Badge: Story = showcaseStory(
  adapter,
  "Badge",
  "component acceptance",
);

export const BarChart: Story = showcaseStory(
  adapter,
  "BarChart",
  "component acceptance",
);

export const Box: Story = showcaseStory(adapter, "Box", "component acceptance");

export const Breadcrumbs: Story = showcaseStory(
  adapter,
  "Breadcrumbs",
  "component acceptance",
);

export const Button: Story = showcaseStory(
  adapter,
  "Button",
  "component acceptance",
);

export const Checkbox: Story = showcaseStory(
  adapter,
  "Checkbox",
  "component acceptance",
);

export const CodeEditor: Story = showcaseStory(
  adapter,
  "CodeEditor",
  "component acceptance",
);

export const CodeViewer: Story = showcaseStory(
  adapter,
  "CodeViewer",
  "component acceptance",
);

export const CommandLine: Story = showcaseStory(
  adapter,
  "CommandLine",
  "component acceptance",
);

export const CommandPalette: Story = showcaseStory(
  adapter,
  "CommandPalette",
  "component acceptance",
);

export const ConfirmDialog: Story = showcaseStory(
  adapter,
  "ConfirmDialog",
  "component acceptance",
);

export const Container: Story = showcaseStory(
  adapter,
  "Container",
  "component acceptance",
);

export const DataTable: Story = showcaseStory(
  adapter,
  "DataTable",
  "component acceptance",
);

export const DateTimeInput: Story = showcaseStory(
  adapter,
  "DateTimeInput",
  "component acceptance",
);

export const DefaultTheme: Story = showcaseStory(
  adapter,
  "DefaultTheme",
  "component acceptance",
);

export const Dialog: Story = showcaseStory(
  adapter,
  "Dialog",
  "component acceptance",
);

export const DiffViewer: Story = showcaseStory(
  adapter,
  "DiffViewer",
  "component acceptance",
);

export const Divider: Story = showcaseStory(
  adapter,
  "Divider",
  "component acceptance",
);

export const Drawer: Story = showcaseStory(
  adapter,
  "Drawer",
  "component acceptance",
);

export const EditableTableCell: Story = showcaseStory(
  adapter,
  "EditableTableCell",
  "component acceptance",
);

export const EditableTreeNode: Story = showcaseStory(
  adapter,
  "EditableTreeNode",
  "component acceptance",
);

export const ErrorBoundary: Story = showcaseStory(
  adapter,
  "ErrorBoundary",
  "component acceptance",
);

export const Field: Story = showcaseStory(
  adapter,
  "Field",
  "component acceptance",
);

export const Footer: Story = showcaseStory(
  adapter,
  "Footer",
  "component acceptance",
);

export const FormFieldEditor: Story = showcaseStory(
  adapter,
  "FormFieldEditor",
  "component acceptance",
);

export const Header: Story = showcaseStory(
  adapter,
  "Header",
  "component acceptance",
);

export const Heading: Story = showcaseStory(
  adapter,
  "Heading",
  "component acceptance",
);

export const HelpOverlay: Story = showcaseStory(
  adapter,
  "HelpOverlay",
  "component acceptance",
);

export const InitWizard: Story = showcaseStory(
  adapter,
  "InitWizard",
  "component acceptance",
);

export const InlineEditor: Story = showcaseStory(
  adapter,
  "InlineEditor",
  "component acceptance",
);

export const JsonViewer: Story = showcaseStory(
  adapter,
  "JsonViewer",
  "component acceptance",
);

export const LogViewer: Story = showcaseStory(
  adapter,
  "LogViewer",
  "component acceptance",
);

export const MarkdownViewer: Story = showcaseStory(
  adapter,
  "MarkdownViewer",
  "component acceptance",
);

export const Menu: Story = showcaseStory(
  adapter,
  "Menu",
  "component acceptance",
);

export const Menubar: Story = showcaseStory(
  adapter,
  "Menubar",
  "component acceptance",
);

export const MultiSelect: Story = showcaseStory(
  adapter,
  "MultiSelect",
  "component acceptance",
);

export const NumberInput: Story = showcaseStory(
  adapter,
  "NumberInput",
  "component acceptance",
);

export const OperationList: Story = showcaseStory(
  adapter,
  "OperationList",
  "component acceptance",
);

export const OperationTree: Story = showcaseStory(
  adapter,
  "OperationTree",
  "component acceptance",
);

export const Outline: Story = showcaseStory(
  adapter,
  "Outline",
  "component acceptance",
);

export const Pagination: Story = showcaseStory(
  adapter,
  "Pagination",
  "component acceptance",
);

export const PaneTabs: Story = showcaseStory(
  adapter,
  "PaneTabs",
  "component acceptance",
);

export const PasswordInput: Story = showcaseStory(
  adapter,
  "PasswordInput",
  "component acceptance",
);

export const Popover: Story = showcaseStory(
  adapter,
  "Popover",
  "component acceptance",
);

export const Progress: Story = showcaseStory(
  adapter,
  "Progress",
  "component acceptance",
);

export const RadioGroup: Story = showcaseStory(
  adapter,
  "RadioGroup",
  "component acceptance",
);

export const ResizablePane: Story = showcaseStory(
  adapter,
  "ResizablePane",
  "component acceptance",
);

export const RichDiffViewer: Story = showcaseStory(
  adapter,
  "RichDiffViewer",
  "component acceptance",
);

export const ScrollArea: Story = showcaseStory(
  adapter,
  "ScrollArea",
  "component acceptance",
);

export const SearchInput: Story = showcaseStory(
  adapter,
  "SearchInput",
  "component acceptance",
);

export const Select: Story = showcaseStory(
  adapter,
  "Select",
  "component acceptance",
);

export const Sidebar: Story = showcaseStory(
  adapter,
  "Sidebar",
  "component acceptance",
);

export const Skeleton: Story = showcaseStory(
  adapter,
  "Skeleton",
  "component acceptance",
);

export const Slider: Story = showcaseStory(
  adapter,
  "Slider",
  "component acceptance",
);

export const Spinner: Story = showcaseStory(
  adapter,
  "Spinner",
  "component acceptance",
);

export const SplashScreen: Story = showcaseStory(
  adapter,
  "SplashScreen",
  "component acceptance",
);

export const SplitPane: Story = showcaseStory(
  adapter,
  "SplitPane",
  "component acceptance",
);

export const Stack: Story = showcaseStory(
  adapter,
  "Stack",
  "component acceptance",
);

export const StatusBar: Story = showcaseStory(
  adapter,
  "StatusBar",
  "component acceptance",
);

export const Stepper: Story = showcaseStory(
  adapter,
  "Stepper",
  "component acceptance",
);

export const StructuredContent: Story = showcaseStory(
  adapter,
  "StructuredContent",
  "component acceptance",
);

export const Switch: Story = showcaseStory(
  adapter,
  "Switch",
  "component acceptance",
);

export const TabSelect: Story = showcaseStory(
  adapter,
  "TabSelect",
  "component acceptance",
);

export const Table: Story = showcaseStory(
  adapter,
  "Table",
  "component acceptance",
);

export const Tabs: Story = showcaseStory(
  adapter,
  "Tabs",
  "component acceptance",
);

export const TerminalPlatformPlugin: Story = showcaseStory(
  adapter,
  "TerminalPlatformPlugin",
  "component acceptance",
);

export const TextArea: Story = showcaseStory(
  adapter,
  "TextArea",
  "component acceptance",
);

export const TextInput: Story = showcaseStory(
  adapter,
  "TextInput",
  "component acceptance",
);

export const Text: Story = showcaseStory(
  adapter,
  "Text",
  "component acceptance",
);

export const Timeline: Story = showcaseStory(
  adapter,
  "Timeline",
  "component acceptance",
);

export const Toast: Story = showcaseStory(
  adapter,
  "Toast",
  "component acceptance",
);

export const Tooltip: Story = showcaseStory(
  adapter,
  "Tooltip",
  "component acceptance",
);

export const TransferList: Story = showcaseStory(
  adapter,
  "TransferList",
  "component acceptance",
);

export const Tree: Story = showcaseStory(
  adapter,
  "Tree",
  "component acceptance",
);

export const VirtualList: Story = showcaseStory(
  adapter,
  "VirtualList",
  "component acceptance",
);

export const Workflow: Story = showcaseStory(
  adapter,
  "Workflow",
  "component acceptance",
);
