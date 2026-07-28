import { expect, test } from "bun:test";
import type {
  EditorProviderOptions,
  EditorSession,
} from "@mwillbanks/tuil-editor";
import {
  TextBufferSession,
  textBufferProvider,
} from "@mwillbanks/tuil-editor/buffer";
import { renderTuil } from "@mwillbanks/tuil-testing-ink";
import { Text } from "ink";
import { useState } from "react";
import { Button } from "./components/button.tsx";
import {
  BarChart,
  CodeViewer,
  MarkdownViewer,
  RichDiffViewer,
  StructuredContentSummary,
  Timeline,
} from "./data-display/rich-content.tsx";
import {
  Drawer,
  ErrorBoundary,
  Popover,
  Skeleton,
} from "./feedback/overlays.tsx";
import {
  CodeEditor,
  CommandLine,
  DateTimeInput,
  Field,
  PasswordInput,
  SearchInput,
} from "./forms/controls.tsx";
import {
  Footer,
  Header,
  PaneTabs,
  ScrollArea,
  Sidebar,
} from "./layout/panes.tsx";
import { Outline, Pagination, TabSelect } from "./navigation/navigation.tsx";

test("editor-backed input family has semantics, keyboard behavior, masking, and static output", async () => {
  const values: string[] = [];
  const view = renderTuil(
    <>
      <PasswordInput id="password" label="Password" defaultValue="secret" />
      <SearchInput
        id="search"
        onValueChange={(value) => {
          values.push(value);
        }}
      />
      <CommandLine id="command" />
      <CodeEditor id="code" defaultValue="const x = 1" />
      <DateTimeInput id="date" />
    </>,
  );
  await view.ready;
  expect(view.screen.frame()).not.toContain("secret");
  expect(view.screen.getAllByRole("textbox")).toHaveLength(5);
  expect(view.app.focus.focus("search")).toBeTrue();
  await view.user.type("log");
  expect(values.at(-1)).toBe("log");
  await view.cleanup();
});

test("password input redacts provider serialization and clipboard writes", async () => {
  let session: EditorSession | undefined;
  let clipboard = "";
  const values: string[] = [];
  const provider = {
    ...textBufferProvider,
    id: "password-redaction-test",
    create(options: EditorProviderOptions) {
      session = new TextBufferSession(options);
      return session;
    },
  };
  const view = renderTuil(
    <PasswordInput
      id="secure-password"
      defaultValue="secret🙂"
      editorProvider={provider}
      clipboard={{
        read: () => "replacement",
        write: (value) => {
          clipboard = value;
        },
      }}
      autoFocus
      onValueChange={(value) => {
        values.push(value);
      }}
    />,
  );
  await view.ready;

  expect(session).toBeDefined();
  await view.user.type("!");
  expect(values.at(-1)).toBe("secret🙂!");
  expect(session?.serialize()).toBe("••••••••");
  session?.execute("select-all");
  expect(await session?.copy()).toBe("••••••••");
  expect(clipboard).toBe("••••••••");
  expect(view.screen.frame()).not.toContain("secret");
  expect(view.screen.getByRole("textbox").valueText).toBe("[REDACTED]");
  await view.cleanup();
});

test("password input rejects sessions that cannot expose a secret-safe change sink", () => {
  const session = new TextBufferSession({
    id: "unsupported-password-session",
    value: "secret",
    masked: true,
  });
  expect(() =>
    PasswordInput({
      id: "provided-password-session",
      session,
      onValueChange: () => {},
    }),
  ).toThrow("does not accept a provided editor session");
  session.dispose();
});

test("specialized inputs parse dates and route history navigation", async () => {
  const parsed: Array<Date | undefined> = [];
  const history: string[] = [];
  const date = renderTuil(
    <DateTimeInput
      id="parsed-date"
      autoFocus
      onValueChange={(_value, value) => {
        parsed.push(value);
      }}
    />,
  );
  await date.user.type("invalid");
  expect(parsed.at(-1)).toBeUndefined();
  await date.cleanup();

  const validDate = renderTuil(
    <DateTimeInput
      id="valid-date"
      autoFocus
      onValueChange={(_value, value) => {
        parsed.push(value);
      }}
    />,
  );
  await validDate.user.type("2026-07-27");
  expect(parsed.at(-1)?.toISOString()).toStartWith("2026-07-27");
  await validDate.cleanup();

  const command = renderTuil(
    <CommandLine
      id="history-command"
      autoFocus
      onArrowUp={() => {
        history.push("up");
      }}
      onArrowDown={() => {
        history.push("down");
      }}
    />,
  );
  await command.user.press("arrowUp");
  await command.user.press("arrowDown");
  expect(history).toEqual(["up", "down"]);
  await command.cleanup();
});

test("editor callback failures report through the application runtime", async () => {
  const reported: string[] = [];
  const view = renderTuil(
    <>
      <SearchInput
        id="failing-editor"
        autoFocus
        onBlur={async () => {
          throw new Error("blur failed");
        }}
      />
      <Button id="after-failing-editor">After</Button>
    </>,
    {
      errorHandler: (error, context) => {
        reported.push(`${context.phase}:${String(error)}`);
      },
    },
  );
  await view.user.press("tab");
  await Bun.sleep(50);
  expect(reported).toEqual(["field-blur:Error: blur failed"]);
  await view.cleanup();
});

test("a failed runtime error reporter is converted into a render failure", async () => {
  const view = renderTuil(
    <ErrorBoundary
      fallback={(error) => <Text>Editor failed: {error.message}</Text>}
    >
      <SearchInput
        id="double-failing-editor"
        autoFocus
        onBlur={async () => {
          throw new Error("blur failed");
        }}
      />
      <Button id="after-double-failing-editor">After</Button>
    </ErrorBoundary>,
    {
      errorHandler: async () => {
        throw new Error("report failed");
      },
    },
  );
  await view.user.press("tab");
  await Bun.sleep(100);
  expect(
    view.frames.some((frame) => frame.includes("Editor failed:")),
  ).toBeTrue();
  await view.cleanup();
});

test("navigation expansion supports tab select, pagination keyboard, and outlines", async () => {
  let page = 2;
  function NavigationHarness() {
    const [selected, setSelected] = useState("one");
    return (
      <>
        <TabSelect
          id="tabs"
          items={[
            { id: "one", label: "One", content: <Text>First</Text> },
            { id: "two", label: "Two", content: <Text>Second</Text> },
          ]}
          value={selected}
          onValueChange={setSelected}
        />
        <Pagination
          id="pages"
          page={page}
          pageCount={5}
          onPageChange={(value) => {
            page = value;
          }}
        />
        <Outline
          items={[
            { id: "a", label: "Heading", selected: true },
            { id: "b", label: "Child", depth: 1 },
          ]}
        />
      </>
    );
  }
  const view = renderTuil(<NavigationHarness />);
  await view.ready;
  expect(view.app.focus.focus("pages")).toBeTrue();
  await view.user.press("arrowRight");
  expect(page).toBe(3);
  await view.user.press("arrowLeft");
  expect(page).toBe(1);
  await view.user.press("pageDown");
  expect(page).toBe(3);
  await view.user.press("end");
  expect(page).toBe(5);
  await view.user.press("home");
  expect(page).toBe(1);
  expect(view.screen.frame()).toContain("Heading");
  await view.cleanup();
});

test("rich content, charts, timeline, layout, overlays, skeletons, and errors render stable static surfaces", async () => {
  const view = renderTuil(
    <>
      <Header>
        <Text>Header</Text>
      </Header>
      <Sidebar>
        <Text>Sidebar</Text>
      </Sidebar>
      <PaneTabs labels={["Logs", "Trace"]} active={0}>
        <ScrollArea height={2} lines={["one", "two", "three"]} />
      </PaneTabs>
      <MarkdownViewer source="# title" />
      <CodeViewer source="const value = 1" />
      <Field label="Optional" hint="Helpful hint" />
      <RichDiffViewer source={"@@ -1 +1 @@\n-old\n+new"} />
      <StructuredContentSummary value={{ ok: true }} />
      <Timeline items={[{ id: "1", time: "now", title: "Started" }]} />
      <BarChart data={[{ label: "requests", value: 10 }]} />
      <Skeleton width={5} lines={2} />
      <Drawer defaultOpen>
        <Drawer.Content label="Drawer">
          <Text>Drawer body</Text>
        </Drawer.Content>
      </Drawer>
      <Popover defaultOpen>
        <Popover.Content label="Popover">
          <Text>Popover body</Text>
        </Popover.Content>
      </Popover>
      <ErrorBoundary>
        <Text>Safe</Text>
      </ErrorBoundary>
      <Footer>
        <Text>Footer</Text>
      </Footer>
    </>,
    { terminal: { mode: "static" } },
  );
  await view.ready;
  expect(view.app.streamingPipelines.values()).toHaveLength(1);
  await Bun.sleep(25);
  const frame = view.screen.frame();
  for (const expected of [
    "Header",
    "Sidebar",
    "title",
    "Started",
    "requests",
    "Safe",
    "Footer",
  ]) {
    expect(frame).toContain(expected);
  }
  await view.cleanup();
  expect(view.app.streamingPipelines.values()).toEqual([]);
});

test("code viewer highlights search matches, navigates them, and copies the active match", async () => {
  const selected: number[] = [];
  const copied: string[] = [];
  const view = renderTuil(
    <CodeViewer
      id="searchable-code"
      autoFocus
      source={"const first = 1;\nconst second = 2;\nreturn first;"}
      search="const"
      onSelectedLineChange={(line) => {
        selected.push(line);
      }}
      clipboard={{
        write(value) {
          copied.push(value);
        },
      }}
    />,
  );
  await view.ready;
  await Bun.sleep(100);
  expect(
    view.screen.getByRole("application", { name: "Code viewer" }).valueText,
  ).toBe("3 lines · 2 matches");
  expect(view.app.focus.focusedId).toBe("searchable-code");
  await view.user.press("n");
  expect(selected.at(-1)).toBe(1);
  await view.user.press("N");
  expect(selected.at(-1)).toBe(0);
  await view.user.press("\u0003");
  expect(copied).toEqual(["const"]);
  await view.cleanup();
});

test("code viewer projection does not feed selection callbacks back into parent renders", async () => {
  let callbackCalls = 0;
  const selectedLines: number[] = [];
  function ControlledViewer() {
    const [selectedLine, setSelectedLine] = useState(0);
    return (
      <CodeViewer
        id="controlled-code"
        autoFocus
        source={"const first = 1;\nconst second = 2;"}
        search="const"
        selectedLine={selectedLine}
        onSelectedLineChange={(line) => {
          callbackCalls += 1;
          selectedLines.push(line);
          setSelectedLine(line);
        }}
      />
    );
  }
  const view = renderTuil(<ControlledViewer />);
  await view.ready;
  await Bun.sleep(50);
  expect(callbackCalls).toBe(0);
  await view.user.press("n");
  await Bun.sleep(50);
  expect(callbackCalls).toBe(1);
  await view.user.press("N");
  await Bun.sleep(50);
  expect(callbackCalls).toBe(2);
  expect(selectedLines).toEqual([1, 0]);
  expect(
    view.screen.getByRole("application", { name: "Code viewer" }).valueText,
  ).toBe("2 lines · 2 matches");
  await view.cleanup();
});

test("error boundaries render custom fallbacks and report component failures", async () => {
  let reported = "";
  function Failure(): never {
    throw new Error("render failed");
  }
  const view = renderTuil(
    <ErrorBoundary
      onError={(error) => {
        reported = error.message;
      }}
      fallback={(error) => <Text>Recovered: {error.message}</Text>}
    >
      <Failure />
    </ErrorBoundary>,
  );
  await view.ready;
  expect(view.screen.frame()).toContain("Recovered: render failed");
  expect(reported).toBe("render failed");
  await view.cleanup();
});
