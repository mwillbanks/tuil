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

test("TanStack fields adapt without coupling terminal controls to form state", async () => {
  let next = "";
  let blurred = false;
  let validated = "";
  let reset = false;
  let unsubscribed = false;
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
    validate(cause) {
      validated = cause;
    },
    reset() {
      reset = true;
    },
    store: {
      subscribe(observer) {
        observer();
        return {
          unsubscribe() {
            unsubscribed = true;
          },
        };
      },
    },
  });
  adapted.setValue("terminal");
  adapted.blur();
  await adapted.validate("submit");
  adapted.reset();
  const unsubscribe = adapted.subscribe(() => undefined);
  unsubscribe();
  expect(next).toBe("terminal");
  expect(blurred).toBeTrue();
  expect(validated).toBe("submit");
  expect(reset).toBeTrue();
  expect(unsubscribed).toBeTrue();
  expect(adapted.name).toBe("project");
  expect(adapted.value).toBe("tuil");
  expect(adapted.errors).toEqual(["Taken"]);
  expect(adapted.touched).toBeTrue();
  expect(adapted.dirty).toBeTrue();
  expect(adapted.validating).toBeFalse();

  const withoutStore = adaptTanStackField({
    name: "plain",
    state: {
      value: 1,
      meta: {
        errors: [new Error("Invalid")],
        isTouched: false,
        isDirty: false,
        isValidating: true,
      },
    },
    handleChange() {},
    handleBlur() {},
  });
  withoutStore.subscribe(() => undefined)();
  expect(withoutStore.errors).toEqual(["Error: Invalid"]);
});

test("field and form subscriptions release resources and explicit errors", async () => {
  const field = new TerminalFieldController({
    name: "name",
    initialValue: "initial",
  });
  let fieldChanges = 0;
  const stopField = field.subscribe(() => {
    fieldChanges += 1;
  });
  field.setErrors(["Explicit"]);
  expect(field.state.valid).toBeFalse();
  expect(field.serialize(false)).toBe("initial");
  field.reset("reset");
  stopField();
  field.setErrors([]);
  expect(fieldChanges).toBe(2);

  const form = new TerminalFormController();
  let formChanges = 0;
  const stopForm = form.subscribe(() => {
    formChanges += 1;
  });
  let fieldObserver: (() => void) | undefined;
  let fieldSubscriptionDisposed = false;
  const unregister = form.register({
    name: "subscribed",
    validate: async () => ({ valid: true }),
    reset: () => undefined,
    dirty: () => false,
    value: () => "value",
    subscribe(observer) {
      fieldObserver = observer;
      return () => {
        fieldSubscriptionDisposed = true;
      };
    },
  });
  fieldObserver?.();
  unregister();
  expect(fieldSubscriptionDisposed).toBeTrue();
  expect(formChanges).toBeGreaterThanOrEqual(3);
  stopForm();
  form.dispose();
  field.dispose();
});
