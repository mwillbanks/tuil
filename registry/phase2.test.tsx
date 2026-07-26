import { afterEach, expect, test } from "bun:test";
import { useApp } from "@mwillbanks/tuil";
import { defineCommand } from "@mwillbanks/tuil-core";
import { adaptTanStackField } from "@mwillbanks/tuil-form";
import { useHotkey } from "@mwillbanks/tuil-hotkeys";
import { useTerminalInput } from "@mwillbanks/tuil-ink";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { useEffect, useState } from "react";
import { Button } from "./components/button.tsx";
import {
  CommandPalette,
  ConfirmDialog,
  Dialog,
  ToastProvider,
  Tooltip,
  useToast,
} from "./feedback/overlays.tsx";
import {
  Autocomplete,
  Checkbox,
  Field,
  Form,
  MultiSelect,
  NumberInput,
  RadioGroup,
  Select,
  TextArea,
  TextInput,
  ValidationSummary,
} from "./forms/controls.tsx";

afterEach(cleanup);

const options = [
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "rust", label: "Rust", disabled: true },
] as const;

test("text controls edit, validate, submit, and step numeric values", async () => {
  const changes: string[] = [];
  const submitted: string[] = [];
  const view = renderTuil(
    <Field label="Project" error="Required" hint="Use a short name">
      <TextInput
        id="project"
        label="Project"
        autoFocus
        defaultValue="tu"
        onValueChange={(value) => {
          changes.push(value);
        }}
        onSubmit={(value) => {
          submitted.push(value);
        }}
      />
    </Field>,
  );
  await view.user.type("il");
  await view.user.press("backspace");
  await view.user.press("enter");
  expect(changes.at(-1)).toBe("tui");
  expect(submitted).toEqual(["tui"]);
  expect(view.screen.getByRole("textbox", { name: "Project" }).valueText).toBe(
    "tui",
  );
  expect(view.screen.frame()).toContain("Required");
  expect(view.screen.getByRole("alert", { name: "Required" })).toBeDefined();
  await view.cleanup();

  const multiline: string[] = [];
  const area = renderTuil(
    <TextArea
      id="notes"
      label="Notes"
      autoFocus
      onValueChange={(value) => {
        multiline.push(value);
      }}
    />,
  );
  await area.user.type("a");
  await area.user.press("enter");
  await area.user.type("b");
  expect(multiline.at(-1)).toBe("a\nb");
  await area.cleanup();

  const numbers: number[] = [];
  const number = renderTuil(
    <NumberInput
      id="count"
      label="Count"
      autoFocus
      defaultValue={2}
      min={0}
      max={3}
      onValueChange={(value) => {
        numbers.push(value);
      }}
    />,
  );
  await number.user.press("arrowUp");
  await number.user.press("arrowUp");
  expect(numbers).toEqual([3, 3]);
});

test("selection controls expose semantic state and keyboard behavior", async () => {
  const toggles: boolean[] = [];
  const checkbox = renderTuil(
    <Checkbox
      id="enabled"
      label="Enabled"
      autoFocus
      onCheckedChange={(value) => {
        toggles.push(value);
      }}
    >
      Enabled
    </Checkbox>,
  );
  await checkbox.user.press("space");
  await Bun.sleep(5);
  expect(toggles).toEqual([true]);
  expect(checkbox.screen.getByRole("checkbox").checked).toBeTrue();
  await checkbox.cleanup();

  const radios: string[] = [];
  const radio = renderTuil(
    <RadioGroup
      id="runtime"
      label="Runtime"
      autoFocus
      options={options}
      onValueChange={(value) => {
        radios.push(value);
      }}
    />,
  );
  await radio.user.press("arrowDown");
  await radio.user.press("enter");
  expect(radios).toEqual(["javascript"]);
  await radio.cleanup();

  const selected: string[] = [];
  const select = renderTuil(
    <Select
      id="language"
      label="Language"
      autoFocus
      options={options}
      onValueChange={(value) => {
        selected.push(value);
      }}
    />,
  );
  await select.user.press("enter");
  await select.user.press("arrowDown");
  await select.user.press("enter");
  await Bun.sleep(5);
  expect(selected).toEqual(["javascript"]);
  expect(
    select.screen.getByRole("listbox", { name: "Language" }).valueText,
  ).toBe("javascript");
  await select.cleanup();

  const multiple: readonly string[][] = [];
  const multi = renderTuil(
    <MultiSelect
      id="surfaces"
      label="Surfaces"
      autoFocus
      options={options}
      onValueChange={(value) => {
        (multiple as string[][]).push([...value]);
      }}
    />,
  );
  await multi.user.press("space");
  await multi.user.press("arrowDown");
  await multi.user.press("space");
  expect(multiple).toEqual([["typescript"], ["typescript", "javascript"]]);
  await multi.cleanup();

  const completions: string[] = [];
  const autocomplete = renderTuil(
    <Autocomplete
      id="completion"
      label="Completion"
      autoFocus
      options={options}
      onOptionSelect={(option) => {
        completions.push(option.value);
      }}
    />,
  );
  await autocomplete.user.type("java");
  await autocomplete.user.press("enter");
  expect(completions).toEqual(["javascript"]);
});

test("dialogs trap and restore focus while escape dismisses the top overlay", async () => {
  let backgroundInputs = 0;
  function Harness() {
    const [open, setOpen] = useState(false);
    useTerminalInput(
      (input) => {
        if (input === "x") backgroundInputs += 1;
        return false;
      },
      { priority: 3_000 },
    );
    useHotkey("arrowdown", () => {
      backgroundInputs += 1;
    });
    return (
      <>
        <Button id="outside" autoFocus onPress={() => setOpen(true)}>
          Outside
        </Button>
        <Dialog id="settings" open={open} onOpenChange={setOpen}>
          <Dialog.Content label="Settings">
            <Dialog.Title>Settings</Dialog.Title>
            <Dialog.Actions>
              <Dialog.Cancel>Close</Dialog.Cancel>
            </Dialog.Actions>
          </Dialog.Content>
        </Dialog>
      </>
    );
  }
  const view = renderTuil(<Harness />);
  await view.ready;
  expect(() => view.screen.getByRole("dialog", { name: "Settings" })).toThrow();
  await view.user.press("enter");
  expect(view.screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
  expect(view.app.focus.focusedId).not.toBe("outside");
  await view.user.type("x");
  expect(backgroundInputs).toBe(0);
  await view.user.press("arrowDown");
  expect(backgroundInputs).toBe(0);
  await view.user.press("escape");
  await Bun.sleep(50);
  expect(view.screen.frame()).not.toContain("Settings");
  expect(view.app.focus.focusedId).toBe("outside");
});

test("nested dialogs dismiss in visual depth order", async () => {
  function Harness() {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(true);
    return (
      <Dialog id="outer" open={outer} onOpenChange={setOuter}>
        <Dialog.Content label="Outer">
          <Dialog.Title>Outer</Dialog.Title>
          <Dialog.Cancel>Close outer</Dialog.Cancel>
          <Dialog id="inner" open={inner} onOpenChange={setInner}>
            <Dialog.Content label="Inner">
              <Dialog.Title>Inner</Dialog.Title>
              <Dialog.Cancel>Close inner</Dialog.Cancel>
            </Dialog.Content>
          </Dialog>
        </Dialog.Content>
      </Dialog>
    );
  }
  const view = renderTuil(<Harness />);
  await view.ready;
  await Bun.sleep(20);
  await view.user.press("escape");
  await Bun.sleep(50);
  expect(() => view.screen.getByRole("dialog", { name: "Inner" })).toThrow();
  expect(view.screen.getByRole("dialog", { name: "Outer" })).toBeDefined();
  await view.user.press("escape");
  await Bun.sleep(50);
  expect(() => view.screen.getByRole("dialog", { name: "Outer" })).toThrow();
});

test("forms validate through commands, summarize errors, blur adapters, and focus the first invalid field", async () => {
  let blurred = false;
  const changes: string[] = [];
  const causes: string[] = [];
  const state = {
    value: "",
    meta: {
      errors: [] as unknown[],
      isTouched: false,
      isDirty: false,
      isValidating: false,
    },
  };
  const adapted = adaptTanStackField({
    name: "name",
    state,
    handleChange(value: string) {
      changes.push(value);
      state.value = value;
      state.meta.isDirty = true;
    },
    handleBlur() {
      blurred = true;
      state.meta.isTouched = true;
    },
    validate(cause) {
      causes.push(cause);
      state.meta.errors = state.value ? [] : ["Name is required"];
    },
  });
  const view = renderTuil(
    <Form id="form">
      <Field label="Name" field={adapted}>
        <TextInput id="name" label="Name" field={adapted} autoFocus />
      </Field>
      <ValidationSummary />
      <Button id="after">After</Button>
    </Form>,
  );
  await view.user.press("tab");
  expect(blurred).toBeTrue();
  await view.app.commands.execute("form.submit");
  expect(causes).toContain("submit");
  expect(view.app.focus.focusedId).toBe("name");
  expect(
    view.screen.getByRole("alert", { name: "Name is required" }),
  ).toBeDefined();
  expect(view.screen.frame()).toContain("Name is required");
  await view.user.type("tuil");
  expect(changes).toEqual(["t", "tu", "tui", "tuil"]);
});

test("multiple forms receive unique default command namespaces", async () => {
  const view = renderTuil(
    <>
      <Form>
        <TextInput id="first-form-field" label="First form" />
      </Form>
      <Form>
        <TextInput id="second-form-field" label="Second form" />
      </Form>
    </>,
  );
  await view.ready;
  const formCommands = view.app.commands
    .list()
    .filter((command) => command.title === "Submit form");
  expect(formCommands).toHaveLength(2);
  expect(new Set(formCommands.map((command) => command.id)).size).toBe(2);
});

test("async TanStack field changes notify terminal validation summaries", async () => {
  const observers = new Set<() => void>();
  const state = {
    value: "",
    meta: {
      errors: [] as unknown[],
      isTouched: false,
      isDirty: false,
      isValidating: false,
    },
  };
  const adapted = adaptTanStackField({
    name: "remote-name",
    state,
    handleChange(value: string) {
      state.value = value;
      state.meta.isDirty = true;
      state.meta.isValidating = true;
      void Bun.sleep(100).then(() => {
        state.meta.isValidating = false;
        state.meta.errors = ["Remote name is unavailable"];
        for (const observer of observers) observer();
      });
    },
    handleBlur() {},
    store: {
      subscribe(observer) {
        observers.add(observer);
        return () => observers.delete(observer);
      },
    },
  });
  const view = renderTuil(
    <Form id="remote-form">
      <TextInput
        id="remote-name"
        label="Remote name"
        field={adapted}
        autoFocus
      />
      <ValidationSummary />
    </Form>,
  );
  await view.user.type("x");
  expect(view.screen.frame()).not.toContain("Remote name is unavailable");
  await Bun.sleep(120);
  expect(
    view.screen.getByRole("alert", {
      name: "Remote name is unavailable",
    }),
  ).toBeDefined();
  expect(view.screen.frame()).toContain("Remote name is unavailable");
});

test("controlled selection controls refresh active state and radio groups release tab", async () => {
  const radioChanges: string[] = [];
  const radio = renderTuil(
    <>
      <RadioGroup
        id="controlled-radio"
        label="Controlled radio"
        autoFocus
        value="typescript"
        options={options}
        onValueChange={(value) => {
          radioChanges.push(value);
        }}
      />
      <Button id="after-radio">After</Button>
    </>,
  );
  await radio.ready;
  radio.rerender(
    <>
      <RadioGroup
        id="controlled-radio"
        label="Controlled radio"
        autoFocus
        value="javascript"
        options={options}
        onValueChange={(value) => {
          radioChanges.push(value);
        }}
      />
      <Button id="after-radio">After</Button>
    </>,
  );
  await radio.user.press("enter");
  expect(radioChanges).toEqual(["javascript"]);
  await radio.user.press("tab");
  expect(radio.app.focus.focusedId).toBe("after-radio");
  await radio.cleanup();

  const selectChanges: string[] = [];
  const select = renderTuil(
    <Select
      id="controlled-select"
      label="Controlled select"
      autoFocus
      open
      value="typescript"
      options={options}
      onValueChange={(value) => {
        selectChanges.push(value);
      }}
    />,
  );
  await select.ready;
  select.rerender(
    <Select
      id="controlled-select"
      label="Controlled select"
      autoFocus
      open
      value="javascript"
      options={options}
      onValueChange={(value) => {
        selectChanges.push(value);
      }}
    />,
  );
  await select.user.press("enter");
  expect(selectChanges).toEqual(["javascript"]);
});

test("confirm, tooltip, toast, and command palette complete overlay contracts", async () => {
  let confirmed = false;
  const confirm = renderTuil(
    <ConfirmDialog
      id="confirm"
      defaultOpen
      title="Delete project?"
      onConfirm={() => {
        confirmed = true;
      }}
    />,
  );
  await confirm.user.press("tab");
  await confirm.user.press("enter");
  expect(confirmed).toBeTrue();
  await confirm.cleanup();

  const tooltip = renderTuil(
    <Tooltip targetId="help" content="Contextual help" delay={0}>
      <Button id="help" autoFocus>
        Help
      </Button>
    </Tooltip>,
  );
  await tooltip.ready;
  await Bun.sleep(20);
  expect(tooltip.screen.frame()).toContain("Contextual help");
  expect(
    tooltip.screen.getByRole("status", { name: "Help for help" }),
  ).toBeDefined();
  await tooltip.cleanup();

  const reported: { error: unknown; phase: string }[] = [];
  const rejectedTooltip = renderTuil(
    <Tooltip
      targetId="rejected-help"
      content="Rejected help"
      delay={0}
      onOpenChange={() => Promise.reject(new Error("tooltip rejected"))}
    >
      <Button id="rejected-help" autoFocus>
        Rejected help
      </Button>
    </Tooltip>,
    {
      errorHandler(error, context) {
        reported.push({ error, phase: context.phase });
      },
    },
  );
  await rejectedTooltip.ready;
  await Bun.sleep(20);
  expect(reported.map((entry) => entry.phase)).toContain("tooltip-open");
  expect(reported.every((entry) => entry.error instanceof Error)).toBeTrue();
  await rejectedTooltip.cleanup();

  function ToastHarness() {
    const toast = useToast();
    useEffect(() => {
      toast.show({ title: "Saved", variant: "success", duration: 0 });
    }, [toast]);
    return null;
  }
  const toasts = renderTuil(
    <ToastProvider>
      <ToastHarness />
    </ToastProvider>,
  );
  await toasts.ready;
  await Bun.sleep(0);
  expect(toasts.screen.getByRole("status", { name: "Saved" })).toBeDefined();
  await toasts.cleanup();

  const executions: string[] = [];
  function CommandHarness() {
    const app = useApp();
    useEffect(() => {
      const registration = app.commands.register(
        defineCommand({
          id: "project.create",
          title: "Create project",
          execute: () => {
            executions.push("created");
          },
        }),
      );
      return () => {
        void registration.dispose();
      };
    }, [app]);
    return <CommandPalette defaultOpen />;
  }
  const palette = renderTuil(<CommandHarness />);
  await palette.user.type("create");
  await palette.user.press("enter");
  expect(executions).toEqual(["created"]);
});

test("form and overlay components degrade for static and JSON output", async () => {
  const staticView = renderTuil(
    <>
      <Checkbox defaultChecked>Enabled</Checkbox>
      <Select label="Runtime" options={options} defaultValue="typescript" />
      <Dialog defaultOpen id="static-dialog">
        <Dialog.Content label="Static dialog">
          <Dialog.Title>Static dialog</Dialog.Title>
        </Dialog.Content>
      </Dialog>
    </>,
    {
      terminal: {
        mode: "static",
        capabilities: {
          unicode: false,
          colorDepth: 1,
          interactive: false,
          tty: false,
        },
      },
    },
  );
  await staticView.ready;
  expect(staticView.screen.frame()).toContain("[x] Enabled");
  expect(staticView.screen.frame()).toContain("> TypeScript");
  expect(staticView.screen.frame()).toContain("+");
  await staticView.cleanup();

  const jsonView = renderTuil(
    <Select label="Runtime" options={options} defaultValue="typescript" />,
    { terminal: { mode: "json" } },
  );
  await jsonView.ready;
  expect(
    jsonView.screen.getByRole("listbox", { name: "Runtime" }).valueText,
  ).toBe("typescript");
});
