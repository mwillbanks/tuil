import { createApp, defineCommand, useApp } from "@mwillbanks/tuil";
import { useHotkeys } from "@mwillbanks/tuil-hotkeys";
import {
  Badge,
  Box,
  Button,
  Heading,
  Progress,
  render,
  TerminalImage,
  type TerminalImageSource,
  Text,
  useTerminalInput,
  useTerminalSize,
  useTerminalViewport,
} from "@mwillbanks/tuil-ink";
import {
  createElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { InitWizard } from "../registry/blocks/init-wizard.tsx";
import { AppBar } from "../registry/components/app-bar.tsx";
import { AppShell } from "../registry/components/app-shell.tsx";
import { StatusBar } from "../registry/components/status-bar.tsx";
import {
  Table,
  type TableColumn,
  type TableProps,
} from "../registry/data-display/complex-data.tsx";
import { LogViewer } from "../registry/data-display/log-viewer.tsx";
import { Tree } from "../registry/data-display/tree.tsx";
import { CommandPalette } from "../registry/feedback/overlays.tsx";
import { Spinner } from "../registry/feedback/spinner.tsx";
import { Field, Form, TextInput } from "../registry/forms/controls.tsx";
import {
  Menu,
  type NavigationItem,
} from "../registry/navigation/navigation.tsx";

export type ExampleKind =
  | "minimal"
  | "forms"
  | "dashboard"
  | "project-wizard"
  | "command-center"
  | "file-browser"
  | "ai-assistant"
  | "full-screen";

function Minimal(): ReactNode {
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "Hello from tuil"),
    createElement(Text, null, "A complete terminal application."),
  );
}

function Forms(): ReactNode {
  const [submitted, setSubmitted] = useState("not submitted");
  return createElement(
    Form,
    {
      id: "profile",
      onSubmit: (values) => setSubmitted(String(values["name"] ?? "")),
    },
    createElement(
      Field,
      {
        label: "Project name",
        hint: "Press enter to validate",
      },
      createElement(TextInput, {
        id: "name",
        label: "Project name",
        defaultValue: "terminal-app",
        autoFocus: true,
      }),
    ),
    createElement(Text, { role: "status" }, `Submitted: ${submitted}`),
  );
}

const jobs = Object.freeze([
  { id: "build", name: "Build", status: "passing" },
  { id: "test", name: "Tests", status: "passing" },
  { id: "deploy", name: "Deploy", status: "waiting" },
]);
type Job = (typeof jobs)[number];
const jobColumns: readonly TableColumn<Job>[] = Object.freeze([
  { id: "job", header: "Job", accessor: (row) => row.name, width: 20 },
  {
    id: "status",
    header: "Status",
    accessor: (row) => row.status,
    width: 12,
  },
]);
const JobTable = Table as (props: TableProps<Job>) => ReactNode;

function Dashboard(): ReactNode {
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "Delivery dashboard"),
    createElement(Progress, {
      label: "Release progress",
      value: 0.67,
      max: 1,
    }),
    createElement(JobTable, {
      label: "Pipeline jobs",
      rows: jobs,
      columns: jobColumns,
      getRowKey: (row) => row.id,
      height: 5,
      width: 40,
    }),
  );
}

function ProjectWizard(): ReactNode {
  const [result, setResult] = useState("in progress");
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(InitWizard, {
      initialName: "project-wizard",
      onComplete: (answers) => setResult(`created ${answers.name}`),
      onCancel: () => setResult("cancelled"),
    }),
    createElement(Text, { role: "status" }, result),
  );
}

function CommandCenter(): ReactNode {
  const app = useApp();
  const [message, setMessage] = useState("Open the palette with ctrl+k");
  useEffect(() => {
    const registrations = [
      app.commands.register(
        defineCommand({
          id: "project.build",
          title: "Build project",
          category: "Project",
          execute: () => setMessage("Build started"),
        }),
      ),
      app.commands.register(
        defineCommand({
          id: "project.test",
          title: "Run tests",
          category: "Project",
          execute: () => setMessage("Tests started"),
        }),
      ),
    ];
    return () => {
      for (const registration of registrations) {
        void registration.dispose();
      }
    };
  }, [app.commands]);
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "Command center"),
    createElement(Text, { role: "status" }, message),
    createElement(CommandPalette, { defaultOpen: true }),
  );
}

const fileTree = Object.freeze([
  {
    id: "src",
    label: "src",
    children: [
      { id: "src/index", label: "index.tsx" },
      { id: "src/app", label: "app.tsx" },
    ],
  },
  { id: "package", label: "package.json" },
]);

function FileBrowser(): ReactNode {
  const [selected, setSelected] = useState("none");
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "File browser"),
    createElement(Tree, {
      label: "Project files",
      items: fileTree,
      defaultExpandedIds: ["src"],
      autoFocus: true,
      onSelect: (item) => setSelected(item.id),
    }),
    createElement(Text, { role: "status" }, `Selected: ${selected}`),
  );
}

function AiAssistant(): ReactNode {
  const [lines, setLines] = useState<readonly string[]>([
    "user: Summarize the build",
    "assistant: Build is passing.",
  ]);
  useTerminalInput((input) => {
    if (input !== "r") return false;
    setLines((current) => [
      ...current,
      "tool: read test results",
      "assistant: All checks passed.",
    ]);
    return true;
  });
  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Heading, { level: 1 }, "AI assistant"),
    createElement(Badge, { label: "connected" }, "connected"),
    createElement(LogViewer, {
      label: "Conversation",
      lines,
      height: 8,
      width: 60,
      follow: true,
    }),
    createElement(Button, { label: "Run tool" }, "Press r to run a tool"),
  );
}

const fallbackLogo: TerminalImageSource = Object.freeze({
  width: 4,
  height: 4,
  data: new Uint8Array([
    22, 224, 230, 255, 42, 167, 244, 255, 119, 87, 234, 255, 235, 62, 186, 255,
    22, 224, 230, 255, 0, 0, 0, 0, 0, 0, 0, 0, 235, 62, 186, 255, 42, 167, 244,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 119, 87, 234, 255, 22, 224,
    230, 255, 42, 167, 244, 255, 119, 87, 234, 255, 235, 62, 186, 255,
  ]),
});

const loadingMessages = Object.freeze([
  "Discovering workspace capabilities",
  "Warming responsive layout",
  "Connecting command services",
  "Preparing your terminal",
]);

const menuItems = Object.freeze({
  file: Object.freeze([
    { id: "new-session", label: "New session", command: "session.new" },
    { id: "open-workspace", label: "Open workspace" },
    { id: "quit", label: "Exit preview" },
  ]),
  edit: Object.freeze([
    { id: "undo", label: "Undo" },
    { id: "copy", label: "Copy selection" },
    { id: "clear", label: "Clear activity", command: "activity.clear" },
  ]),
  help: Object.freeze([
    { id: "shortcuts", label: "Keyboard shortcuts" },
    { id: "about", label: "About tuil", command: "help.about" },
  ]),
}) satisfies Readonly<Record<string, readonly NavigationItem[]>>;

type MenuId = keyof typeof menuItems;

function Splash(props: {
  readonly logo: TerminalImageSource;
  readonly message: string;
  readonly width: number;
  readonly height: number;
}): ReactNode {
  const preferredWidth = props.width < 60 ? 18 : props.width < 120 ? 28 : 36;
  const heightConstrainedWidth = Math.max(
    8,
    Math.floor((props.height - 3) * 2.5),
  );
  const logoWidth = Math.min(preferredWidth, heightConstrainedWidth);
  return (
    <Box
      width={props.width}
      height={props.height}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      role="status"
      label="Loading tuil workspace"
    >
      <TerminalImage
        source={props.logo}
        alt="tuil terminal interface logo"
        columns={logoWidth}
      />
      <Spinner label={props.message} />
      <Text dimColor>Full-screen terminal workspace</Text>
    </Box>
  );
}

function WorkspaceContent(props: {
  readonly height: number;
  readonly logHeight: number;
  readonly viewport: ReturnType<typeof useTerminalViewport>;
  readonly logs: readonly string[];
  readonly width: number;
  readonly unicode: boolean;
}): ReactNode {
  const icons = props.unicode
    ? { branch: "●", success: "✓", language: "◆", services: "⌁" }
    : { branch: "*", success: "+", language: "#", services: "~" };
  if (props.viewport === "compact") {
    return (
      <LogViewer
        label="Workspace activity"
        lines={props.logs}
        height={props.logHeight}
        width={Math.max(20, props.width - 4)}
        follow
      />
    );
  }
  if (props.viewport === "regular") {
    return (
      <Box flexDirection="column">
        <Heading level={2}>Workspace activity</Heading>
        <LogViewer
          label="Workspace activity"
          lines={props.logs}
          height={props.logHeight}
          width={Math.max(24, props.width - 4)}
          follow
        />
        {props.height >= 22 ? (
          <Text>
            {icons.branch} main · {icons.success} tests · {icons.services} 3
            services
          </Text>
        ) : null}
      </Box>
    );
  }
  return (
    <Box flexDirection="row" gap={2} flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Heading level={2}>Workspace activity</Heading>
        <LogViewer
          label="Workspace activity"
          lines={props.logs}
          height={props.logHeight}
          width={72}
          follow
        />
      </Box>
      <Box flexDirection="column" minWidth={24}>
        <Heading level={2}>Context</Heading>
        <Text>{icons.branch} main</Text>
        <Text>{icons.success} 128 tests passing</Text>
        <Text>{icons.language} TypeScript</Text>
        <Text>{icons.services} 3 services ready</Text>
      </Box>
    </Box>
  );
}

function useSplashState(
  mode: ReturnType<typeof useApp>["mode"],
  splashDurationMs: number,
  loadingMessageIntervalMs: number,
): { readonly visible: boolean; readonly message: string } {
  const [showSplash, setShowSplash] = useState(mode === "interactive");
  const [loadingMessage, setLoadingMessage] = useState(0);
  useEffect(() => {
    if (mode !== "interactive") {
      setShowSplash(false);
      return;
    }
    if (!showSplash) return;
    const splashTimer = setTimeout(
      () => setShowSplash(false),
      splashDurationMs,
    );
    const messageTimer = setInterval(
      () =>
        setLoadingMessage((current) => (current + 1) % loadingMessages.length),
      loadingMessageIntervalMs,
    );
    return () => {
      clearTimeout(splashTimer);
      clearInterval(messageTimer);
    };
  }, [loadingMessageIntervalMs, mode, showSplash, splashDurationMs]);
  return {
    visible: showSplash,
    message: loadingMessages[loadingMessage] ?? "Loading",
  };
}

function useWorkspaceActivity(app: ReturnType<typeof useApp>) {
  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<readonly string[]>([
    "12:04:01  INFO  Runtime mounted in alternate screen",
    "12:04:02  READY Image renderer negotiated 24-bit color",
    "12:04:02  INFO  Press Alt+F, Alt+E, or Alt+H to open a menu",
  ]);
  useEffect(() => {
    const registrations = [
      app.commands.register(
        defineCommand({
          id: "session.new",
          title: "New session",
          execute: () =>
            setLogs((current) => [...current, "12:04:08  INFO  New session"]),
        }),
      ),
      app.commands.register(
        defineCommand({
          id: "activity.clear",
          title: "Clear activity",
          execute: () => setLogs(["12:04:08  INFO  Activity cleared"]),
        }),
      ),
      app.commands.register(
        defineCommand({
          id: "help.about",
          title: "About tuil",
          execute: () =>
            setLogs((current) => [
              ...current,
              "12:04:08  INFO  tuil full-screen example",
            ]),
        }),
      ),
    ];
    return () => {
      for (const registration of registrations) {
        void registration.dispose();
      }
    };
  }, [app.commands]);
  return {
    logs,
    prompt,
    setPrompt,
    recordMenuSelection(item: NavigationItem) {
      setLogs((current) => [
        ...current,
        `12:04:08  MENU  Selected ${item.label}`,
      ]);
    },
    submitPrompt(value: string) {
      const submitted = value.trim();
      if (!submitted) return;
      setLogs((current) => [
        ...current,
        `12:04:09  USER  ${submitted}`,
        "12:04:09  INFO  Sample response queued",
      ]);
      setPrompt("");
    },
  };
}

function useWorkspaceMenu(app: ReturnType<typeof useApp>) {
  const [active, setActive] = useState<MenuId>();
  const close = useCallback(() => {
    setActive(undefined);
    app.focus.focus("workspace-prompt");
  }, [app.focus]);
  const hotkeys = useMemo(
    () => ({
      "alt+f": () => setActive("file"),
      "alt+e": () => setActive("edit"),
      "alt+h": () => setActive("help"),
      "meta+f": () => setActive("file"),
      "meta+e": () => setActive("edit"),
      "meta+h": () => setActive("help"),
      escape: close,
    }),
    [close],
  );
  const hotkeyOptions = useMemo(() => ({ scope: "application" as const }), []);
  useHotkeys(hotkeys, hotkeyOptions);
  useEffect(() => {
    if (active) app.focus.focus(`workspace-menu-${active}`);
  }, [active, app.focus]);
  return { active, close };
}

function WorkspaceAppBar(props: {
  readonly activeMenu?: MenuId;
  readonly logo: TerminalImageSource;
  readonly compact: boolean;
}): ReactNode {
  return (
    <AppShell.AppBar>
      <AppBar
        width="100%"
        alignItems="center"
        borderStyle="single"
        paddingX={1}
        gap={2}
      >
        <TerminalImage source={props.logo} alt="tuil logo" columns={4} />
        <Text bold color="cyan">
          tuil
        </Text>
        <Text underline={props.activeMenu === "file"}>File</Text>
        <Text underline={props.activeMenu === "edit"}>Edit</Text>
        <Text underline={props.activeMenu === "help"}>Help</Text>
        <Box flexGrow={1} />
        {props.compact ? null : <Text dimColor>Alt/Option+F · E · H</Text>}
      </AppBar>
    </AppShell.AppBar>
  );
}

function WorkspaceMenu(props: {
  readonly active?: MenuId;
  readonly close: () => void;
  readonly onSelect: (item: NavigationItem) => void;
}): ReactNode {
  if (!props.active) return null;
  return (
    <Menu
      id={`workspace-menu-${props.active}`}
      label={`${props.active[0]?.toUpperCase()}${props.active.slice(1)}`}
      items={menuItems[props.active]}
      open
      onOpenChange={(open) => {
        if (!open) props.close();
      }}
      onSelect={(item) => {
        props.onSelect(item);
        props.close();
      }}
    />
  );
}

function WorkspacePrompt(props: {
  readonly prompt: string;
  readonly onPromptChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
}): ReactNode {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold>Prompt</Text>
      <TextInput
        id="workspace-prompt"
        label="Workspace prompt"
        placeholder="Ask tuil to do something…"
        value={props.prompt}
        autoFocus
        registerWithForm={false}
        onValueChange={props.onPromptChange}
        onSubmit={props.onSubmit}
      />
      <Text dimColor>Enter submit · Esc close menu</Text>
    </Box>
  );
}

function WorkspaceStatusBar(props: {
  readonly compact: boolean;
  readonly unicode: boolean;
}): ReactNode {
  const icons = props.unicode
    ? { branch: "●", ready: "✓", speed: "⚡" }
    : { branch: "*", ready: "+", speed: ">" };
  return (
    <AppShell.StatusBar>
      <StatusBar
        width="100%"
        paddingX={1}
        justifyContent="space-between"
        backgroundColor="blue"
      >
        <Text>
          {icons.branch} main · {icons.ready} ready
        </Text>
        {props.compact ? null : (
          <Text>Image + hotkeys + responsive layout active</Text>
        )}
        <Text>{icons.speed} 24 ms</Text>
      </StatusBar>
    </AppShell.StatusBar>
  );
}

function Workspace(props: {
  readonly logo: TerminalImageSource;
  readonly width: number;
  readonly height: number;
}): ReactNode {
  const app = useApp();
  const viewport = useTerminalViewport();
  const activity = useWorkspaceActivity(app);
  const menu = useWorkspaceMenu(app);
  const logHeight = Math.max(
    3,
    props.height -
      (viewport === "compact" ? 13 : viewport === "regular" ? 20 : 14),
  );
  return (
    <AppShell width={props.width} height={props.height}>
      <WorkspaceAppBar
        activeMenu={menu.active}
        logo={props.logo}
        compact={viewport === "compact"}
      />
      <WorkspaceMenu
        active={menu.active}
        close={menu.close}
        onSelect={activity.recordMenuSelection}
      />
      <AppShell.Main paddingX={1} paddingY={1}>
        <WorkspaceContent
          height={props.height}
          logHeight={logHeight}
          viewport={viewport}
          logs={activity.logs}
          width={props.width}
          unicode={app.capabilities.unicode}
        />
      </AppShell.Main>
      <WorkspacePrompt
        prompt={activity.prompt}
        onPromptChange={activity.setPrompt}
        onSubmit={activity.submitPrompt}
      />
      <WorkspaceStatusBar
        compact={viewport === "compact"}
        unicode={app.capabilities.unicode}
      />
    </AppShell>
  );
}

function FullScreen(props: {
  readonly logo?: TerminalImageSource;
  readonly splashDurationMs?: number;
  readonly loadingMessageIntervalMs?: number;
}): ReactNode {
  const app = useApp();
  const { width, height } = useTerminalSize();
  const splash = useSplashState(
    app.mode,
    props.splashDurationMs ?? 1_800,
    props.loadingMessageIntervalMs ?? 450,
  );
  const logo = props.logo ?? fallbackLogo;
  return splash.visible ? (
    <Splash
      logo={logo}
      message={splash.message}
      width={width}
      height={height}
    />
  ) : (
    <Workspace logo={logo} width={width} height={height} />
  );
}

export function ExampleApplication(props: {
  readonly kind: ExampleKind;
  readonly logo?: TerminalImageSource;
  readonly splashDurationMs?: number;
  readonly loadingMessageIntervalMs?: number;
}): ReactNode {
  switch (props.kind) {
    case "minimal":
      return createElement(Minimal);
    case "forms":
      return createElement(Forms);
    case "dashboard":
      return createElement(Dashboard);
    case "project-wizard":
      return createElement(ProjectWizard);
    case "command-center":
      return createElement(CommandCenter);
    case "file-browser":
      return createElement(FileBrowser);
    case "ai-assistant":
      return createElement(AiAssistant);
    case "full-screen":
      return createElement(FullScreen, props);
  }
}

export async function runExample(
  kind: ExampleKind,
  options: Omit<Parameters<typeof ExampleApplication>[0], "kind"> = {},
): Promise<void> {
  const app = createApp({
    id: `tuil-example-${kind}`,
    component: () => createElement(ExampleApplication, { kind, ...options }),
  });
  const instance = await render(app, {
    alternateScreen: kind === "full-screen" && app.capabilities.alternateScreen,
  });
  const stop = () => {
    void instance.unmount();
  };
  process.once("SIGINT", stop);
  try {
    await instance.waitUntilExit();
  } finally {
    process.off("SIGINT", stop);
  }
}
