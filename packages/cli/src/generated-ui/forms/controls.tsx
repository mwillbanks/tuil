import { useApp } from "@mwillbanks/tuil";
import {
  type EditorClipboardAdapter,
  type EditorPosition,
  type EditorProvider,
  type EditorProviderOptions,
  type EditorSession,
  position,
  selection,
} from "@mwillbanks/tuil-editor";
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
  Text as SemanticText,
  usePointerEvent,
  useSemanticNode,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import { Box, type BoxProps, type Key, Text, type TextProps } from "ink";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
  readonly children?: ReactNode;
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

function useListboxFieldFocus<T>(options: {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly autoFocus: boolean | undefined;
  readonly field: TerminalFieldBinding<T>;
  readonly adaptedField: AdaptedTanStackField<T> | undefined;
  readonly onBlur: (() => void | Promise<void>) | undefined;
}): { readonly focused: boolean; readonly focus: () => void } {
  const focusable = useMemo(
    () => ({
      id: options.id,
      disabled: options.disabled,
      hidden: false,
      role: "listbox",
      label: options.label,
    }),
    [options.disabled, options.id, options.label],
  );
  const { focused, focus } = useFocusable(focusable);
  useFieldBlur(focused, options.field, options.adaptedField, options.onBlur);
  useEffect(() => {
    if (options.autoFocus) focus();
  }, [focus, options.autoFocus]);
  return { focused, focus };
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

export const FieldLabel: typeof Text = Text;
export const FieldDescription: typeof Text = Text;
export const FieldError: typeof Text = Text;
export const FieldHint: typeof Text = Text;
export const FieldGroup: typeof Box = Box;
export const FieldSet: typeof Box = Box;

interface TextEditorProps extends CommonComponentProps {
  readonly session?: EditorSession;
  readonly editorProvider?: EditorProvider;
  readonly clipboard?: EditorClipboardAdapter;
  readonly documentType?: string;
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

function documentEnd(value: string): {
  readonly line: number;
  readonly column: number;
} {
  const lines = value.split("\n");
  return { line: lines.length - 1, column: lines.at(-1)?.length ?? 0 };
}

function replaceEditorDocument(
  session: EditorSession,
  current: string,
  value: string,
): void {
  if (current === value) return;
  session.dispatch({
    changes: [
      {
        range: {
          anchor: { line: 0, column: 0 },
          head: documentEnd(current),
        },
        insert: value,
      },
    ],
  });
}

interface TextInputState {
  readonly session: EditorSession;
  readonly value: () => string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly multiline: boolean;
  readonly maxLength?: number;
  readonly onArrowUp?: () => void | Promise<void>;
  readonly onArrowDown?: () => void | Promise<void>;
  readonly onSubmit?: (value: string) => void | Promise<void>;
  readonly validate: () => Promise<boolean>;
}

function adjacentEditorPosition(
  cursor: EditorPosition,
  lines: readonly string[],
  direction: -1 | 1,
): EditorPosition {
  if (direction < 0 && cursor.column === 0 && cursor.line > 0) {
    return position(
      cursor.line - 1,
      characters(lines[cursor.line - 1] ?? "").length,
    );
  }
  if (
    direction > 0 &&
    cursor.column >= characters(lines[cursor.line] ?? "").length &&
    cursor.line < lines.length - 1
  ) {
    return position(cursor.line + 1, 0);
  }
  return position(cursor.line, cursor.column + direction);
}

function moveEditorCursor(session: EditorSession, direction: -1 | 1): void {
  const cursor = session.snapshot().selections[0]?.head ?? position(0, 0);
  const next = adjacentEditorPosition(
    cursor,
    session.serialize().split("\n"),
    direction,
  );
  session.dispatch({ selections: [selection(next)], addToHistory: false });
}

async function handleEditorNavigation(
  state: TextInputState,
  key: Key,
): Promise<boolean> {
  if (key.upArrow && state.onArrowUp) {
    await state.onArrowUp();
    return true;
  }
  if (key.downArrow && state.onArrowDown) {
    await state.onArrowDown();
    return true;
  }
  if (key.leftArrow) {
    moveEditorCursor(state.session, -1);
    return true;
  }
  if (key.rightArrow) {
    moveEditorCursor(state.session, 1);
    return true;
  }
  return false;
}

function removeBeforeCursor(state: TextInputState): void {
  const cursor = state.session.snapshot().selections[0]?.head ?? position(0, 0);
  const lines = state.session.serialize().split("\n");
  const anchor =
    cursor.column > 0
      ? position(cursor.line, cursor.column - 1)
      : cursor.line > 0
        ? position(
            cursor.line - 1,
            characters(lines[cursor.line - 1] ?? "").length,
          )
        : cursor;
  state.session.dispatch({
    changes: [{ range: { anchor, head: cursor }, insert: "" }],
  });
}

function handleEditorRemoval(state: TextInputState, key: Key): boolean {
  if (!key.backspace && !key.delete) return false;
  if (!state.readOnly && !state.disabled) removeBeforeCursor(state);
  return true;
}

async function handleEditorReturn(
  state: TextInputState,
  key: Key,
): Promise<boolean> {
  if (!key.return) return false;
  if (state.multiline && !key.ctrl && !key.meta) {
    insertEditorNewline(state);
    return true;
  }
  if (await state.validate()) {
    await state.onSubmit?.(state.value());
  }
  return true;
}

function insertEditorNewline(state: TextInputState): void {
  if (state.readOnly || state.disabled) return;
  const cursor = state.session.snapshot().selections[0]?.head ?? position(0, 0);
  state.session.dispatch({
    changes: [{ range: { anchor: cursor, head: cursor }, insert: "\n" }],
  });
}

function rejectsTextInput(
  input: string,
  key: Key,
  state: TextInputState,
): boolean {
  return (
    !input ||
    key.ctrl ||
    key.meta ||
    key.escape ||
    key.tab ||
    state.readOnly ||
    state.disabled
  );
}

async function handleTextInput(
  input: string,
  key: Key,
  state: TextInputState,
): Promise<boolean> {
  const keyName = editorKeyName(input, key);
  if (await handleEditorControlInput(keyName, key, state)) return true;
  if (rejectsTextInput(input, key, state)) return false;
  if (exceedsEditorLength(input, state)) return true;
  const cursor = state.session.snapshot().selections[0]?.head ?? position(0, 0);
  state.session.dispatch({
    changes: [{ range: { anchor: cursor, head: cursor }, insert: input }],
  });
  return true;
}

async function handleEditorControlInput(
  keyName: string,
  key: Key,
  state: TextInputState,
): Promise<boolean> {
  if (state.session.key?.(keyName)) return true;
  if (await handleEditorNavigation(state, key)) return true;
  if (handleEditorRemoval(state, key)) return true;
  return handleEditorReturn(state, key);
}

function editorKeyName(input: string, key: Key): string {
  const entries: readonly [boolean | undefined, string][] = [
    [key.escape, "escape"],
    [key.return, "enter"],
    [key.backspace || key.delete, "backspace"],
    [key.leftArrow, "left"],
    [key.rightArrow, "right"],
    [key.upArrow, "up"],
    [key.downArrow, "down"],
  ];
  return entries.find(([active]) => active)?.[1] ?? input;
}

function exceedsEditorLength(input: string, state: TextInputState): boolean {
  if (state.maxLength === undefined) return false;
  return (
    characters(state.value()).length + characters(input).length >
    state.maxLength
  );
}

function textEditorDisplay(
  value: string,
  options: {
    readonly placeholder?: string;
    readonly mask?: string;
    readonly focused: boolean;
    readonly interactive: boolean;
    readonly unicode: boolean;
    readonly cursor: number;
  },
): string {
  const raw =
    value.length === 0 && !options.focused
      ? (options.placeholder ?? "")
      : options.mask
        ? options.mask.repeat(characters(value).length)
        : value;
  if (!options.interactive || !options.focused) return raw;
  const units = characters(raw);
  const cursor = options.unicode ? "▌" : "|";
  return `${units.slice(0, options.cursor).join("")}${cursor}${units.slice(options.cursor).join("")}`;
}

interface EditorSessionBindingOptions {
  readonly providedSession?: EditorSession;
  readonly provider?: EditorProvider;
  readonly clipboard?: EditorClipboardAdapter;
  readonly id: string;
  readonly documentType: string;
  readonly field: TerminalFieldBinding<string>;
  readonly readOnly: boolean;
  readonly masked: boolean;
  readonly reportAsync: (work: Promise<unknown>, phase: string) => void;
  readonly createSession: (options: EditorProviderOptions) => EditorSession;
}

function useEditorSessionBinding(options: EditorSessionBindingOptions): {
  readonly editor: EditorSession;
  readonly snapshot: ReturnType<EditorSession["snapshot"]>;
  readonly value: () => string;
} {
  const fieldRef = useRef(options.field);
  const applyingControlledValue = useRef(false);
  useLayoutEffect(() => {
    fieldRef.current = options.field;
  }, [options.field]);
  const valueRef = useRef(options.field.value);
  const synchronizeValue = useCallback(
    (next: string) => {
      valueRef.current = next;
      if (applyingControlledValue.current) return;
      options.reportAsync(
        fieldRef.current.setValue(next),
        "editor-session-change",
      );
    },
    [options.reportAsync],
  );
  const [internalEditor] = useState<EditorSession | undefined>(() => {
    if (options.providedSession) return undefined;
    const providerOptions = {
      id: options.id,
      documentType: options.documentType,
      value: options.field.value,
      readOnly: options.readOnly,
      masked: options.masked,
      clipboard: options.clipboard,
      onDocumentChange: synchronizeValue,
    };
    return options.provider
      ? options.provider.create(providerOptions)
      : options.createSession(providerOptions);
  });
  const editor = options.providedSession ?? internalEditor;
  if (!editor) throw new Error("Text editor session creation failed");
  const [snapshot, setSnapshot] = useState(() => editor.snapshot());
  useEffect(() => {
    if (internalEditor) void internalEditor.execute("cursor-end");
  }, [internalEditor]);

  useEffect(() => {
    applyingControlledValue.current = true;
    try {
      replaceEditorDocument(editor, valueRef.current, options.field.value);
      valueRef.current = options.field.value;
    } finally {
      applyingControlledValue.current = false;
    }
  }, [editor, options.field.value]);
  useEffect(
    () => () => {
      internalEditor?.dispose();
    },
    [internalEditor],
  );
  useEffect(
    () =>
      editor.subscribe((next) => {
        setSnapshot(next);
        if (options.masked) return;
        const value = editor.serialize();
        if (value !== valueRef.current) synchronizeValue(value);
      }),
    [editor, options.masked, synchronizeValue],
  );

  return { editor, snapshot, value: () => valueRef.current };
}

function editorCursorOffset(
  editor: EditorSession,
  snapshot: ReturnType<EditorSession["snapshot"]>,
): number {
  const cursor = snapshot.selections[0]?.head;
  if (!cursor) return 0;
  return (
    editor
      .serialize()
      .split("\n")
      .slice(0, cursor.line)
      .reduce((sum, line) => sum + characters(line).length + 1, 0) +
    cursor.column
  );
}

interface TextEditorViewModel {
  readonly id: string;
  readonly testId?: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly masked: boolean;
  readonly value: string;
  readonly display: string;
  readonly focused: boolean;
  readonly hasErrors: boolean;
  readonly isPlaceholder: boolean;
  readonly primaryColor: string;
  readonly dangerColor: string;
}

function TextEditorSemanticView({
  model,
}: {
  readonly model: TextEditorViewModel;
}): ReactNode {
  const color = model.hasErrors
    ? model.dangerColor
    : model.focused
      ? model.primaryColor
      : undefined;
  return (
    <SemanticText
      id={model.id}
      testId={model.testId}
      role="textbox"
      label={model.label}
      description={model.description}
      disabled={model.disabled}
      readOnly={model.readOnly}
      valueText={model.masked ? "[REDACTED]" : model.value}
      color={color}
      dimColor={model.disabled || model.isPlaceholder}
    >
      {model.display}
    </SemanticText>
  );
}

function editorIdentity(
  props: Pick<TextEditorProps, "id" | "label">,
  generated: string,
): { readonly id: string; readonly label: string } {
  const id = props.id ?? generated;
  return { id, label: props.label ?? id };
}

function controlledEditorValue(
  field: AdaptedTanStackField<string> | undefined,
  value: string | undefined,
): string | undefined {
  return field?.value ?? value;
}

function editorHasErrors(
  field: TerminalFieldBinding<string>,
  adaptedField: AdaptedTanStackField<string> | undefined,
): boolean {
  return field.errors.length > 0 || (adaptedField?.errors.length ?? 0) > 0;
}

function useTextEditorFieldBinding(options: {
  readonly id: string;
  readonly defaultValue: string;
  readonly value?: string;
  readonly onValueChange?: (value: string) => void | Promise<void>;
  readonly adaptedField?: AdaptedTanStackField<string>;
  readonly validators?: FieldValidators<string>;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly masked: boolean;
  readonly registerWithForm: boolean;
}): {
  readonly field: TerminalFieldBinding<string>;
  readonly reportAsync: ReturnType<typeof useRuntimeAsync>;
} {
  const reportAsync = useRuntimeAsync();
  const handleValueChange = useCallback(
    async (next: string) => {
      options.adaptedField?.setValue(next);
      await options.onValueChange?.(next);
    },
    [options.adaptedField, options.onValueChange],
  );
  const fieldOptions = useMemo(
    () => ({
      name: options.id,
      initialValue: options.defaultValue,
      value: controlledEditorValue(options.adaptedField, options.value),
      onValueChange: handleValueChange,
      validators: options.validators,
      disabled: options.disabled,
      readOnly: options.readOnly,
      secret: options.masked,
    }),
    [
      handleValueChange,
      options.adaptedField,
      options.defaultValue,
      options.disabled,
      options.id,
      options.masked,
      options.readOnly,
      options.validators,
      options.value,
    ],
  );
  const field = useTerminalField(fieldOptions);
  useRegisterTerminalField(
    field,
    options.registerWithForm,
    options.adaptedField,
  );
  return { field, reportAsync };
}

function useTextEditorInteraction(options: {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly autoFocus?: boolean;
  readonly focusOrder?: number;
  readonly multiline: boolean;
  readonly maxLength?: number;
  readonly onArrowUp?: () => void | Promise<void>;
  readonly onArrowDown?: () => void | Promise<void>;
  readonly onSubmit?: (value: string) => void | Promise<void>;
  readonly onBlur?: () => void | Promise<void>;
  readonly adaptedField?: AdaptedTanStackField<string>;
  readonly field: TerminalFieldBinding<string>;
  readonly editor: EditorSession;
  readonly value: () => string;
}): boolean {
  const focusable = useMemo(
    () => ({
      id: options.id,
      disabled: options.disabled,
      hidden: false,
      order: options.focusOrder,
      role: "textbox",
      label: options.label,
    }),
    [options.disabled, options.focusOrder, options.id, options.label],
  );
  const { focused, focus } = useFocusable(focusable);
  usePointerEvent(options.id, "click", focus, {
    enabled: !options.disabled,
  });
  useEffect(() => {
    if (options.autoFocus) focus();
  }, [focus, options.autoFocus]);
  useFieldBlur(focused, options.field, options.adaptedField, options.onBlur);
  useTerminalInput(
    (input, key) =>
      handleTextInput(input, key, {
        session: options.editor,
        value: options.value,
        disabled: options.disabled,
        readOnly: options.readOnly,
        multiline: options.multiline,
        maxLength: options.maxLength,
        onArrowUp: options.onArrowUp,
        onArrowDown: options.onArrowDown,
        onSubmit: options.onSubmit,
        validate: async () => (await options.field.validate("submit")).valid,
      }),
    { enabled: focused, priority: 2_000 },
  );
  return focused;
}

function TextEditorControl({
  options,
}: {
  readonly options: TextEditorProps;
}): ReactNode {
  const {
    session: providedSession,
    editorProvider,
    clipboard,
    documentType = "text/plain",
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
  } = options;
  const app = useApp();
  const generated = useId();
  const { id, label } = editorIdentity(props, generated);
  const { field: terminalField, reportAsync } = useTextEditorFieldBinding({
    id,
    defaultValue,
    value,
    onValueChange,
    adaptedField,
    validators,
    disabled,
    readOnly,
    masked: Boolean(mask),
    registerWithForm,
  });
  const createEditorSession = useCallback(
    (sessionOptions: EditorProviderOptions) =>
      app.createEditorSession(sessionOptions),
    [app],
  );
  const session = useEditorSessionBinding({
    providedSession,
    provider: editorProvider,
    clipboard,
    id,
    documentType,
    field: terminalField,
    readOnly,
    masked: Boolean(mask),
    reportAsync,
    createSession: createEditorSession,
  });
  const { editor, snapshot: editorSnapshot } = session;
  const focused = useTextEditorInteraction({
    id,
    label,
    disabled,
    readOnly,
    autoFocus,
    focusOrder,
    multiline,
    maxLength,
    onArrowUp,
    onArrowDown,
    onSubmit,
    onBlur,
    adaptedField,
    field: terminalField,
    editor,
    value: session.value,
  });
  const cursorOffset = editorCursorOffset(editor, editorSnapshot);
  const display = textEditorDisplay(editorSnapshot.document.text, {
    placeholder,
    mask,
    focused,
    interactive: app.mode === "interactive",
    unicode: app.capabilities.unicode,
    cursor: cursorOffset,
  });
  return (
    <TextEditorSemanticView
      model={{
        id,
        testId: props.testId,
        label,
        description: props.description,
        disabled,
        readOnly,
        masked: Boolean(mask),
        value: terminalField.value,
        display,
        focused,
        hasErrors: editorHasErrors(terminalField, adaptedField),
        isPlaceholder: terminalField.value.length === 0 && !focused,
        primaryColor: app.theme.colors.primary.foreground,
        dangerColor: app.theme.colors.danger.foreground,
      }}
    />
  );
}

function TextEditor(props: TextEditorProps): ReactNode {
  return <TextEditorControl options={props} />;
}

export type TextInputProps = Omit<TextEditorProps, "multiline">;

export function TextInput(props: TextInputProps): ReactNode {
  return <TextEditor {...props} multiline={false} />;
}

export type TextAreaProps = Omit<TextEditorProps, "multiline" | "mask">;

export function TextArea(props: TextAreaProps): ReactNode {
  return <TextEditor {...props} multiline />;
}

export type PasswordInputProps = Omit<TextInputProps, "mask"> & {
  readonly mask?: string;
};

export function PasswordInput({
  mask = "•",
  ...props
}: PasswordInputProps): ReactNode {
  if (props.session) {
    throw new TypeError(
      "PasswordInput does not accept a provided editor session; use editorProvider so the control can install its secret-safe change sink",
    );
  }
  return <TextInput {...props} mask={mask} />;
}

export type SearchInputProps = TextInputProps;

export function SearchInput(props: SearchInputProps): ReactNode {
  return (
    <TextInput
      placeholder="Search…"
      {...props}
      label={props.label ?? "Search"}
    />
  );
}

export type CommandLineProps = TextInputProps;

export function CommandLine(props: CommandLineProps): ReactNode {
  return (
    <TextInput
      placeholder=":"
      {...props}
      label={props.label ?? "Command line"}
    />
  );
}

export type CodeEditorProps = TextAreaProps;

export function CodeEditor(props: CodeEditorProps): ReactNode {
  return (
    <TextArea
      {...props}
      label={props.label ?? "Code editor"}
      description={
        props.description ??
        "Multiline editor backed by the tuil editor contract"
      }
    />
  );
}

export type InlineEditorProps = TextInputProps;
export const InlineEditor = TextInput;

export type EditableTableCellProps = TextInputProps;
export const EditableTableCell = TextInput;

export type EditableTreeNodeProps = TextInputProps;
export const EditableTreeNode = TextInput;

export type FormFieldEditorProps = TextAreaProps;
export const FormFieldEditor = TextArea;

export interface DateTimeInputProps
  extends Omit<TextInputProps, "onValueChange"> {
  readonly onValueChange?: (
    value: string,
    date: Date | undefined,
  ) => void | Promise<void>;
}

export function DateTimeInput({
  onValueChange,
  ...props
}: DateTimeInputProps): ReactNode {
  return (
    <TextInput
      placeholder="2026-07-27T12:00"
      {...props}
      onValueChange={(value) => {
        const parsed = new Date(value);
        return onValueChange?.(
          value,
          Number.isNaN(parsed.valueOf()) ? undefined : parsed,
        );
      }}
    />
  );
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
  const handleNumberValueChange = useCallback(
    async (next: number) => {
      adaptedField?.setValue(next);
      await onValueChange?.(next);
    },
    [adaptedField, onValueChange],
  );
  const fieldOptions = useMemo(
    () => ({
      name: id,
      initialValue: defaultValue,
      value: adaptedField?.value ?? value,
      onValueChange: handleNumberValueChange,
      validators,
      disabled: props.disabled,
      readOnly: props.readOnly,
    }),
    [
      adaptedField,
      defaultValue,
      handleNumberValueChange,
      id,
      props.disabled,
      props.readOnly,
      validators,
      value,
    ],
  );
  const field = useTerminalField(fieldOptions);
  useRegisterTerminalField(field, true, adaptedField);
  const current = field.value;
  const [draftState, setDraftState] = useState(() => ({
    source: current,
    value: String(current),
  }));
  const draft =
    draftState.source === current ? draftState.value : String(current);
  const commit = async (candidate: number) => {
    if (!Number.isFinite(candidate)) return;
    const next = Math.min(max, Math.max(min, candidate));
    setDraftState({ source: next, value: String(next) });
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
        setDraftState({ source: current, value: next });
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
  const handleCheckedChange = useCallback(
    async (next: boolean) => {
      adaptedField?.setValue(next);
      await onCheckedChange?.(next);
    },
    [adaptedField, onCheckedChange],
  );
  const fieldOptions = useMemo(
    () => ({
      name: id,
      initialValue: defaultChecked,
      value: adaptedField?.value ?? checked,
      onValueChange: handleCheckedChange,
      validators,
      disabled,
      readOnly,
    }),
    [
      adaptedField,
      checked,
      defaultChecked,
      disabled,
      handleCheckedChange,
      id,
      readOnly,
      validators,
    ],
  );
  const field = useTerminalField(fieldOptions);
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
  const on = app.capabilities.unicode ? "●" : "x";
  const off = app.capabilities.unicode ? "○" : " ";
  return (
    <SemanticText
      id={id}
      testId={props.testId}
      role={role}
      label={label}
      description={props.description}
      disabled={disabled}
      readOnly={readOnly}
      checked={selected}
      bold={focused}
      dimColor={disabled}
      color={selected ? app.theme.colors.primary.foreground : undefined}
    >
      {role === "switch"
        ? `[${selected ? "ON" : "OFF"}]`
        : `[${selected ? on : off}]`}{" "}
      {children}
    </SemanticText>
  );
}

export function Checkbox(props: ToggleProps): ReactNode {
  return <ToggleControl {...props} role="checkbox" />;
}

export function Switch(props: ToggleProps): ReactNode {
  return <ToggleControl {...props} role="switch" />;
}

export interface SliderProps extends CommonComponentProps {
  readonly value?: number;
  readonly defaultValue?: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly width?: number;
  readonly autoFocus?: boolean;
  readonly onValueChange?: (value: number) => void | Promise<void>;
}

function useSliderValue(options: {
  readonly value?: number;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly onValueChange?: (value: number) => void | Promise<void>;
}): {
  readonly current: number;
  readonly setValue: (next: number) => Promise<void>;
} {
  const [internal, setInternal] = useState(options.defaultValue);
  const current = options.value ?? internal;
  const setValue = useCallback(
    async (next: number) => {
      if (options.disabled || options.readOnly) return;
      const steps = Math.round((next - options.min) / options.step);
      const resolved = Math.min(
        options.max,
        Math.max(options.min, steps * options.step + options.min),
      );
      if (options.value === undefined) setInternal(resolved);
      await options.onValueChange?.(resolved);
    },
    [options],
  );
  return { current, setValue };
}

function sliderKeyValue(
  current: number,
  key: {
    readonly leftArrow?: boolean;
    readonly rightArrow?: boolean;
    readonly upArrow?: boolean;
    readonly downArrow?: boolean;
    readonly home?: boolean;
    readonly end?: boolean;
  },
  min: number,
  max: number,
  step: number,
): number | undefined {
  if (key.leftArrow || key.downArrow) return current - step;
  if (key.rightArrow || key.upArrow) return current + step;
  if (key.home) return min;
  if (key.end) return max;
  return undefined;
}

function useSliderInteraction(options: {
  readonly id: string;
  readonly current: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly autoFocus: boolean;
  readonly label: string;
  readonly description?: string;
  readonly testId?: string;
  readonly setValue: (next: number) => Promise<void>;
}): boolean {
  const app = useApp();
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id: options.id,
        disabled: options.disabled,
        hidden: false,
        role: "slider",
        label: options.label,
      }),
      [options.disabled, options.id, options.label],
    ),
  );
  useEffect(() => {
    if (options.autoFocus) focus();
  }, [focus, options.autoFocus]);
  const setFromPointer = useCallback(
    async (event: { readonly x: number }) => {
      focus();
      const bounds = app.layout.get(options.id)?.bounds;
      if (!bounds) {
        await options.setValue(options.current + options.step);
        return;
      }
      const ratio = Math.min(
        1,
        Math.max(0, (event.x - bounds.x) / Math.max(1, bounds.width - 1)),
      );
      await options.setValue(options.min + ratio * (options.max - options.min));
    },
    [app.layout, focus, options],
  );
  usePointerEvent(options.id, "click", setFromPointer, {
    enabled: !options.disabled,
  });
  usePointerEvent(options.id, "drag", setFromPointer, {
    enabled: !options.disabled,
  });
  useTerminalInput(
    async (_input, key) => {
      const next = sliderKeyValue(
        options.current,
        key,
        options.min,
        options.max,
        options.step,
      );
      if (next === undefined) return false;
      await options.setValue(next);
      return true;
    },
    { enabled: focused, priority: 2_000 },
  );
  return focused;
}

export function Slider(props: SliderProps): ReactNode {
  const generated = useId();
  const id = props.id ?? generated;
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const step = props.step ?? 1;
  const disabled = props.disabled ?? false;
  const readOnly = props.readOnly ?? false;
  const { current, setValue } = useSliderValue({
    value: props.value,
    defaultValue: props.defaultValue ?? 0,
    min,
    max,
    step,
    disabled,
    readOnly,
    onValueChange: props.onValueChange,
  });
  const focused = useSliderInteraction({
    id,
    current,
    min,
    max,
    step,
    disabled,
    readOnly,
    autoFocus: props.autoFocus ?? false,
    label: props.label ?? id,
    description: props.description,
    testId: props.testId,
    setValue,
  });
  const width = props.width ?? 20;
  const cells = Math.max(1, Math.floor(width));
  const ratio = max <= min ? 0 : (current - min) / (max - min);
  const thumb = Math.min(
    cells - 1,
    Math.max(0, Math.round(ratio * (cells - 1))),
  );
  return (
    <SemanticText
      bold={focused}
      id={id}
      testId={props.testId}
      role="slider"
      label={props.label ?? id}
      description={props.description}
      disabled={disabled}
      readOnly={readOnly}
      valueText={String(current)}
    >
      {"─".repeat(thumb)}●{"─".repeat(cells - thumb - 1)} {current}
    </SemanticText>
  );
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
  readonly onPointerSelect?: () => void | Promise<void>;
}): null {
  const selectFromPointer = useCallback(() => {
    if (!props.disabled) void props.onPointerSelect?.();
  }, [props.disabled, props.onPointerSelect]);
  usePointerEvent(props.id, "click", selectFromPointer, {
    enabled: !props.disabled && Boolean(props.onPointerSelect),
  });
  return null;
}

function useActiveSelection(initial: number): {
  readonly active: number;
  readonly activeRef: RefObject<number>;
  readonly setActiveIndex: (index: number) => void;
} {
  const [active, setActive] = useState(initial);
  const activeRef = useRef(initial);
  const setActiveIndex = useCallback((index: number) => {
    activeRef.current = index;
    setActive(index);
  }, []);
  return { active, activeRef, setActiveIndex };
}

function useSingleSelectionField<T extends string>(options: {
  readonly id: string | undefined;
  readonly defaultValue: T | undefined;
  readonly value: T | undefined;
  readonly adaptedField: AdaptedTanStackField<T | undefined> | undefined;
  readonly validators: FieldValidators<T | undefined> | undefined;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly onValueChange: ((value: T) => void | Promise<void>) | undefined;
}): {
  readonly id: string;
  readonly field: TerminalFieldBinding<T | undefined>;
} {
  const generated = useId();
  const id = options.id ?? generated;
  const handleValueChange = useCallback(
    async (next: T | undefined) => {
      if (next === undefined) return;
      options.adaptedField?.setValue(next);
      await options.onValueChange?.(next);
    },
    [options.adaptedField, options.onValueChange],
  );
  const field = useTerminalField<T | undefined>(
    useMemo(
      () => ({
        name: id,
        initialValue: options.defaultValue,
        value: options.adaptedField?.value ?? options.value,
        onValueChange: handleValueChange,
        validators: options.validators,
        disabled: options.disabled,
        readOnly: options.readOnly,
      }),
      [
        handleValueChange,
        options.adaptedField,
        options.defaultValue,
        options.disabled,
        id,
        options.readOnly,
        options.validators,
        options.value,
      ],
    ),
  );
  useRegisterTerminalField(field, true, options.adaptedField);
  return { id, field };
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
  const { id, field } = useSingleSelectionField({
    id: props.id,
    defaultValue,
    value,
    adaptedField,
    validators,
    disabled,
    readOnly,
    onValueChange,
  });
  const selected = field.value;
  const initial = Math.max(
    0,
    options.findIndex((option) => option.value === selected),
  );
  const { active, activeRef, setActiveIndex } = useActiveSelection(initial);
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
    setActiveIndex(index);
  }, [options, selected, setActiveIndex]);
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
        <SemanticText
          key={option.value}
          id={`${id}:${option.value}`}
          role="radio"
          label={option.label}
          description={option.description}
          selected={option.value === selected}
          checked={option.value === selected}
          disabled={option.disabled}
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
            onPointerSelect={async () => {
              focus();
              setActiveIndex(index);
              if (!disabled && !readOnly) await field.setValue(option.value);
            }}
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
        </SemanticText>
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
  const { id, field } = useSingleSelectionField({
    id: props.id,
    defaultValue,
    value,
    adaptedField,
    validators,
    disabled,
    readOnly,
    onValueChange,
  });
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const selected = field.value;
  const expanded = open ?? internalOpen;
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  const visible = useMemo(
    () => filteredOptions(options, searchable ? query : ""),
    [options, query, searchable],
  );
  const selectedIndex = Math.max(
    0,
    visible.findIndex((option) => option.value === selected),
  );
  const { active, activeRef, setActiveIndex } =
    useActiveSelection(selectedIndex);
  const { focused, focus } = useListboxFieldFocus({
    id,
    label: props.label ?? id,
    disabled,
    autoFocus,
    field,
    adaptedField,
    onBlur,
  });
  useEffect(() => {
    const index = Math.max(
      0,
      visible.findIndex((option) => option.value === selected),
    );
    setActiveIndex(index);
  }, [selected, setActiveIndex, visible]);
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
      <SemanticText
        id={id}
        testId={props.testId}
        role="listbox"
        label={props.label ?? id}
        description={props.description}
        disabled={disabled}
        readOnly={readOnly}
        expanded={expanded}
        valueText={selected}
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
      </SemanticText>
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
                <SemanticText
                  key={option.value}
                  id={`${id}:${option.value}`}
                  role="option"
                  label={option.label}
                  description={option.description}
                  selected={optionState.selected}
                  disabled={option.disabled}
                >
                  <Option
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
                      onPointerSelect={async () => {
                        focus();
                        setActiveIndex(index);
                        if (!option.disabled && !disabled && !readOnly) {
                          await field.setValue(option.value);
                          await setOpen(false);
                        }
                      }}
                    />
                    {optionState.active ? ">" : " "}{" "}
                    {optionState.selected ? "*" : " "} {option.label}
                  </Option>
                </SemanticText>
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
  const handleMultiSelectValueChange = useCallback(
    async (next: readonly T[]) => {
      adaptedField?.setValue(next);
      await onValueChange?.(next);
    },
    [adaptedField, onValueChange],
  );
  const fieldOptions = useMemo(
    () => ({
      name: id,
      initialValue,
      value: adaptedField?.value ?? value,
      onValueChange: handleMultiSelectValueChange,
      validators,
      disabled,
      readOnly,
    }),
    [
      adaptedField,
      disabled,
      handleMultiSelectValueChange,
      id,
      initialValue,
      readOnly,
      validators,
      value,
    ],
  );
  const field = useTerminalField<readonly T[]>(fieldOptions);
  useRegisterTerminalField(field, true, adaptedField);
  const selected = field.value;
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const { active, activeRef, setActiveIndex } = useActiveSelection(0);
  const { focused, focus } = useListboxFieldFocus({
    id,
    label: props.label ?? id,
    disabled,
    autoFocus,
    field,
    adaptedField,
    onBlur,
  });
  const toggleOption = async (option: SelectOption<T> | undefined) => {
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
        await toggleOption(options[activeRef.current]);
        return true;
      }
      return false;
    },
    { enabled: focused && options.length > 0, priority: 2_000 },
  );
  return (
    <Box flexDirection="column">
      <SemanticText
        id={id}
        testId={props.testId}
        role="listbox"
        label={props.label ?? id}
        description={props.description}
        disabled={disabled}
        readOnly={readOnly}
        valueText={selected.join(",")}
        bold={focused}
      >
        {selected.length > 0
          ? options
              .flatMap((option) =>
                selected.includes(option.value) ? [option.label] : [],
              )
              .join(", ")
          : placeholder}
      </SemanticText>
      {options.map((option, index) => {
        const checked = selected.includes(option.value);
        return (
          <SemanticText
            key={option.value}
            id={`${id}:${option.value}`}
            role="option"
            label={option.label}
            description={option.description}
            selected={checked}
            checked={checked}
            disabled={option.disabled}
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
              onPointerSelect={async () => {
                focus();
                setActiveIndex(index);
                await toggleOption(option);
              }}
            />
            {focused && index === active ? ">" : " "} [{checked ? "x" : " "}]{" "}
            {option.label}
          </SemanticText>
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
  const { active, activeRef, setActiveIndex } = useActiveSelection(0);
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
            <SemanticText
              key={option.value}
              id={`${id}:${option.value}`}
              role="option"
              label={option.label}
              description={option.description}
              selected={index === active}
              disabled={option.disabled}
              bold={index === active}
              dimColor={option.disabled}
            >
              <SemanticOption
                id={`${id}:${option.value}`}
                label={option.label}
                description={option.description}
                selected={index === active}
                disabled={option.disabled}
                onPointerSelect={async () => {
                  app.focus.focus(id);
                  setActiveIndex(index);
                  if (option.disabled || disabled || readOnly) return;
                  if (value === undefined) setInternal(option.label);
                  field?.setValue(option.label);
                  await onValueChange?.(option.label);
                  await onOptionSelect?.(option);
                }}
              />
              {index === active ? ">" : " "} {option.label}
            </SemanticText>
          ))
        : null}
    </Box>
  );
}
