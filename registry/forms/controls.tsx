import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type AdaptedTanStackField,
  type FieldValidators,
  type TerminalFieldBinding,
  TerminalFormController,
  TerminalFormProvider,
  useRegisterTerminalField,
  useTerminalField,
  useTerminalFormSnapshot,
} from "@mwillbanks/tuil-form";
import {
  type CommonComponentProps,
  useSemanticNode,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export interface FieldProps
  extends CommonComponentProps,
    SlottedComponentProps<{
      root: BoxProps;
      label: TextProps;
      description: TextProps;
      control: BoxProps;
      error: TextProps;
      hint: TextProps;
    }> {
  readonly label: string;
  readonly description?: string;
  readonly error?: string | readonly string[];
  readonly field?: { readonly errors: readonly string[] };
  readonly hint?: string;
  readonly required?: boolean;
  readonly children: ReactNode;
}

function useRuntimeAsync(): (work: Promise<unknown>, phase: string) => void {
  const app = useApp();
  const [error, setError] = useState<unknown>();
  const run = useCallback(
    (work: Promise<unknown>, phase: string) => {
      void work.catch(async (cause) => {
        try {
          await app.reportError(cause, phase);
        } catch (reportError) {
          setError(
            new AggregateError(
              [cause, reportError],
              `Failed to report ${phase} error`,
            ),
          );
        }
      });
    },
    [app],
  );
  if (error) throw error;
  return run;
}

function useFieldBlur<T>(
  focused: boolean,
  field: TerminalFieldBinding<T>,
  adaptedField: AdaptedTanStackField<T> | undefined,
  onBlur: (() => void | Promise<void>) | undefined,
): void {
  const reportAsync = useRuntimeAsync();
  const wasFocused = useRef(false);
  useEffect(() => {
    if (wasFocused.current && !focused) {
      reportAsync(
        field
          .blur()
          .then(() => adaptedField?.blur())
          .then(() => onBlur?.()),
        "field-blur",
      );
    }
    wasFocused.current = focused;
  }, [adaptedField, field, focused, onBlur, reportAsync]);
}

export interface FormProps {
  readonly id?: string;
  readonly controller?: TerminalFormController;
  readonly onSubmit?: (
    values: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) => unknown | Promise<unknown>;
  readonly submitCommand?: string;
  readonly validateCommand?: string;
  readonly children?: ReactNode;
}

export function Form({
  id: providedId,
  controller: providedController,
  onSubmit,
  submitCommand,
  validateCommand,
  children,
}: FormProps): ReactNode {
  const app = useApp();
  const generatedId = useId();
  const id = providedId ?? `form-${generatedId}`;
  const resolvedSubmitCommand = submitCommand ?? `${id}.submit`;
  const resolvedValidateCommand = validateCommand ?? `${id}.validate`;
  const controller = useMemo(
    () => providedController ?? new TerminalFormController(),
    [providedController],
  );
  useEffect(() => {
    const registrations = [
      app.commands.register({
        id: resolvedSubmitCommand,
        title: "Submit form",
        execute: ({ signal }) =>
          controller.submit(
            (values, submissionSignal) => onSubmit?.(values, submissionSignal),
            {
              signal,
              focus: (name) => app.focus.focus(name),
            },
          ),
      }),
      app.commands.register({
        id: resolvedValidateCommand,
        title: "Validate form",
        execute: ({ signal }) =>
          controller.validate("command", {
            signal,
            focus: (name) => app.focus.focus(name),
          }),
      }),
    ];
    return () => {
      for (const registration of registrations) {
        void registration.dispose();
      }
    };
  }, [
    app.commands,
    app.focus,
    controller,
    onSubmit,
    resolvedSubmitCommand,
    resolvedValidateCommand,
  ]);
  useEffect(
    () => () => {
      if (!providedController) controller.dispose();
    },
    [controller, providedController],
  );
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        role: "form" as const,
        label: id,
      }),
      [id],
    ),
  );
  return (
    <TerminalFormProvider controller={controller}>
      {children}
    </TerminalFormProvider>
  );
}

export function ValidationSummary(props: {
  readonly title?: string;
}): ReactNode {
  const theme = useTheme();
  const state = useTerminalFormSnapshot();
  if (state.errors.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text color={theme.colors.danger.foreground} bold>
        {props.title ?? "Please correct the following errors:"}
      </Text>
      {state.errors.map((error, index) => (
        <FieldErrorSemantic
          id={`validation-summary:${error.field}:${index}`}
          key={`${error.field}:${error.message}`}
          message={error.message}
        >
          <Text color={theme.colors.danger.foreground}>
            - {error.field}: {error.message}
          </Text>
        </FieldErrorSemantic>
      ))}
    </Box>
  );
}

export function Field({
  label,
  description,
  error,
  field,
  hint,
  required,
  children,
  slots,
  slotProps,
  ...props
}: FieldProps): ReactNode {
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const explicitErrors = typeof error === "string" ? [error] : (error ?? []);
  const errors = [...explicitErrors, ...(field?.errors ?? [])];
  const Root = slots?.root ?? Box;
  const Label = slots?.label ?? Text;
  const Description = slots?.description ?? Text;
  const Control = slots?.control ?? Box;
  const ErrorText = slots?.error ?? Text;
  const Hint = slots?.hint ?? Text;
  const state = { invalid: errors.length > 0, required: required ?? false };
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        testId: props.testId,
        role: props.role ?? ("form" as const),
        label,
        description,
        disabled: props.disabled,
        readOnly: props.readOnly,
      }),
      [
        description,
        id,
        label,
        props.disabled,
        props.readOnly,
        props.role,
        props.testId,
      ],
    ),
  );
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <Label bold {...resolveSlotProps(slotProps?.label, state, theme)}>
        {label}
        {required ? " *" : ""}
      </Label>
      {description ? (
        <Description
          dimColor
          {...resolveSlotProps(slotProps?.description, state, theme)}
        >
          {description}
        </Description>
      ) : null}
      <Control {...resolveSlotProps(slotProps?.control, state, theme)}>
        {children}
      </Control>
      {errors.map((message, index) => (
        <FieldErrorSemantic
          id={`${id}:error:${index}`}
          key={message}
          message={message}
        >
          <ErrorText
            color={theme.colors.danger.foreground}
            {...resolveSlotProps(slotProps?.error, state, theme)}
          >
            {message}
          </ErrorText>
        </FieldErrorSemantic>
      ))}
      {hint && errors.length === 0 ? (
        <Hint dimColor {...resolveSlotProps(slotProps?.hint, state, theme)}>
          {hint}
        </Hint>
      ) : null}
    </Root>
  );
}

function FieldErrorSemantic(props: {
  readonly id: string;
  readonly message: string;
  readonly children: ReactNode;
}): ReactNode {
  useSemanticNode(
    useMemo(
      () => ({
        key: props.id,
        id: props.id,
        role: "alert" as const,
        label: props.message,
      }),
      [props.id, props.message],
    ),
  );
  return props.children;
}

export const FieldLabel = Text;
export const FieldDescription = Text;
export const FieldError = Text;
export const FieldHint = Text;
export const FieldGroup = Box;
export const FieldSet = Box;

interface TextEditorProps extends CommonComponentProps {
  readonly field?: AdaptedTanStackField<string>;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void | Promise<void>;
  readonly onSubmit?: (value: string) => void | Promise<void>;
  readonly onBlur?: () => void | Promise<void>;
  readonly validators?: FieldValidators<string>;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly mask?: string;
  readonly autoFocus?: boolean;
  readonly focusOrder?: number;
  readonly maxLength?: number;
  readonly onArrowUp?: () => void | Promise<void>;
  readonly onArrowDown?: () => void | Promise<void>;
  readonly registerWithForm?: boolean;
}

function characters(value: string): string[] {
  return Array.from(value);
}

function TextEditor({
  value,
  defaultValue = "",
  onValueChange,
  onSubmit,
  onBlur,
  field: adaptedField,
  validators,
  placeholder,
  multiline = false,
  mask,
  autoFocus,
  focusOrder,
  maxLength,
  onArrowUp,
  onArrowDown,
  registerWithForm = true,
  disabled = false,
  readOnly = false,
  ...props
}: TextEditorProps): ReactNode {
  const app = useApp();
  const generated = useId();
  const id = props.id ?? generated;
  const label = props.label ?? id;
  const reportAsync = useRuntimeAsync();
  const terminalField = useTerminalField({
    name: id,
    initialValue: defaultValue,
    value: adaptedField?.value ?? value,
    onValueChange: async (next) => {
      adaptedField?.setValue(next);
      await onValueChange?.(next);
    },
    validators,
    disabled,
    readOnly,
    secret: Boolean(mask),
  });
  useRegisterTerminalField(terminalField, registerWithForm, adaptedField);
  const [cursor, setCursor] = useState(
    () => characters(terminalField.value).length,
  );
  const focusable = useMemo(
    () => ({
      id,
      disabled,
      hidden: false,
      order: focusOrder,
      role: "textbox",
      label,
    }),
    [disabled, focusOrder, id, label],
  );
  const { focused, focus } = useFocusable(focusable);
  const wasFocused = useRef(false);
  useEffect(() => {
    if (autoFocus) focus();
  }, [autoFocus, focus]);
  useEffect(() => {
    setCursor((position) =>
      Math.min(position, characters(terminalField.value).length),
    );
  }, [terminalField.value]);
  useEffect(() => {
    if (wasFocused.current && !focused) {
      reportAsync(
        terminalField
          .blur()
          .then(() => adaptedField?.blur())
          .then(() => onBlur?.()),
        "field-blur",
      );
    }
    wasFocused.current = focused;
  }, [adaptedField, focused, onBlur, reportAsync, terminalField]);
  const semantic = useMemo(
    () => ({
      key: id,
      id,
      testId: props.testId,
      role: "textbox" as const,
      label,
      description: props.description,
      disabled,
      readOnly,
      valueText: mask ? "[REDACTED]" : terminalField.value,
    }),
    [
      disabled,
      terminalField.value,
      id,
      label,
      mask,
      props.description,
      props.testId,
      readOnly,
    ],
  );
  useSemanticNode(semantic);
  useTerminalInput(
    async (input, key) => {
      if (key.upArrow && onArrowUp) {
        await onArrowUp();
        return true;
      }
      if (key.downArrow && onArrowDown) {
        await onArrowDown();
        return true;
      }
      const current = characters(terminalField.value);
      if (key.leftArrow) {
        setCursor((position) => Math.max(0, position - 1));
        return true;
      }
      if (key.rightArrow) {
        setCursor((position) => Math.min(current.length, position + 1));
        return true;
      }
      if (key.backspace || key.delete) {
        if (readOnly || disabled) return true;
        if (cursor === 0) return true;
        current.splice(cursor - 1, 1);
        setCursor(cursor - 1);
        await terminalField.setValue(current.join(""));
        return true;
      }
      if (key.return) {
        if (multiline && !key.ctrl && !key.meta) {
          if (readOnly || disabled) return true;
          current.splice(cursor, 0, "\n");
          setCursor(cursor + 1);
          await terminalField.setValue(current.join(""));
        } else {
          const state = await terminalField.validate("submit");
          if (state.valid) await onSubmit?.(terminalField.value);
        }
        return true;
      }
      if (
        !input ||
        key.ctrl ||
        key.meta ||
        key.escape ||
        key.tab ||
        readOnly ||
        disabled
      ) {
        return false;
      }
      const inserted = characters(input);
      if (
        maxLength !== undefined &&
        current.length + inserted.length > maxLength
      ) {
        return true;
      }
      current.splice(cursor, 0, ...inserted);
      setCursor(cursor + inserted.length);
      await terminalField.setValue(current.join(""));
      return true;
    },
    { enabled: focused, priority: 2_000 },
  );
  const rawDisplay =
    terminalField.value.length === 0 && !focused
      ? (placeholder ?? "")
      : mask
        ? mask.repeat(characters(terminalField.value).length)
        : terminalField.value;
  const display =
    app.mode === "interactive" && focused
      ? `${characters(rawDisplay).slice(0, cursor).join("")}${app.capabilities.unicode ? "▌" : "|"}${characters(rawDisplay).slice(cursor).join("")}`
      : rawDisplay;
  return (
    <Text
      color={
        terminalField.errors.length > 0 ||
        (adaptedField?.errors.length ?? 0) > 0
          ? app.theme.colors.danger.foreground
          : focused
            ? app.theme.colors.primary.foreground
            : undefined
      }
      dimColor={disabled || (terminalField.value.length === 0 && !focused)}
    >
      {display}
    </Text>
  );
}

export type TextInputProps = Omit<TextEditorProps, "multiline">;

export function TextInput(props: TextInputProps): ReactNode {
  return <TextEditor {...props} multiline={false} />;
}

export type TextAreaProps = Omit<TextEditorProps, "multiline" | "mask">;

export function TextArea(props: TextAreaProps): ReactNode {
  return <TextEditor {...props} multiline />;
}

export interface NumberInputProps
  extends Omit<
    TextInputProps,
    | "value"
    | "defaultValue"
    | "onValueChange"
    | "validators"
    | "field"
    | "registerWithForm"
  > {
  readonly field?: AdaptedTanStackField<number>;
  readonly validators?: FieldValidators<number>;
  readonly value?: number;
  readonly defaultValue?: number;
  readonly onValueChange?: (value: number) => void | Promise<void>;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export function NumberInput({
  value,
  defaultValue = 0,
  onValueChange,
  field: adaptedField,
  validators,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  ...props
}: NumberInputProps): ReactNode {
  const generated = useId();
  const id = props.id ?? generated;
  const field = useTerminalField({
    name: id,
    initialValue: defaultValue,
    value: adaptedField?.value ?? value,
    onValueChange: async (next) => {
      adaptedField?.setValue(next);
      await onValueChange?.(next);
    },
    validators,
    disabled: props.disabled,
    readOnly: props.readOnly,
  });
  useRegisterTerminalField(field, true, adaptedField);
  const current = field.value;
  const [draft, setDraft] = useState(String(current));
  useEffect(() => {
    setDraft(String(current));
  }, [current]);
  const commit = async (candidate: number) => {
    if (!Number.isFinite(candidate)) return;
    const next = Math.min(max, Math.max(min, candidate));
    setDraft(String(next));
    await field.setValue(next);
  };
  return (
    <TextInput
      {...props}
      id={id}
      value={draft}
      registerWithForm={false}
      onBlur={async () => {
        await field.blur();
        adaptedField?.blur();
        await props.onBlur?.();
      }}
      onValueChange={async (next) => {
        setDraft(next);
        if (next.trim() === "") return;
        const parsed = Number(next);
        if (Number.isFinite(parsed)) await commit(parsed);
      }}
      onArrowUp={() => commit(current + step)}
      onArrowDown={() => commit(current - step)}
    />
  );
}

interface ToggleProps extends CommonComponentProps {
  readonly field?: AdaptedTanStackField<boolean>;
  readonly validators?: FieldValidators<boolean>;
  readonly onBlur?: () => void | Promise<void>;
  readonly checked?: boolean;
  readonly defaultChecked?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void | Promise<void>;
  readonly children?: ReactNode;
  readonly autoFocus?: boolean;
  readonly focusOrder?: number;
}

function ToggleControl({
  checked,
  field: adaptedField,
  validators,
  onBlur,
  defaultChecked = false,
  onCheckedChange,
  children,
  autoFocus,
  focusOrder,
  disabled = false,
  readOnly = false,
  role,
  ...props
}: ToggleProps & { readonly role: "checkbox" | "switch" }): ReactNode {
  const app = useApp();
  const generated = useId();
  const id = props.id ?? generated;
  const field = useTerminalField({
    name: id,
    initialValue: defaultChecked,
    value: adaptedField?.value ?? checked,
    onValueChange: async (next) => {
      adaptedField?.setValue(next);
      await onCheckedChange?.(next);
    },
    validators,
    disabled,
    readOnly,
  });
  useRegisterTerminalField(field, true, adaptedField);
  const selected = field.value;
  const label = props.label ?? String(children ?? id);
  const focusable = useMemo(
    () => ({
      id,
      disabled,
      hidden: false,
      order: focusOrder,
      role,
      label,
    }),
    [disabled, focusOrder, id, label, role],
  );
  const { focused, focus } = useFocusable(focusable);
  useFieldBlur(focused, field, adaptedField, onBlur);
  useEffect(() => {
    if (autoFocus) focus();
  }, [autoFocus, focus]);
  const toggle = async () => {
    if (disabled || readOnly) return;
    const next = !selected;
    await field.setValue(next);
  };
  useTerminalInput(
    async (input, key) => {
      if (key.return || input === " ") {
        await toggle();
        return true;
      }
      return false;
    },
    { enabled: focused, priority: 2_000 },
  );
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        testId: props.testId,
        role,
        label,
        description: props.description,
        disabled,
        readOnly,
        checked: selected,
      }),
      [
        disabled,
        id,
        label,
        props.description,
        props.testId,
        readOnly,
        role,
        selected,
      ],
    ),
  );
  const on = app.capabilities.unicode ? "●" : "x";
  const off = app.capabilities.unicode ? "○" : " ";
  return (
    <Text
      bold={focused}
      dimColor={disabled}
      color={selected ? app.theme.colors.primary.foreground : undefined}
    >
      {role === "switch"
        ? `[${selected ? "ON" : "OFF"}]`
        : `[${selected ? on : off}]`}{" "}
      {children}
    </Text>
  );
}

export function Checkbox(props: ToggleProps): ReactNode {
  return <ToggleControl {...props} role="checkbox" />;
}

export function Switch(props: ToggleProps): ReactNode {
  return <ToggleControl {...props} role="switch" />;
}

export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface RadioGroupProps<T extends string = string>
  extends CommonComponentProps {
  readonly options: readonly SelectOption<T>[];
  readonly value?: T;
  readonly defaultValue?: T;
  readonly onValueChange?: (value: T) => void | Promise<void>;
  readonly field?: AdaptedTanStackField<T | undefined>;
  readonly validators?: FieldValidators<T | undefined>;
  readonly onBlur?: () => void | Promise<void>;
  readonly orientation?: "horizontal" | "vertical";
  readonly autoFocus?: boolean;
}

function SemanticOption(props: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly role?: "option" | "radio";
}): null {
  useSemanticNode(
    useMemo(
      () => ({
        key: props.id,
        id: props.id,
        role: props.role ?? ("option" as const),
        label: props.label,
        description: props.description,
        selected: props.selected,
        checked: props.role === "radio" ? props.selected : undefined,
        disabled: props.disabled,
      }),
      [props],
    ),
  );
  return null;
}

export function RadioGroup<T extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  field: adaptedField,
  validators,
  onBlur,
  orientation = "vertical",
  autoFocus,
  disabled = false,
  readOnly = false,
  ...props
}: RadioGroupProps<T>): ReactNode {
  const app = useApp();
  const generated = useId();
  const id = props.id ?? generated;
  const field = useTerminalField<T | undefined>({
    name: id,
    initialValue: defaultValue,
    value: adaptedField?.value ?? value,
    onValueChange: async (next) => {
      if (next !== undefined) {
        adaptedField?.setValue(next);
        await onValueChange?.(next);
      }
    },
    validators,
    disabled,
    readOnly,
  });
  useRegisterTerminalField(field, true, adaptedField);
  const selected = field.value;
  const initial = Math.max(
    0,
    options.findIndex((option) => option.value === selected),
  );
  const [active, setActive] = useState(initial);
  const activeRef = useRef(initial);
  const setActiveIndex = (index: number) => {
    activeRef.current = index;
    setActive(index);
  };
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: false,
        role: "radio",
        label: props.label ?? id,
      }),
      [disabled, id, props.label],
    ),
  );
  useFieldBlur(focused, field, adaptedField, onBlur);
  useEffect(() => {
    if (autoFocus) focus();
  }, [autoFocus, focus]);
  useEffect(() => {
    const index = Math.max(
      0,
      options.findIndex((option) => option.value === selected),
    );
    activeRef.current = index;
    setActive(index);
  }, [options, selected]);
  const move = (delta: number) => {
    if (options.length === 0) return;
    let next = activeRef.current;
    for (let index = 0; index < options.length; index += 1) {
      next = (next + delta + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };
  const select = async () => {
    const option = options[activeRef.current];
    if (!option || option.disabled || disabled || readOnly) return;
    await field.setValue(option.value);
  };
  useTerminalInput(
    async (input, key) => {
      if (key.upArrow || key.leftArrow || input === "k") {
        move(-1);
        return true;
      }
      if (key.downArrow || key.rightArrow || input === "j") {
        move(1);
        return true;
      }
      if (key.return || input === " ") {
        await select();
        return true;
      }
      return false;
    },
    { enabled: focused, priority: 2_000 },
  );
  return (
    <Box flexDirection={orientation === "horizontal" ? "row" : "column"}>
      {options.map((option, index) => (
        <Text
          key={option.value}
          bold={focused && index === active}
          dimColor={option.disabled}
          color={
            option.value === selected
              ? app.theme.colors.primary.foreground
              : undefined
          }
        >
          <SemanticOption
            id={`${id}:${option.value}`}
            label={option.label}
            description={option.description}
            selected={option.value === selected}
            disabled={option.disabled}
            role="radio"
          />
          {option.value === selected
            ? app.capabilities.unicode
              ? "●"
              : "(*)"
            : app.capabilities.unicode
              ? "○"
              : "( )"}{" "}
          {option.label}
          {orientation === "horizontal" ? "  " : ""}
        </Text>
      ))}
    </Box>
  );
}

interface SelectionProps<T extends string = string>
  extends CommonComponentProps,
    SlottedComponentProps<{
      root: BoxProps;
      indicator: TextProps;
      list: BoxProps;
      option: TextProps;
      empty: TextProps;
    }> {
  readonly options: readonly SelectOption<T>[];
  readonly placeholder?: string;
  readonly searchable?: boolean;
  readonly autoFocus?: boolean;
}

export interface SelectProps<T extends string = string>
  extends SelectionProps<T> {
  readonly value?: T;
  readonly defaultValue?: T;
  readonly onValueChange?: (value: T) => void | Promise<void>;
  readonly field?: AdaptedTanStackField<T | undefined>;
  readonly validators?: FieldValidators<T | undefined>;
  readonly onBlur?: () => void | Promise<void>;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void | Promise<void>;
}

function filteredOptions<T extends string>(
  options: readonly SelectOption<T>[],
  query: string,
): readonly SelectOption<T>[] {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized
    ? options.filter(
        (option) =>
          option.label.toLocaleLowerCase().includes(normalized) ||
          option.value.toLocaleLowerCase().includes(normalized),
      )
    : options;
}

export function Select<T extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  field: adaptedField,
  validators,
  onBlur,
  open,
  defaultOpen = false,
  onOpenChange,
  placeholder = "Select…",
  searchable = false,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  ...props
}: SelectProps<T>): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const field = useTerminalField<T | undefined>({
    name: id,
    initialValue: defaultValue,
    value: adaptedField?.value ?? value,
    onValueChange: async (next) => {
      if (next !== undefined) {
        adaptedField?.setValue(next);
        await onValueChange?.(next);
      }
    },
    validators,
    disabled,
    readOnly,
  });
  useRegisterTerminalField(field, true, adaptedField);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const selected = field.value;
  const expanded = open ?? internalOpen;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const visible = useMemo(
    () => filteredOptions(options, searchable ? query : ""),
    [options, query, searchable],
  );
  const selectedIndex = Math.max(
    0,
    visible.findIndex((option) => option.value === selected),
  );
  const [active, setActive] = useState(selectedIndex);
  const activeRef = useRef(selectedIndex);
  const setActiveIndex = (index: number) => {
    activeRef.current = index;
    setActive(index);
  };
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: false,
        role: "listbox",
        label: props.label ?? id,
      }),
      [disabled, id, props.label],
    ),
  );
  useFieldBlur(focused, field, adaptedField, onBlur);
  useEffect(() => {
    if (autoFocus) focus();
  }, [autoFocus, focus]);
  useEffect(() => {
    const index = Math.max(
      0,
      visible.findIndex((option) => option.value === selected),
    );
    activeRef.current = index;
    setActive(index);
  }, [selected, visible]);
  const setOpen = async (next: boolean) => {
    expandedRef.current = next;
    if (open === undefined) setInternalOpen(next);
    if (!next) setQuery("");
    await onOpenChange?.(next);
  };
  const move = (delta: number) => {
    if (visible.length === 0) return;
    let next = activeRef.current;
    for (let index = 0; index < visible.length; index += 1) {
      next = (next + delta + visible.length) % visible.length;
      if (!visible[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };
  const choose = async () => {
    const option = visible[activeRef.current];
    if (!option || option.disabled || readOnly || disabled) return;
    await field.setValue(option.value);
    await setOpen(false);
  };
  useTerminalInput(
    async (input, key) => {
      if (key.escape && expandedRef.current) {
        await setOpen(false);
        return true;
      }
      if (key.return || input === " ") {
        if (!expandedRef.current) await setOpen(true);
        else await choose();
        return true;
      }
      if (key.upArrow || input === "k") {
        if (!expandedRef.current) await setOpen(true);
        else move(-1);
        return true;
      }
      if (key.downArrow || input === "j") {
        if (!expandedRef.current) await setOpen(true);
        else move(1);
        return true;
      }
      if (expandedRef.current && searchable && (key.backspace || key.delete)) {
        setQuery((current) => current.slice(0, -1));
        setActiveIndex(0);
        return true;
      }
      if (
        expandedRef.current &&
        searchable &&
        input &&
        !key.ctrl &&
        !key.meta &&
        !key.tab
      ) {
        setQuery((current) => current + input);
        setActiveIndex(0);
        return true;
      }
      return false;
    },
    { enabled: focused, priority: 2_000 },
  );
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        testId: props.testId,
        role: "listbox" as const,
        label: props.label ?? id,
        description: props.description,
        disabled,
        readOnly,
        expanded,
        valueText: selected,
      }),
      [
        disabled,
        expanded,
        id,
        props.description,
        props.label,
        props.testId,
        readOnly,
        selected,
      ],
    ),
  );
  const Root = slots?.root ?? Box;
  const Indicator = slots?.indicator ?? Text;
  const List = slots?.list ?? Box;
  const Option = slots?.option ?? Text;
  const Empty = slots?.empty ?? Text;
  const selectedOption = options.find((option) => option.value === selected);
  const state = { open: expanded, focused, disabled };
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <Indicator
        bold={focused}
        color={focused ? theme.colors.primary.foreground : undefined}
        {...resolveSlotProps(slotProps?.indicator, state, theme)}
      >
        {expanded
          ? app.capabilities.unicode
            ? "▼"
            : "v"
          : app.capabilities.unicode
            ? "▶"
            : ">"}{" "}
        {selectedOption?.label ?? placeholder}
        {searchable && expanded && query ? ` /${query}` : ""}
      </Indicator>
      {expanded ? (
        <List
          flexDirection="column"
          {...resolveSlotProps(slotProps?.list, state, theme)}
        >
          {visible.length === 0 ? (
            <Empty
              dimColor
              {...resolveSlotProps(slotProps?.empty, state, theme)}
            >
              No options
            </Empty>
          ) : (
            visible.map((option, index) => {
              const optionState = {
                active: index === active,
                selected: option.value === selected,
                disabled: option.disabled ?? false,
              };
              return (
                <Option
                  key={option.value}
                  bold={optionState.active}
                  dimColor={option.disabled}
                  color={
                    optionState.selected
                      ? theme.colors.primary.foreground
                      : undefined
                  }
                  {...resolveSlotProps(slotProps?.option, optionState, theme)}
                >
                  <SemanticOption
                    id={`${id}:${option.value}`}
                    label={option.label}
                    description={option.description}
                    selected={optionState.selected}
                    disabled={option.disabled}
                  />
                  {optionState.active ? ">" : " "}{" "}
                  {optionState.selected ? "*" : " "} {option.label}
                </Option>
              );
            })
          )}
        </List>
      ) : null}
    </Root>
  );
}

export interface MultiSelectProps<T extends string = string>
  extends SelectionProps<T> {
  readonly value?: readonly T[];
  readonly defaultValue?: readonly T[];
  readonly onValueChange?: (value: readonly T[]) => void | Promise<void>;
  readonly field?: AdaptedTanStackField<readonly T[]>;
  readonly validators?: FieldValidators<readonly T[]>;
  readonly onBlur?: () => void | Promise<void>;
  readonly maxSelected?: number;
}

export function MultiSelect<T extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  field: adaptedField,
  validators,
  onBlur,
  maxSelected,
  placeholder = "Select…",
  autoFocus,
  disabled = false,
  readOnly = false,
  ...props
}: MultiSelectProps<T>): ReactNode {
  const app = useApp();
  const generated = useId();
  const id = props.id ?? generated;
  const initialValue = useMemo<readonly T[]>(
    () => defaultValue ?? Object.freeze([]),
    [defaultValue],
  );
  const field = useTerminalField<readonly T[]>({
    name: id,
    initialValue,
    value: adaptedField?.value ?? value,
    onValueChange: async (next) => {
      adaptedField?.setValue(next);
      await onValueChange?.(next);
    },
    validators,
    disabled,
    readOnly,
  });
  useRegisterTerminalField(field, true, adaptedField);
  const selected = field.value;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const setActiveIndex = (index: number) => {
    activeRef.current = index;
    setActive(index);
  };
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled,
        hidden: false,
        role: "listbox",
        label: props.label ?? id,
      }),
      [disabled, id, props.label],
    ),
  );
  useFieldBlur(focused, field, adaptedField, onBlur);
  useEffect(() => {
    if (autoFocus) focus();
  }, [autoFocus, focus]);
  const toggle = async () => {
    const option = options[activeRef.current];
    if (!option || option.disabled || disabled || readOnly) return;
    const current = selectedRef.current;
    const contains = current.includes(option.value);
    if (
      !contains &&
      maxSelected !== undefined &&
      current.length >= maxSelected
    ) {
      return;
    }
    const next = contains
      ? current.filter((item) => item !== option.value)
      : [...current, option.value];
    selectedRef.current = next;
    await field.setValue(Object.freeze(next));
  };
  useTerminalInput(
    async (input, key) => {
      if (key.upArrow || input === "k") {
        setActiveIndex(
          (activeRef.current - 1 + options.length) % options.length,
        );
        return true;
      }
      if (key.downArrow || input === "j") {
        setActiveIndex((activeRef.current + 1) % options.length);
        return true;
      }
      if (key.return || input === " ") {
        await toggle();
        return true;
      }
      return false;
    },
    { enabled: focused && options.length > 0, priority: 2_000 },
  );
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        testId: props.testId,
        role: "listbox" as const,
        label: props.label ?? id,
        description: props.description,
        disabled,
        readOnly,
        valueText: selected.join(","),
      }),
      [
        disabled,
        id,
        props.description,
        props.label,
        props.testId,
        readOnly,
        selected,
      ],
    ),
  );
  return (
    <Box flexDirection="column">
      <Text bold={focused}>
        {selected.length > 0
          ? options
              .filter((option) => selected.includes(option.value))
              .map((option) => option.label)
              .join(", ")
          : placeholder}
      </Text>
      {options.map((option, index) => {
        const checked = selected.includes(option.value);
        return (
          <Text
            key={option.value}
            bold={focused && index === active}
            dimColor={option.disabled}
            color={checked ? app.theme.colors.primary.foreground : undefined}
          >
            <SemanticOption
              id={`${id}:${option.value}`}
              label={option.label}
              description={option.description}
              selected={checked}
              disabled={option.disabled}
            />
            {focused && index === active ? ">" : " "} [{checked ? "x" : " "}]{" "}
            {option.label}
          </Text>
        );
      })}
    </Box>
  );
}

export interface AutocompleteProps<T extends string = string>
  extends Omit<SelectionProps<T>, "searchable"> {
  readonly field?: AdaptedTanStackField<string>;
  readonly validators?: FieldValidators<string>;
  readonly onBlur?: () => void | Promise<void>;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void | Promise<void>;
  readonly onOptionSelect?: (option: SelectOption<T>) => void | Promise<void>;
}

export function Autocomplete<T extends string>({
  options,
  value,
  defaultValue = "",
  onValueChange,
  field,
  validators,
  onBlur,
  onOptionSelect,
  placeholder = "Search…",
  autoFocus,
  disabled,
  readOnly,
  ...props
}: AutocompleteProps<T>): ReactNode {
  const app = useApp();
  const generated = useId();
  const id = props.id ?? generated;
  const [internal, setInternal] = useState(defaultValue);
  const query = field?.value ?? value ?? internal;
  const visible = filteredOptions(options, query);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const setActiveIndex = (index: number) => {
    activeRef.current = index;
    setActive(index);
  };
  useTerminalInput(
    async (_input, key) => {
      if (app.focus.focusedId !== id) return false;
      if (key.upArrow) {
        setActiveIndex(Math.max(0, activeRef.current - 1));
        return true;
      }
      if (key.downArrow) {
        setActiveIndex(Math.min(visible.length - 1, activeRef.current + 1));
        return true;
      }
      if (key.return) {
        const option = visible[activeRef.current];
        if (!option || option.disabled) return true;
        if (value === undefined) setInternal(option.label);
        field?.setValue(option.label);
        await onValueChange?.(option.label);
        await onOptionSelect?.(option);
        return true;
      }
      return false;
    },
    { enabled: !disabled && !readOnly, priority: 2_100 },
  );
  return (
    <Box flexDirection="column">
      <TextInput
        id={id}
        label={props.label}
        description={props.description}
        testId={props.testId}
        value={query}
        field={field}
        validators={validators}
        onBlur={onBlur}
        onValueChange={async (next) => {
          if (value === undefined) setInternal(next);
          setActiveIndex(0);
          await onValueChange?.(next);
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        readOnly={readOnly}
      />
      {query
        ? visible.map((option, index) => (
            <Text
              key={option.value}
              bold={index === active}
              dimColor={option.disabled}
            >
              <SemanticOption
                id={`${id}:${option.value}`}
                label={option.label}
                description={option.description}
                selected={index === active}
                disabled={option.disabled}
              />
              {index === active ? ">" : " "} {option.label}
            </Text>
          ))
        : null}
    </Box>
  );
}
