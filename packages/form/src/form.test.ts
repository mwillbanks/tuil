import { expect, test } from "bun:test";
import {
  adaptTanStackField,
  TerminalFieldController,
  TerminalFormController,
} from "./index.tsx";

test("terminal fields validate, cancel stale work, track state, and redact secrets", async () => {
  const changes: string[] = [];
  const field = new TerminalFieldController({
    name: "token",
    initialValue: "",
    secret: true,
    onValueChange(value) {
      changes.push(value);
    },
    validators: {
      change: async (value, { signal }) => {
        await Bun.sleep(value === "slow" ? 20 : 1);
        signal.throwIfAborted();
        return value.length < 3 ? "Too short" : undefined;
      },
      submit: (value) => (value ? undefined : "Required"),
    },
  });
  const slow = field.setValue("slow");
  const fast = field.setValue("ok");
  await Promise.all([slow, fast]);
  expect(field.state.errors).toEqual(["Too short"]);
  expect(field.state.dirty).toBeTrue();
  expect(changes).toEqual(["slow", "ok"]);
  expect(field.serialize()).toBe("[REDACTED]");
  await field.setValue("valid");
  expect(field.state.valid).toBeTrue();
  field.reset();
  expect(field.state.value).toBe("");
  expect(field.state.dirty).toBeFalse();
});

test("aborted validation clears pending state without applying stale errors", async () => {
  const field = new TerminalFieldController({
    name: "remote",
    initialValue: "value",
    validators: {
      command: async () => {
        await Bun.sleep(20);
        return "Unavailable";
      },
    },
  });
  const cancellation = new AbortController();
  const validation = field.validate("command", cancellation.signal);
  cancellation.abort();
  await validation;
  expect(field.state.validating).toBeFalse();
  expect(field.state.errors).toEqual([]);
});

test("forms validate in registration order, focus first invalid, submit, and reset", async () => {
  const form = new TerminalFormController();
  const name = new TerminalFieldController({
    name: "name",
    initialValue: "",
    validators: { submit: (value) => (value ? undefined : "Required") },
  });
  let runtimeValid = false;
  const runtime = new TerminalFieldController({
    name: "runtime",
    initialValue: "bun",
    validators: {
      submit: () => (runtimeValid ? undefined : "Unsupported"),
    },
  });
  form.register({
    name: "name",
    validate: (trigger, signal) => name.validate(trigger, signal),
    reset: () => name.reset(),
    dirty: () => name.state.dirty,
    value: (redact) => name.serialize(redact),
    errors: () => name.state.errors,
    restore: (value) =>
      name.setValue(String(value), { validate: false }).then(() => undefined),
  });
  form.register({
    name: "runtime",
    validate: (trigger, signal) => runtime.validate(trigger, signal),
    reset: () => runtime.reset(),
    dirty: () => runtime.state.dirty,
    value: (redact) => runtime.serialize(redact),
    errors: () => runtime.state.errors,
    restore: (value) =>
      runtime
        .setValue(String(value), { validate: false })
        .then(() => undefined),
  });
  const focused: string[] = [];
  expect(
    await form.validate("submit", { focus: (field) => focused.push(field) }),
  ).toBeFalse();
  expect(focused).toEqual(["name"]);
  expect(runtime.state.errors).toEqual(["Unsupported"]);
  expect(form.validationSummary()).toEqual([
    { field: "name", message: "Required" },
    { field: "runtime", message: "Unsupported" },
  ]);
  expect(await form.submit(() => "invalid")).toBeUndefined();
  await name.setValue("Tuil", { validate: false });
  runtimeValid = true;
  expect(await form.submit((values) => values["runtime"])).toBe("bun");
  expect(form.dirty).toBeTrue();
  await form.restore({ runtime: "node" });
  expect(form.values({ redactSecrets: false })["runtime"]).toBe("node");
  form.reset();
  expect(form.dirty).toBeFalse();
});

test("TanStack fields adapt without coupling terminal controls to form state", () => {
  let next = "";
  let blurred = false;
  const adapted = adaptTanStackField({
    name: "project",
    state: {
      value: "tuil",
      meta: {
        errors: ["Taken"],
        isTouched: true,
        isDirty: true,
        isValidating: false,
      },
    },
    handleChange(value) {
      next = value;
    },
    handleBlur() {
      blurred = true;
    },
  });
  adapted.setValue("terminal");
  adapted.blur();
  expect(next).toBe("terminal");
  expect(blurred).toBeTrue();
  expect(adapted.errors).toEqual(["Taken"]);
});
