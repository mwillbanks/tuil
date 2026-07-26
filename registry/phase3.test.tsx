import { afterEach, expect, test } from "bun:test";
import { defineCommand, useApp } from "@mwillbanks/tuil";
import { createOperation, defineOperation } from "@mwillbanks/tuil-operations";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import {
  createWorkflow,
  defineOperationStep,
  defineStep,
  defineWorkflow,
  transition,
} from "@mwillbanks/tuil-workflow";
import { Box } from "ink";
import { useEffect } from "react";
import {
  Breadcrumbs,
  Menu,
  Menubar,
  Stepper,
  Tabs,
} from "./navigation/navigation.tsx";
import {
  HelpOverlay,
  OperationTree,
  SplashScreen,
  Workflow,
} from "./workflows/workflow.tsx";

afterEach(cleanup);

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
  await tabs.user.press("tab");
  await tabs.user.press("arrowRight");
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
  await menu.user.press("tab");
  await menu.user.press("arrowDown");
  await menu.user.press("enter");
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
      <OperationTree operations={[parent.state]} showAttempts showDuration />
      <SplashScreen
        title="Starting"
        message="Loading"
        progress={0.5}
        status="Working"
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
  await tree.user.press("enter");
  expect(tree.screen.frame()).not.toContain("Child");
  expect(expandedChanges.at(-1)).toEqual([]);
  await tree.user.press("enter");
  expect(tree.screen.frame()).toContain("Child");
  await tree.cleanup();

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
