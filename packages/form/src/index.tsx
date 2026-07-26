import {
  createFormHook,
  createFormHookContexts,
  formOptions,
  useForm,
  useStore,
} from "@tanstack/react-form";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

export {
  createFormHook,
  createFormHookContexts,
  formOptions,
  useForm,
  useStore,
};

export type ValidationTrigger = "change" | "blur" | "submit" | "command";

export interface ValidationContext {
  readonly signal: AbortSignal;
  readonly trigger: ValidationTrigger;
}

export type FieldValidator<T> = (
  value: T,
  context: ValidationContext,
) => string | undefined | Promise<string | undefined>;

export interface FieldValidators<T> {
  readonly change?: FieldValidator<T> | readonly FieldValidator<T>[];
  readonly blur?: FieldValidator<T> | readonly FieldValidator<T>[];
  readonly submit?: FieldValidator<T> | readonly FieldValidator<T>[];
  readonly command?: FieldValidator<T> | readonly FieldValidator<T>[];
}

export interface TerminalFieldOptions<T> {
  readonly name: string;
  readonly initialValue: T;
  readonly value?: T;
  readonly onValueChange?: (value: T) => void | Promise<void>;
  readonly validators?: FieldValidators<T>;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly secret?: boolean;
}

export interface TerminalFieldState<T> {
  readonly name: string;
  readonly value: T;
  readonly initialValue: T;
  readonly errors: readonly string[];
  readonly touched: boolean;
  readonly dirty: boolean;
  readonly validating: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly valid: boolean;
}

type FieldObserver = () => void;

function validatorsFor<T>(
  validators: FieldValidators<T> | undefined,
  trigger: ValidationTrigger,
): readonly FieldValidator<T>[] {
  const configured = validators?.[trigger];
  if (!configured) return [];
  return Array.isArray(configured)
    ? configured
    : [configured as FieldValidator<T>];
}

function combinedSignal(
  internal: AbortSignal,
  external?: AbortSignal,
): AbortSignal {
  return external ? AbortSignal.any([internal, external]) : internal;
}

export class TerminalFieldController<T> {
  #options: TerminalFieldOptions<T>;
  #state: TerminalFieldState<T>;
  readonly #observers = new Set<FieldObserver>();
  #validation?: AbortController;
  #validationSequence = 0;

  constructor(options: TerminalFieldOptions<T>) {
    this.#options = options;
    const value = options.value ?? options.initialValue;
    this.#state = Object.freeze({
      name: options.name,
      value,
      initialValue: options.initialValue,
      errors: [],
      touched: false,
      dirty: !Object.is(value, options.initialValue),
      validating: false,
      disabled: options.disabled ?? false,
      readOnly: options.readOnly ?? false,
      valid: true,
    });
  }

  get state(): TerminalFieldState<T> {
    return this.#state;
  }

  get secret(): boolean {
    return this.#options.secret ?? false;
  }

  subscribe(observer: FieldObserver): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  configure(options: TerminalFieldOptions<T>): void {
    this.#options = options;
    const externalValue = options.value;
    const nextValue =
      externalValue === undefined ? this.#state.value : externalValue;
    const next = {
      ...this.#state,
      name: options.name,
      value: nextValue,
      initialValue: options.initialValue,
      dirty: !Object.is(nextValue, options.initialValue),
      disabled: options.disabled ?? false,
      readOnly: options.readOnly ?? false,
    };
    if (
      next.name !== this.#state.name ||
      !Object.is(next.value, this.#state.value) ||
      !Object.is(next.initialValue, this.#state.initialValue) ||
      next.dirty !== this.#state.dirty ||
      next.disabled !== this.#state.disabled ||
      next.readOnly !== this.#state.readOnly
    ) {
      this.#setState(next);
    }
  }

  async setValue(
    value: T,
    options: {
      readonly validate?: boolean;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<TerminalFieldState<T>> {
    if (this.#state.disabled || this.#state.readOnly) return this.#state;
    this.#setState({
      ...this.#state,
      value,
      dirty: !Object.is(value, this.#state.initialValue),
    });
    await this.#options.onValueChange?.(value);
    return options.validate === false
      ? this.#state
      : this.validate("change", options.signal);
  }

  async blur(signal?: AbortSignal): Promise<TerminalFieldState<T>> {
    this.#setState({ ...this.#state, touched: true });
    return this.validate("blur", signal);
  }

  async validate(
    trigger: ValidationTrigger = "command",
    signal?: AbortSignal,
  ): Promise<TerminalFieldState<T>> {
    const validators = validatorsFor(this.#options.validators, trigger);
    this.#validation?.abort();
    const validation = new AbortController();
    this.#validation = validation;
    const validationSignal = combinedSignal(validation.signal, signal);
    const sequence = ++this.#validationSequence;
    if (trigger === "submit") {
      this.#setState({ ...this.#state, touched: true, validating: true });
    } else {
      this.#setState({ ...this.#state, validating: true });
    }
    const errors: string[] = [];
    try {
      for (const validator of validators) {
        validationSignal.throwIfAborted();
        const error = await validator(this.#state.value, {
          signal: validationSignal,
          trigger,
        });
        validationSignal.throwIfAborted();
        if (error) errors.push(error);
      }
    } catch (error) {
      if (sequence === this.#validationSequence) {
        this.#setState({ ...this.#state, validating: false });
      }
      if (validationSignal.aborted) return this.#state;
      throw error;
    }
    if (sequence !== this.#validationSequence) return this.#state;
    this.#setState({
      ...this.#state,
      errors: Object.freeze(errors),
      validating: false,
      valid: errors.length === 0,
    });
    return this.#state;
  }

  setErrors(errors: readonly string[]): void {
    this.#setState({
      ...this.#state,
      errors: Object.freeze([...errors]),
      valid: errors.length === 0,
      validating: false,
    });
  }

  reset(value: T = this.#state.initialValue): void {
    this.#validation?.abort();
    this.#validationSequence += 1;
    this.#setState({
      ...this.#state,
      value,
      initialValue: value,
      errors: [],
      touched: false,
      dirty: false,
      validating: false,
      valid: true,
    });
  }

  serialize(redactSecrets = true): T | "[REDACTED]" {
    return redactSecrets && this.secret ? "[REDACTED]" : this.#state.value;
  }

  dispose(): void {
    this.#validation?.abort();
    this.#observers.clear();
  }

  #setState(state: TerminalFieldState<T>): void {
    this.#state = Object.freeze(state);
    for (const observer of this.#observers) observer();
  }
}

export interface TerminalFieldBinding<T> extends TerminalFieldState<T> {
  readonly setValue: (
    value: T,
    options?: { readonly validate?: boolean; readonly signal?: AbortSignal },
  ) => Promise<TerminalFieldState<T>>;
  readonly blur: (signal?: AbortSignal) => Promise<TerminalFieldState<T>>;
  readonly validate: (
    trigger?: ValidationTrigger,
    signal?: AbortSignal,
  ) => Promise<TerminalFieldState<T>>;
  readonly reset: (value?: T) => void;
  readonly serialize: (redactSecrets?: boolean) => T | "[REDACTED]";
  readonly subscribe: (observer: () => void) => () => void;
}

export function useTerminalField<T>(
  options: TerminalFieldOptions<T>,
): TerminalFieldBinding<T> {
  const controllerRef = useRef<TerminalFieldController<T> | undefined>(
    undefined,
  );
  if (!controllerRef.current) {
    controllerRef.current = new TerminalFieldController(options);
  }
  const controller = controllerRef.current;
  useLayoutEffect(() => controller.configure(options), [controller, options]);
  useEffect(() => () => controller.dispose(), [controller]);
  const state = useSyncExternalStore(
    (notify) => controller.subscribe(notify),
    () => controller.state,
    () => controller.state,
  );
  return {
    ...state,
    setValue: (value, setOptions) => controller.setValue(value, setOptions),
    blur: (signal) => controller.blur(signal),
    validate: (trigger, signal) => controller.validate(trigger, signal),
    reset: (value) => controller.reset(value),
    serialize: (redactSecrets) => controller.serialize(redactSecrets),
    subscribe: (observer) => controller.subscribe(observer),
  };
}

const TerminalFormContext = createContext<TerminalFormController | undefined>(
  undefined,
);

export function TerminalFormProvider(props: {
  readonly controller?: TerminalFormController;
  readonly children?: ReactNode;
}): ReactNode {
  const controller = useMemo(
    () => props.controller ?? new TerminalFormController(),
    [props.controller],
  );
  useEffect(
    () => () => {
      if (!props.controller) controller.dispose();
    },
    [controller, props.controller],
  );
  return (
    <TerminalFormContext.Provider value={controller}>
      {props.children}
    </TerminalFormContext.Provider>
  );
}

export function useTerminalFormController(): TerminalFormController {
  const controller = useContext(TerminalFormContext);
  if (!controller) {
    throw new Error("useTerminalFormController requires TerminalFormProvider");
  }
  return controller;
}

export function useTerminalFormSnapshot(): {
  readonly dirty: boolean;
  readonly errors: readonly FormValidationError[];
  readonly values: Readonly<Record<string, unknown>>;
} {
  const controller = useTerminalFormController();
  useSyncExternalStore(
    (notify) => controller.subscribe(notify),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );
  return {
    dirty: controller.dirty,
    errors: controller.validationSummary(),
    values: controller.values(),
  };
}

export function useRegisterTerminalField<T>(
  field: TerminalFieldBinding<T>,
  enabled = true,
  externalField?: AdaptedTanStackField<T>,
): void {
  const controller = useContext(TerminalFormContext);
  const fieldRef = useRef(field);
  const externalFieldRef = useRef(externalField);
  fieldRef.current = field;
  externalFieldRef.current = externalField;
  useEffect(() => {
    if (!controller || !enabled) return;
    return controller.register({
      name: field.name,
      validate: async (trigger, signal) => {
        const terminalState = await fieldRef.current.validate(trigger, signal);
        await externalFieldRef.current?.validate(
          trigger === "command" ? "submit" : trigger,
        );
        return {
          valid:
            terminalState.valid &&
            (externalFieldRef.current?.errors.length ?? 0) === 0,
        };
      },
      reset: () => {
        externalFieldRef.current?.reset();
        fieldRef.current.reset();
      },
      dirty: () => externalFieldRef.current?.dirty ?? fieldRef.current.dirty,
      value: (redactSecrets) =>
        redactSecrets && fieldRef.current.serialize() === "[REDACTED]"
          ? "[REDACTED]"
          : (externalFieldRef.current?.value ??
            fieldRef.current.serialize(redactSecrets)),
      errors: () => [
        ...fieldRef.current.errors,
        ...(externalFieldRef.current?.errors ?? []),
      ],
      restore: (value) =>
        fieldRef.current
          .setValue(value as T, { validate: false })
          .then(() => undefined),
      subscribe: (observer) => {
        const unsubscribeTerminal = fieldRef.current.subscribe(observer);
        const unsubscribeExternal =
          externalFieldRef.current?.subscribe(observer);
        return () => {
          unsubscribeExternal?.();
          unsubscribeTerminal();
        };
      },
    });
  }, [controller, enabled, field.name]);
}

export interface TanStackFieldLike<T> {
  readonly name: string;
  readonly state: {
    readonly value: T;
    readonly meta: {
      readonly errors: readonly unknown[];
      readonly isTouched: boolean;
      readonly isDirty: boolean;
      readonly isValidating: boolean;
    };
  };
  readonly handleChange: (value: T) => void;
  readonly handleBlur: () => void;
  readonly validate?: (
    cause: "change" | "blur" | "submit",
  ) => unknown | Promise<unknown>;
  readonly reset?: () => void;
  readonly store?: {
    readonly subscribe: (
      observer: () => void,
    ) => (() => void) | { readonly unsubscribe: () => void };
  };
}

export interface AdaptedTanStackField<T> {
  readonly name: string;
  readonly value: T;
  readonly errors: readonly string[];
  readonly touched: boolean;
  readonly dirty: boolean;
  readonly validating: boolean;
  readonly setValue: (value: T) => void;
  readonly blur: () => void;
  readonly validate: (cause: "change" | "blur" | "submit") => Promise<void>;
  readonly reset: () => void;
  readonly subscribe: (observer: () => void) => () => void;
}

export function adaptTanStackField<T>(
  field: TanStackFieldLike<T>,
): AdaptedTanStackField<T> {
  return {
    get name() {
      return field.name;
    },
    get value() {
      return field.state.value;
    },
    get errors() {
      return field.state.meta.errors.map((error) =>
        typeof error === "string" ? error : String(error),
      );
    },
    get touched() {
      return field.state.meta.isTouched;
    },
    get dirty() {
      return field.state.meta.isDirty;
    },
    get validating() {
      return field.state.meta.isValidating;
    },
    setValue: field.handleChange,
    blur: field.handleBlur,
    async validate(cause) {
      await field.validate?.(cause);
    },
    reset() {
      field.reset?.();
    },
    subscribe(observer) {
      const subscription = field.store?.subscribe(observer);
      if (!subscription) return () => undefined;
      return typeof subscription === "function"
        ? subscription
        : () => subscription.unsubscribe();
    },
  };
}

export interface FormFieldRegistration {
  readonly name: string;
  readonly validate: (
    trigger: ValidationTrigger,
    signal?: AbortSignal,
  ) => Promise<{ readonly valid: boolean }>;
  readonly reset: () => void;
  readonly dirty: () => boolean;
  readonly value: (redactSecrets?: boolean) => unknown;
  readonly errors?: () => readonly string[];
  readonly restore?: (value: unknown) => void | Promise<void>;
  readonly subscribe?: (observer: () => void) => () => void;
}

export interface FormValidationError {
  readonly field: string;
  readonly message: string;
}

export class TerminalFormController {
  readonly #fields = new Map<string, FormFieldRegistration>();
  readonly #fieldSubscriptions = new Map<string, () => void>();
  readonly #observers = new Set<() => void>();
  #submission?: AbortController;
  #version = 0;

  register(field: FormFieldRegistration): () => void {
    if (this.#fields.has(field.name)) {
      throw new Error(`Duplicate form field "${field.name}"`);
    }
    this.#fields.set(field.name, field);
    const unsubscribe = field.subscribe?.(() => this.#notify());
    if (unsubscribe) this.#fieldSubscriptions.set(field.name, unsubscribe);
    this.#notify();
    return () => {
      this.#fields.delete(field.name);
      this.#fieldSubscriptions.get(field.name)?.();
      this.#fieldSubscriptions.delete(field.name);
      this.#notify();
    };
  }

  subscribe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  snapshot(): number {
    return this.#version;
  }

  get dirty(): boolean {
    return [...this.#fields.values()].some((field) => field.dirty());
  }

  values(
    options: { readonly redactSecrets?: boolean } = {},
  ): Readonly<Record<string, unknown>> {
    return Object.freeze(
      Object.fromEntries(
        [...this.#fields.values()].map((field) => [
          field.name,
          field.value(options.redactSecrets ?? true),
        ]),
      ),
    );
  }

  validationSummary(): readonly FormValidationError[] {
    return Object.freeze(
      [...this.#fields.values()].flatMap((field) =>
        (field.errors?.() ?? []).map((message) =>
          Object.freeze({ field: field.name, message }),
        ),
      ),
    );
  }

  async restore(values: Readonly<Record<string, unknown>>): Promise<void> {
    for (const [name, value] of Object.entries(values)) {
      await this.#fields.get(name)?.restore?.(value);
    }
  }

  async validate(
    trigger: ValidationTrigger = "submit",
    options: {
      readonly signal?: AbortSignal;
      readonly focus?: (name: string) => void;
    } = {},
  ): Promise<boolean> {
    let firstInvalid: string | undefined;
    for (const field of this.#fields.values()) {
      options.signal?.throwIfAborted();
      const state = await field.validate(trigger, options.signal);
      if (!state.valid && firstInvalid === undefined) firstInvalid = field.name;
    }
    this.#notify();
    if (firstInvalid) options.focus?.(firstInvalid);
    return firstInvalid === undefined;
  }

  async submit<T>(
    handler: (
      values: Readonly<Record<string, unknown>>,
      signal: AbortSignal,
    ) => T | Promise<T>,
    options:
      | AbortSignal
      | {
          readonly signal?: AbortSignal;
          readonly focus?: (name: string) => void;
        } = {},
  ): Promise<T | undefined> {
    this.#submission?.abort();
    const submission = new AbortController();
    this.#submission = submission;
    const signal = options instanceof AbortSignal ? options : options.signal;
    const focus = options instanceof AbortSignal ? undefined : options.focus;
    const submissionSignal = combinedSignal(submission.signal, signal);
    if (
      !(await this.validate("submit", {
        signal: submissionSignal,
        focus,
      }))
    ) {
      return undefined;
    }
    submissionSignal.throwIfAborted();
    return handler(this.values({ redactSecrets: false }), submissionSignal);
  }

  reset(): void {
    this.#submission?.abort();
    for (const field of this.#fields.values()) field.reset();
  }

  dispose(): void {
    this.#submission?.abort();
    for (const unsubscribe of this.#fieldSubscriptions.values()) unsubscribe();
    this.#fieldSubscriptions.clear();
    this.#fields.clear();
    this.#notify();
    this.#observers.clear();
  }

  #notify(): void {
    this.#version += 1;
    for (const observer of this.#observers) observer();
  }
}
