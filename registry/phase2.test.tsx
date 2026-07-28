import { afterEach, expect, test } from "bun:test";
import { useApp } from "@mwillbanks/tuil";
import { defineCommand } from "@mwillbanks/tuil-core";
import {
  adaptTanStackField,
  TerminalFormController,
} from "@mwillbanks/tuil-form";
import { useHotkey } from "@mwillbanks/tuil-hotkeys";
import { useTerminalInput } from "@mwillbanks/tuil-ink";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { useCallback, useEffect, useState } from "react";
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
  Slider,
  Switch,
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
const backgroundHotkeyOptions = Object.freeze({});

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
    <>
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
      />
      <Button id="after-count">After count</Button>
    </>,
  );
  await number.user.press("arrowUp");
  await number.user.press("arrowUp");
  expect(numbers).toEqual([3, 3]);
  await number.user.press("backspace");
  await number.user.type("x");
  await number.user.press("tab");
  expect(number.app.focus.focusedId).toBe("after-count");
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
  await radio.user.press("arrowUp");
  await radio.user.press("arrowDown");
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

test("buttons execute registered commands and render suffix content", async () => {
  const executions: string[] = [];
  function CommandButton() {
    const app = useApp();
    useEffect(() => {
      const registration = app.commands.register(
        defineCommand({
          id: "button.execute",
          title: "Execute button",
          execute: ({ source }) => {
            executions.push(source ?? "");
          },
        }),
      );
      return () => {
        void registration.dispose();
      };
    }, [app]);
    return (
      <Button
        id="command-button"
        command="button.execute"
        suffix="!"
        autoFocus
        hotkeys={["ctrl+x"]}
      >
        Execute
      </Button>
    );
  }
  const view = renderTuil(<CommandButton />);
  await view.ready;
  expect(view.screen.frame()).toContain("!");
  await view.user.press("enter");
  await view.user.press("ctrl+x");
  expect(executions).toEqual(["command-button", "command-button"]);
  await view.cleanup();
});

test("buttons activate through shared pointer hit testing", async () => {
  let presses = 0;
  const view = renderTuil(
    <Button
      id="registry-pointer-button"
      layout={{
        bounds: { x: 0, y: 0, width: 12, height: 1 },
        clip: { x: 0, y: 0, width: 80, height: 24 },
        zIndex: 1,
        focusable: true,
        pointerEvents: "auto",
      }}
      onPress={() => {
        presses += 1;
      }}
    >
      Pointer
    </Button>,
  );
  await view.ready;
  await view.user.press("\u001b[<0;2;1M");
  await view.user.press("\u001b[<0;2;1m");
  expect(presses).toBe(1);
  expect(view.app.focus.focusedId).toBe("registry-pointer-button");
  await view.cleanup();
});

test("selection controls expose pointer options with keyboard parity", async () => {
  const selections: string[] = [];
  const view = renderTuil(
    <RadioGroup
      id="pointer-runtime"
      label="Runtime"
      options={options}
      onValueChange={(value) => {
        selections.push(value);
      }}
    />,
  );
  await view.ready;
  expect(
    view.app.layout.get("pointer-runtime:javascript")?.bounds.width,
  ).toBeGreaterThan(0);
  await view.user.press("\u001b[<0;2;2M");
  await view.user.press("\u001b[<0;2;2m");
  expect(selections).toEqual(["javascript"]);
  expect(view.app.focus.focusedId).toBe("pointer-runtime");
  await view.user.press("arrowUp");
  await view.user.press("enter");
  expect(selections).toEqual(["javascript", "typescript"]);
  await view.cleanup();
});

test("slider supports keyboard, click, drag, and semantic value updates", async () => {
  const values: number[] = [];
  const view = renderTuil(
    <Slider
      id="volume"
      label="Volume"
      defaultValue={20}
      step={10}
      autoFocus
      onValueChange={(value) => {
        values.push(value);
      }}
    />,
  );
  await view.ready;
  await view.user.press("arrowRight");
  expect(values.at(-1)).toBe(30);
  const bounds = view.app.layout.get("volume")?.bounds;
  expect(bounds?.width).toBeGreaterThan(0);
  const column = (bounds?.x ?? 0) + Math.floor((bounds?.width ?? 1) / 2) + 1;
  const row = (bounds?.y ?? 0) + 1;
  await view.user.press(`\u001b[<0;${column};${row}M`);
  await view.user.press(`\u001b[<0;${column};${row}m`);
  expect(values.at(-1)).toBe(50);
  expect(view.screen.getByRole("slider", { name: "Volume" }).valueText).toBe(
    "50",
  );
  await view.cleanup();
});

test("controls cover cursor, bounds, search, and selection limit policies", async () => {
  const editor = renderTuil(
    <Field label="Bounded" description="Three characters maximum">
      <TextInput
        id="bounded"
        label="Bounded"
        defaultValue="ab"
        maxLength={3}
        autoFocus
      />
    </Field>,
  );
  await editor.ready;
  await editor.user.press("arrowLeft");
  await editor.user.press("arrowRight");
  await editor.user.press("arrowLeft");
  await editor.user.press("backspace");
  await editor.user.press("backspace");
  await editor.user.type("long");
  expect(editor.screen.frame()).toContain("Three characters maximum");
  expect(
    editor.screen.getByRole("textbox", { name: "Bounded" }).valueText,
  ).toBe("lob");
  await editor.cleanup();

  const switches: boolean[] = [];
  const toggle = renderTuil(
    <Switch
      id="notifications"
      label="Notifications"
      autoFocus
      onCheckedChange={(checked) => {
        switches.push(checked);
      }}
    >
      Notifications
    </Switch>,
  );
  await toggle.user.press("enter");
  expect(switches).toEqual([true]);
  await toggle.cleanup();

  const searchable = renderTuil(
    <Select
      id="searchable"
      label="Searchable"
      options={options}
      searchable
      autoFocus
    />,
  );
  await searchable.user.press("arrowUp");
  await searchable.user.press("arrowUp");
  await searchable.user.press("arrowDown");
  await searchable.user.type("z");
  expect(searchable.screen.frame()).toContain("No options");
  await searchable.user.press("backspace");
  await searchable.user.press("escape");
  expect(searchable.screen.frame()).not.toContain("No options");
  await searchable.cleanup();

  const limited: readonly string[][] = [];
  const multi = renderTuil(
    <MultiSelect
      id="limited"
      label="Limited"
      options={options}
      maxSelected={1}
      autoFocus
      onValueChange={(values) => {
        (limited as string[][]).push([...values]);
      }}
    />,
  );
  await multi.user.press("space");
  await multi.user.press("arrowDown");
  await multi.user.press("space");
  await multi.user.press("arrowUp");
  await multi.user.press("space");
  expect(limited).toEqual([["typescript"], []]);
  await multi.cleanup();

  const completions: string[] = [];
  const autocomplete = renderTuil(
    <Autocomplete
      id="keyboard-completion"
      label="Keyboard completion"
      options={options}
      autoFocus
      onOptionSelect={(option) => {
        completions.push(option.value);
      }}
    />,
  );
  await autocomplete.user.press("arrowDown");
  await autocomplete.user.press("arrowUp");
  await autocomplete.user.press("enter");
  expect(completions).toEqual(["typescript"]);
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
    const incrementBackgroundInputs = useCallback(() => {
      backgroundInputs += 1;
    }, []);
    useHotkey("arrowdown", incrementBackgroundInputs, backgroundHotkeyOptions);
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
  await Bun.sleep(75);
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
  await view.app.commands.execute("form.validate");
  expect(causes).toHaveLength(2);
  expect(view.app.focus.focusedId).toBe("name");
  expect(
    view.screen.getByRole("alert", { name: "Name is required" }),
  ).toBeDefined();
  expect(view.screen.frame()).toContain("Name is required");
  await view.user.type("tuil");
  expect(changes).toEqual(["t", "tu", "tui", "tuil"]);
});

test("form controllers own registered field reset, restore, values, and subscriptions", async () => {
  const controller = new TerminalFormController();
  const view = renderTuil(
    <Form id="owned-form" controller={controller}>
      <TextInput
        id="owned-name"
        label="Owned name"
        defaultValue="initial"
        validators={{
          command: (value) => (value ? undefined : "Required"),
        }}
        autoFocus
      />
    </Form>,
  );
  await view.ready;
  expect(controller.values({ redactSecrets: false })).toEqual({
    "owned-name": "initial",
  });
  await view.user.type("x");
  expect(controller.dirty).toBeTrue();
  expect(controller.validationSummary()).toEqual([]);
  await controller.restore({ "owned-name": "restored", unknown: "ignored" });
  expect(controller.values({ redactSecrets: false })["owned-name"]).toBe(
    "restored",
  );
  controller.reset();
  await Bun.sleep(75);
  expect(controller.dirty).toBeFalse();
  await controller.validate("command");
  await view.cleanup();
  controller.dispose();
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

  let cancelled = false;
  const triggered = renderTuil(
    <ConfirmDialog
      id="triggered-confirm"
      title="Archive project?"
      trigger="Archive"
      onConfirm={() => undefined}
      onCancel={() => {
        cancelled = true;
      }}
    />,
  );
  await triggered.ready;
  const trigger = triggered.screen.getByRole("button", { name: "Open dialog" });
  if (!trigger.id) throw new Error("Dialog trigger is missing an id");
  expect(triggered.app.focus.focus(trigger.id)).toBeTrue();
  await triggered.user.press("enter");
  const cancel = triggered.screen.getByRole("button", { name: "Cancel" });
  if (!cancel.id) throw new Error("Dialog cancel button is missing an id");
  expect(triggered.app.focus.focus(cancel.id)).toBeTrue();
  await triggered.user.press("enter");
  expect(cancelled).toBeTrue();
  await triggered.cleanup();

  const tooltip = renderTuil(
    <Tooltip targetId="help" content="Contextual help" delay={0}>
      <Button id="help" autoFocus>
        Help
      </Button>
      <Button id="other-help">Other</Button>
    </Tooltip>,
  );
  await tooltip.ready;
  await Bun.sleep(75);
  expect(tooltip.screen.frame()).toContain("Contextual help");
  expect(
    tooltip.screen.getByRole("status", { name: "Help for help" }),
  ).toBeDefined();
  await tooltip.user.press("f1");
  await Bun.sleep(75);
  expect(() =>
    tooltip.screen.getByRole("status", { name: "Help for help" }),
  ).toThrow();
  await tooltip.user.press("f1");
  await Bun.sleep(75);
  expect(
    tooltip.screen.getByRole("status", { name: "Help for help" }),
  ).toBeDefined();
  expect(tooltip.app.focus.focus("other-help")).toBeTrue();
  await Bun.sleep(75);
  expect(() =>
    tooltip.screen.getByRole("status", { name: "Help for help" }),
  ).toThrow();
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

  let toastApi: ReturnType<typeof useToast> | undefined;
  let toastActions = 0;
  function ToastHarness() {
    const toast = useToast();
    toastApi = toast;
    useEffect(() => {
      toast.show({ title: "Saved", variant: "success", duration: 0 });
      toast.show({
        id: "action-toast",
        title: "Action",
        description: "Available",
        duration: 0,
        action: {
          label: "Act",
          run: () => {
            toastActions += 1;
          },
        },
      });
      toast.show({ title: "Temporary", duration: 1 });
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
  if (!toastApi) throw new Error("Toast API was not initialized");
  expect(toasts.screen.getByRole("status", { name: "Saved" })).toBeDefined();
  const action = toasts.screen.getByRole("button", { name: "Act" });
  if (!action.id) throw new Error("Toast action is missing an id");
  expect(toasts.app.focus.focus(action.id)).toBeTrue();
  await toasts.user.press("enter");
  expect(toastActions).toBe(1);
  toastApi.update("missing", { title: "Ignored" });
  toastApi.update("action-toast", {
    title: "Updated action",
    variant: "warning",
  });
  await Bun.sleep(10);
  expect(
    toasts.screen.getByRole("status", { name: "Updated action" }),
  ).toBeDefined();
  expect(
    await toastApi.promise(Promise.resolve(2), {
      loading: "Loading success",
      success: (value) => `Loaded ${value}`,
      error: "Failed",
    }),
  ).toBe(2);
  await expect(
    toastApi.promise(Promise.reject(new Error("nope")), {
      loading: "Loading failure",
      success: "Loaded",
      error: (error) =>
        `Failed: ${error instanceof Error ? error.message : String(error)}`,
    }),
  ).rejects.toThrow("nope");
  await Bun.sleep(10);
  expect(toasts.screen.frame()).toContain("Loaded 2");
  expect(toasts.screen.frame()).toContain("Failed: nope");
  const dismiss = toasts.screen
    .getAllByRole("button", { name: "Dismiss" })
    .at(-1);
  if (!dismiss?.id) throw new Error("Toast dismiss button is missing an id");
  expect(toasts.app.focus.focus(dismiss.id)).toBeTrue();
  await toasts.user.press("enter");
  toastApi.dismiss("action-toast");
  toastApi.dismiss("missing");
  await Bun.sleep(5);
  expect(toasts.screen.frame()).not.toContain("Temporary");
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
  await palette.user.press("arrowDown");
  await palette.user.press("arrowUp");
  await palette.user.type("missing");
  await palette.user.press("enter");
  expect(palette.screen.frame()).toContain("No matching commands");
  await palette.user.type(`${"\u007f".repeat("missing".length)}create`);
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
          <Dialog.Description>Static description</Dialog.Description>
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
