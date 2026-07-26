import { createApp, defineCommand, useApp } from "@mwillbanks/tuil";
import {
  Badge,
  Box,
  Button,
  Heading,
  Progress,
  render,
  Text,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import { createElement, type ReactNode, useEffect, useState } from "react";
import { InitWizard } from "../registry/blocks/init-wizard.tsx";
import {
  Table,
  type TableColumn,
  type TableProps,
} from "../registry/data-display/complex-data.tsx";
import { LogViewer } from "../registry/data-display/log-viewer.tsx";
import { Tree } from "../registry/data-display/tree.tsx";
import { CommandPalette } from "../registry/feedback/overlays.tsx";
import { Field, Form, TextInput } from "../registry/forms/controls.tsx";

export type ExampleKind =
  | "minimal"
  | "forms"
  | "dashboard"
  | "project-wizard"
  | "command-center"
  | "file-browser"
  | "ai-assistant";

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

export function ExampleApplication(props: {
  readonly kind: ExampleKind;
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
  }
}

export async function runExample(kind: ExampleKind): Promise<void> {
  const app = createApp({
    id: `tuil-example-${kind}`,
    component: () => createElement(ExampleApplication, { kind }),
  });
  const instance = await render(app);
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
