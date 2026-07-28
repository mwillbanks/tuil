import { afterEach, expect, test } from "bun:test";
import { defineCommand, useApp } from "@mwillbanks/tuil";
import { createOperation, defineOperation } from "@mwillbanks/tuil-operations";
import {
  cleanup,
  clickPointerTarget,
  renderTuil,
} from "@mwillbanks/tuil-testing-ink";
import {
  createWorkflow,
  defineOperationStep,
  defineStep,
  defineWorkflow,
  transition,
} from "@mwillbanks/tuil-workflow";
import { Box, Text } from "ink";
import { useEffect } from "react";
import { ErrorBoundary } from "./feedback/overlays.tsx";
import {
  Breadcrumbs,
  Menu,
  Menubar,
  Stepper,
  Tabs,
} from "./navigation/navigation.tsx";
import {
  HelpOverlay,
  OperationList,
  OperationTree,
  SplashScreen,
  Workflow,
} from "./workflows/workflow.tsx";

afterEach(cleanup);

async function pressButton(
  view: ReturnType<typeof renderTuil>,
  name: string,
): Promise<void> {
  const button = view.screen.getByRole("button", { name });
  if (!button.id) throw new Error(`${name} button is missing an id`);
  expect(view.app.focus.focus(button.id)).toBeTrue();
  await view.user.press("enter");
}

test("tabs, menus, menubars, breadcrumbs, and steppers navigate and expose semantics", async () => {
  const selected: string[] = [];
  const tabs = renderTuil(
    <Tabs
      id="sections"
      label="Sections"
      items={[
        { id: "overview", label: "Overview", content: "Overview panel" },
        { id: "settings", label: "Settings", content: "Settings panel" },
      ]}
      onValueChange={(value) => {
        selected.push(value);
      }}
    />,
  );
  await tabs.ready;
  await clickPointerTarget(tabs, "sections:tab:settings");
  expect(selected).toEqual(["settings"]);
  expect(
    tabs.screen.getByRole("tab", { name: "Settings" }).selected,
  ).toBeTrue();
  expect(tabs.screen.getByRole("tabpanel", { name: "Settings" })).toBeDefined();
  await tabs.cleanup();

  const commands: string[] = [];
  function MenuHarness() {
    const app = useApp();
    useEffect(() => {
      const disposable = app.commands.register(
        defineCommand({
          id: "file.open",
          title: "Open",
          execute: () => commands.push("open"),
        }),
      );
      return () => {
        void disposable.dispose();
      };
    }, [app]);
    return (
      <Menu
        id="file"
        label="File"
        items={[
          { id: "new", label: "New", disabled: true },
          { id: "open", label: "Open", command: "file.open" },
        ]}
      />
    );
  }
  const menu = renderTuil(<MenuHarness />);
  await menu.ready;
  expect(menu.screen.getByRole("menu", { name: "File" })).toBeDefined();
  await clickPointerTarget(menu, "file:item:open");
  expect(commands).toEqual(["open"]);
  await menu.cleanup();

  const staticView = renderTuil(
    <>
      <Menubar
        label="Application"
        menus={[
          { id: "file", label: "File", items: [{ id: "quit", label: "Quit" }] },
          { id: "edit", label: "Edit", items: [{ id: "copy", label: "Copy" }] },
        ]}
      />
      <Breadcrumbs
        items={[
          { id: "home", label: "Home" },
          { id: "settings", label: "Settings" },
        ]}
      />
      <Stepper
        current="review"
        steps={[
          { id: "details", label: "Details" },
          { id: "review", label: "Review" },
        ]}
      />
    </>,
    { terminal: { capabilities: { interactive: false, tty: false } } },
  );
  await staticView.ready;
  expect(staticView.screen.frame()).toContain("File");
  expect(staticView.screen.frame()).toContain("Home");
  expect(staticView.screen.frame()).toContain("Review");
  await staticView.cleanup();
});

test("navigation components cover manual, nested, and command keyboard contracts", async () => {
  const tabSelections: string[] = [];
  const tabs = renderTuil(
    <Tabs
      id="manual-tabs"
      activationMode="manual"
      items={[
        { id: "one", label: "One", content: 1 },
        { id: "disabled", label: "Disabled", disabled: true },
        {
          id: "three",
          label: "Three",
          content: (
            <Box>
              <Text>Three panel</Text>
            </Box>
          ),
        },
      ]}
      onValueChange={(value) => {
        tabSelections.push(value);
      }}
    />,
  );
  await tabs.ready;
  expect(tabs.app.focus.focus("manual-tabs")).toBeTrue();
  for (const key of [
    "arrowRight",
    "arrowLeft",
    "j",
    "k",
    "l",
    "h",
    "space",
    "g",
    "G",
    "enter",
    "unhandled",
  ]) {
    await tabs.user.press(key);
  }
  expect(tabSelections).toContain("one");
  expect(tabSelections).toContain("three");
  await tabs.cleanup();

  const menuSelections: string[] = [];
  const openChanges: boolean[] = [];
  const menu = renderTuil(
    <Menu
      id="nested-menu"
      items={[
        { id: "disabled", label: "Disabled", disabled: true },
        {
          id: "parent",
          label: "Parent",
          items: [
            { id: "child-disabled", label: "Disabled child", disabled: true },
            { id: "child", label: "Child" },
          ],
        },
      ]}
      onOpenChange={(open) => {
        openChanges.push(open);
      }}
      onSelect={(item) => {
        menuSelections.push(item.id);
      }}
    />,
  );
  await menu.ready;
  expect(menu.app.focus.focus("nested-menu")).toBeTrue();
  for (const key of [
    "arrowDown",
    "arrowUp",
    "j",
    "k",
    "arrowRight",
    "arrowDown",
    "enter",
  ]) {
    await menu.user.press(key);
  }
  expect(menuSelections).toContain("child");
  expect(openChanges).toContain(false);
  await menu.user.press("enter");
  await menu.user.press("arrowRight");
  await menu.user.press("arrowLeft");
  await menu.user.press("escape");
  await menu.cleanup();

  const nestedBack = renderTuil(
    <Menu
      id="nested-back-menu"
      items={[
        {
          id: "parent",
          label: "Parent",
          items: [{ id: "child", label: "Child" }],
        },
      ]}
    />,
  );
  await nestedBack.ready;
  expect(nestedBack.app.focus.focus("nested-back-menu")).toBeTrue();
  await nestedBack.user.press("arrowRight");
  await nestedBack.user.press("arrowLeft");
  await nestedBack.user.press("unhandled");
  await nestedBack.user.press("escape");
  await nestedBack.cleanup();

  const menubarChanges: string[] = [];
  const menubar = renderTuil(
    <Menubar
      id="keyboard-menubar"
      menus={[
        { id: "file", label: "File", items: [] },
        { id: "disabled", label: "Disabled", disabled: true, items: [] },
        { id: "edit", label: "Edit", items: [] },
      ]}
      onValueChange={(value) => {
        menubarChanges.push(value);
      }}
    />,
  );
  await menubar.ready;
  expect(menubar.app.focus.focus("keyboard-menubar")).toBeTrue();
  await menubar.user.press("arrowRight");
  await menubar.user.press("arrowLeft");
  await menubar.user.press("unhandled");
  expect(menubarChanges).toEqual(["edit", "file"]);
  await menubar.cleanup();

  const crumbs: string[] = [];
  function CommandBreadcrumbs() {
    const app = useApp();
    useEffect(() => {
      const registration = app.commands.register(
        defineCommand({
          id: "navigate.home",
          title: "Home",
          execute: () => {
            crumbs.push("command");
          },
        }),
      );
      return () => {
        void registration.dispose();
      };
    }, [app]);
    return (
      <Breadcrumbs
        id="keyboard-crumbs"
        items={[
          { id: "home", label: "Home", command: "navigate.home" },
          { id: "disabled", label: "Disabled", disabled: true },
          { id: "current", label: "Current" },
        ]}
        onSelect={(item) => {
          crumbs.push(item.id);
        }}
      />
    );
  }
  const breadcrumbs = renderTuil(<CommandBreadcrumbs />);
  await breadcrumbs.ready;
  expect(breadcrumbs.app.focus.focus("keyboard-crumbs")).toBeTrue();
  await breadcrumbs.user.press("arrowLeft");
  await breadcrumbs.user.press("enter");
  await breadcrumbs.user.press("arrowRight");
  await breadcrumbs.user.press("unhandled");
  expect(crumbs).toEqual(["command", "home"]);
  await breadcrumbs.cleanup();

  const stepper = renderTuil(
    <Stepper
      orientation="vertical"
      steps={[
        { id: "done", label: "Done", status: "completed" },
        { id: "error", label: "Error", status: "error" },
        { id: "skipped", label: "Skipped", status: "skipped" },
        { id: "current", label: "Current", status: "current" },
        { id: "pending", label: "Pending" },
      ]}
    />,
    { terminal: { capabilities: { unicode: false } } },
  );
  await stepper.ready;
  expect(stepper.screen.frame()).toContain("[x] Done");
  expect(stepper.screen.frame()).toContain("[!] Error");
  expect(stepper.screen.frame()).toContain("[-] Skipped");
  await stepper.cleanup();
});

test("workflow UI tracks real operations and supports progression", async () => {
  const operation = defineOperation({
    id: "build",
    title: "Build",
    run: ({ updateProgress }) => {
      updateProgress({ current: 1, total: 1, message: "done" });
      return "ok";
    },
  });
  const runner = createWorkflow(
    defineWorkflow({
      id: "release",
      version: 1,
      initialState: { ready: true },
      steps: {
        review: defineStep({
          title: "Review",
          component: "Review changes",
          help: "Confirm the release.",
        }),
        build: defineOperationStep({
          title: "Build",
          operations: [operation],
        }),
      },
      transitions: [transition("review", "build")],
    }),
  );
  const view = renderTuil(
    <Workflow workflow={runner}>
      <Workflow.Stepper />
      <Workflow.Content />
      <Workflow.Errors />
      <Workflow.Operations expandable showAttempts showDuration />
      <Workflow.Actions showSkip />
    </Workflow>,
  );
  await view.ready;
  await Bun.sleep(10);
  expect(view.screen.frame()).toContain("Review changes");
  await runner.next();
  expect(runner.snapshot.operations[0]?.status).toBe("succeeded");
  expect(view.screen.frame()).toContain("Build");
  await runner.next();
  expect(runner.snapshot.status).toBe("completed");
});

test("workflow actions delegate next, back, skip, cancel, and retry", async () => {
  const runner = createWorkflow(
    defineWorkflow({
      id: "actions",
      version: 1,
      initialState: {},
      steps: {
        first: defineStep({ component: "First" }),
        second: defineStep({ component: "Second" }),
        third: defineStep({ component: "Third" }),
      },
      transitions: [
        transition("first", "second"),
        transition("second", "third"),
      ],
    }),
  );
  await runner.start();
  const view = renderTuil(
    <Workflow workflow={runner} autoStart={false}>
      <Workflow.Content
        render={(step) => `Rendered ${String(step?.component)}`}
      />
      <Workflow.Actions showSkip />
    </Workflow>,
  );
  await view.ready;
  await pressButton(view, "Next");
  expect(runner.snapshot.currentStep).toBe("second");
  await pressButton(view, "Back");
  expect(runner.snapshot.currentStep).toBe("first");
  await pressButton(view, "Skip");
  expect(runner.snapshot.currentStep).toBe("second");
  await pressButton(view, "Cancel");
  expect(runner.snapshot.status).toBe("cancelled");
  await view.cleanup();

  let attempts = 0;
  const retryRunner = createWorkflow(
    defineWorkflow({
      id: "retry-action",
      version: 1,
      initialState: {},
      steps: {
        retry: defineStep({
          enter() {
            attempts += 1;
            if (attempts === 1) throw new Error("first attempt");
          },
        }),
      },
      transitions: [],
    }),
  );
  await expect(retryRunner.start()).rejects.toThrow("first attempt");
  const retry = renderTuil(
    <Workflow workflow={retryRunner} autoStart={false}>
      <Workflow.Actions />
    </Workflow>,
  );
  await retry.ready;
  await pressButton(retry, "Retry");
  expect(attempts).toBe(2);
});

test("workflow auto-start reports startup failures", async () => {
  const reports: { readonly error: unknown; readonly phase: string }[] = [];
  const runner = createWorkflow(
    defineWorkflow({
      id: "startup-failure",
      version: 1,
      initialState: {},
      steps: {
        start: defineStep({
          enter() {
            throw new Error("startup failed");
          },
        }),
      },
      transitions: [],
    }),
  );
  const view = renderTuil(
    <Workflow workflow={runner}>
      <Workflow.Content />
    </Workflow>,
    {
      errorHandler(error, { phase }) {
        reports.push({ error, phase });
      },
    },
  );
  await view.ready;
  await Bun.sleep(25);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.phase).toBe("workflow-start");
  expect(reports[0]?.error).toEqual(new Error("startup failed"));
  await view.cleanup();
});

test("workflow startup preserves both startup and reporter failures", async () => {
  const runner = createWorkflow(
    defineWorkflow({
      id: "double-startup-failure",
      version: 1,
      initialState: {},
      steps: {
        start: defineStep({
          enter() {
            throw new Error("startup failed");
          },
        }),
      },
      transitions: [],
    }),
  );
  const view = renderTuil(
    <ErrorBoundary fallback={(error) => <Text>{error.message}</Text>}>
      <Workflow workflow={runner}>
        <Workflow.Content />
      </Workflow>
    </ErrorBoundary>,
    {
      errorHandler() {
        throw new Error("report failed");
      },
    },
  );
  await view.ready;
  await Bun.sleep(50);
  expect(
    view.frames.some((frame) =>
      frame.includes("Workflow startup and error reporting failed"),
    ),
  ).toBeTrue();
  await view.cleanup();
});

test("workflow compound components require their parent context", async () => {
  const view = renderTuil(
    <ErrorBoundary fallback={(error) => <Text>{error.message}</Text>}>
      <Workflow.Content />
    </ErrorBoundary>,
  );
  await view.ready;
  expect(view.screen.frame()).toContain("require a Workflow parent");
  await view.cleanup();
});

test("operation views apply deterministic waiting feedback", async () => {
  const operation = (
    id: string,
    startedAt: number,
    progress?: { current: number; total?: number; message?: string },
  ) => ({
    id,
    title: id,
    status: "running" as const,
    attempt: 1,
    startedAt,
    progress,
    children: [],
    metadata: {},
    logs: [],
  });
  const operations = [
    operation("imperceptible", 10_900),
    operation("micro", 10_500),
    operation("loading", 9_000),
    operation("stalled", 1_000, { current: 4, message: "Indexing" }),
    operation("measured", 9_000, {
      current: 5,
      total: 10,
      message: "Uploading",
    }),
    {
      ...operation("failed", 9_000),
      status: "failed" as const,
      completedAt: 10_000,
      error: { name: "Error", message: "Build failed" },
    },
  ];
  const view = renderTuil(
    <>
      <OperationList operations={operations} now={11_000} showDuration />
      <OperationTree operations={operations} now={11_000} />
      <OperationList operations={[]} now={11_000} />
    </>,
  );
  await view.ready;
  const output = view.screen.frame();
  expect(output).toContain("[ ] imperceptible");
  expect(output).toContain("[·] micro");
  expect(output).toContain("Active");
  expect(output).toContain("… Working…");
  expect(output).toContain("Indexing (10s)");
  expect(output).toContain("5/10 (50%) Uploading");
  expect(output).toContain("Build failed");
  expect(output).toContain("No operations");
  expect(output).not.toContain("4 Indexing");
});

test("live operation feedback advances its stalled duration clock", async () => {
  const startedAt = Date.now() - 10_000;
  const view = renderTuil(
    <OperationList
      operations={[
        {
          id: "live",
          title: "Live",
          status: "running",
          attempt: 1,
          startedAt,
          children: [],
          metadata: {},
          logs: [],
        },
      ]}
      showDuration
    />,
  );
  await view.ready;
  const before = view.screen.frame();
  await Bun.sleep(1_100);
  const after = view.screen.frame();
  expect(before).not.toBeEmpty();
  expect(after).not.toBeEmpty();
  await view.cleanup();
});

test("operation views, splash fallback, and live command help render", async () => {
  const parent = createOperation(
    defineOperation({
      id: "parent",
      title: "Parent",
      run: ({ runChild }) =>
        runChild(
          defineOperation({
            id: "child",
            title: "Child",
            run: () => "done",
          }),
        ),
    }),
  );
  await parent.execute();
  const staticView = renderTuil(
    <>
      <OperationList
        operations={[parent.state]}
        expandable
        showAttempts
        showDuration
      />
      <OperationTree operations={[parent.state]} showAttempts showDuration />
      <SplashScreen
        title="Starting"
        message="Loading"
        progress={0.5}
        status="Working"
        logo={"TUIL\nTUIL"}
      />
    </>,
    {
      terminal: {
        mode: "interactive",
        capabilities: { unicode: false },
      },
    },
  );
  await staticView.ready;
  const output = staticView.screen.frame();
  expect(output).toContain("Parent");
  expect(output).toContain("Child");
  expect(output).toContain("50%");
  expect(output.match(/TUIL/g)?.length).toBe(2);
  await staticView.cleanup();

  const expandedChanges: readonly string[][] = [];
  const tree = renderTuil(
    <OperationTree
      id="deploy-tree"
      operations={[parent.state]}
      onExpandedChange={(expanded) => {
        (expandedChanges as string[][]).push([...expanded]);
      }}
    />,
  );
  await tree.ready;
  expect(
    tree.screen.getByRole("tree", { name: "Operation tree" }),
  ).toBeDefined();
  expect(
    tree.screen.getByRole("treeitem", { name: "Parent" }).expanded,
  ).toBeTrue();
  await tree.user.press("tab");
  await tree.user.press("arrowRight");
  await tree.user.press("arrowDown");
  await tree.user.press("arrowUp");
  await tree.user.press("arrowLeft");
  await tree.user.press("enter");
  expect(tree.screen.frame()).toContain("Child");
  await tree.user.press("enter");
  expect(tree.screen.frame()).not.toContain("Child");
  expect(expandedChanges.at(-1)).toEqual([]);
  await tree.user.press("unhandled");
  await tree.cleanup();

  const parentNavigation = renderTuil(
    <OperationTree id="parent-navigation" operations={[parent.state]} />,
  );
  await parentNavigation.ready;
  expect(parentNavigation.app.focus.focus("parent-navigation")).toBeTrue();
  await parentNavigation.user.press("arrowDown");
  await parentNavigation.user.press("arrowLeft");
  expect(parentNavigation.screen.frame()).toContain("Parent");
  await parentNavigation.cleanup();

  const duplicateChildren = await Promise.all(
    ["left", "right"].map(async (id) => {
      const operation = createOperation(
        defineOperation({
          id,
          title: id,
          run: ({ runChild }) =>
            runChild(
              defineOperation({
                id: "shared",
                title: "Shared child",
                run: () => "done",
              }),
            ),
        }),
      );
      await operation.execute();
      return operation.state;
    }),
  );
  const duplicateTree = renderTuil(
    <OperationTree operations={duplicateChildren} />,
  );
  await duplicateTree.ready;
  const sharedNodes = duplicateTree.screen.getAllByRole("treeitem", {
    name: "Shared child",
  });
  expect(sharedNodes).toHaveLength(2);
  expect(new Set(sharedNodes.map((node) => node.key)).size).toBe(2);
  await duplicateTree.cleanup();

  function HelpHarness() {
    const app = useApp();
    useEffect(() => {
      const disposable = app.commands.register(
        defineCommand({
          id: "project.create",
          title: "Create project",
          hotkeys: ["ctrl+n"],
          execute: () => undefined,
        }),
      );
      return () => {
        void disposable.dispose();
      };
    }, [app]);
    return <HelpOverlay />;
  }
  const help = renderTuil(<HelpHarness />);
  await help.ready;
  await help.user.press("f1");
  await Bun.sleep(20);
  expect(
    help.screen.getByRole("dialog", { name: "Keyboard help" }),
  ).toBeDefined();
  expect(help.screen.frame()).toContain("Create project");
  await help.user.press("f1");
  await Bun.sleep(20);
  expect(() =>
    help.screen.getByRole("dialog", { name: "Keyboard help" }),
  ).toThrow();
});

test("workflow errors expose alert semantics and compound slots", async () => {
  const runner = createWorkflow(
    defineWorkflow({
      id: "invalid",
      version: 1,
      initialState: {},
      steps: {
        form: defineStep({
          component: "Form",
          validate: () => "Required",
        }),
      },
      transitions: [],
    }),
  );
  const view = renderTuil(
    <Workflow
      workflow={runner}
      slots={{
        root: (props) => <Box {...props} borderStyle="single" />,
        content: (props) => <Box {...props} paddingLeft={1} />,
      }}
    >
      <Workflow.Content />
      <Workflow.Errors />
      <Workflow.Actions />
    </Workflow>,
  );
  await view.ready;
  await Bun.sleep(10);
  await runner.next();
  expect(view.screen.getByRole("alert", { name: "Required" })).toBeDefined();
});

test("workflow content renders component steps, help, and commands", async () => {
  function FunctionalStep() {
    return (
      <Box>
        <Text>Functional content</Text>
      </Box>
    );
  }
  const runner = createWorkflow(
    defineWorkflow({
      id: "functional-content",
      version: 1,
      initialState: {},
      steps: {
        content: defineStep({
          title: "Functional",
          component: FunctionalStep,
          commands: ["form.submit"],
          help: "Complete every field.",
        }),
      },
      transitions: [],
    }),
  );
  const view = renderTuil(
    <Workflow workflow={runner}>
      <Workflow.Content />
    </Workflow>,
  );
  await view.ready;
  await Bun.sleep(25);
  expect(view.screen.frame()).toContain("Functional content");
  expect(view.screen.frame()).toContain("Commands: form.submit");
  await view.cleanup();
});

test("workflow content exposes the active nested workflow", async () => {
  const nested = defineWorkflow({
    id: "nested-content",
    version: 1,
    initialState: {},
    steps: {
      child: defineStep({ component: "Child content" }),
    },
    transitions: [],
  });
  const runner = createWorkflow(
    defineWorkflow({
      id: "outer-content",
      version: 1,
      initialState: {},
      steps: {
        parent: defineStep({ component: "Parent content", nested }),
      },
      transitions: [],
    }),
  );
  const view = renderTuil(
    <Workflow workflow={runner}>
      <Workflow.Content />
    </Workflow>,
  );
  await view.ready;
  await Bun.sleep(25);
  expect(view.screen.frame()).toContain("Nested: child (running)");
  await view.cleanup();
});
