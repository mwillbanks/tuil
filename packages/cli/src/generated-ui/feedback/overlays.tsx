import { useApp } from "@mwillbanks/tuil";
import type { Command } from "@mwillbanks/tuil-core";
import { useHotkey } from "@mwillbanks/tuil-hotkeys";
import {
  Overlay,
  Box as SemanticBox,
  useOptionalExternalStore,
  usePointerEvents,
  useSemanticNode,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import { useTheme } from "@mwillbanks/tuil-theme";
import { Box, Text } from "ink";
import {
  Component,
  createContext,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "../components/button.tsx";
import { TextInput } from "../forms/controls.tsx";

interface DialogContextValue {
  readonly id: string;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void | Promise<void>;
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

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

function useDialogContext(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("Dialog compound components require a Dialog parent");
  }
  return context;
}

export interface DialogProps {
  readonly id?: string;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void | Promise<void>;
  readonly children?: ReactNode;
}

function DialogRoot({
  id: providedId,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: DialogProps): ReactNode {
  const generated = useId();
  const id = providedId ?? generated;
  const [internal, setInternal] = useState(defaultOpen);
  const expanded = open ?? internal;
  const setOpen = useCallback(
    async (next: boolean) => {
      if (open === undefined) setInternal(next);
      await onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const context = useMemo(
    () => ({ id, open: expanded, setOpen }),
    [expanded, id, setOpen],
  );
  return (
    <DialogContext.Provider value={context}>{children}</DialogContext.Provider>
  );
}

function DialogTrigger(props: {
  readonly children?: ReactNode;
  readonly disabled?: boolean;
}): ReactNode {
  const dialog = useDialogContext();
  return (
    <Button
      disabled={props.disabled}
      onPress={() => dialog.setOpen(true)}
      label="Open dialog"
    >
      {props.children ?? "Open"}
    </Button>
  );
}

function DialogContent(props: {
  readonly children?: ReactNode;
  readonly dismissOnEscape?: boolean;
  readonly width?: number;
  readonly label?: string;
}): ReactNode {
  const dialog = useDialogContext();
  const app = useApp();
  const theme = useTheme();
  return (
    <Overlay
      id={dialog.id}
      open={dialog.open}
      dismissOnEscape={props.dismissOnEscape}
      onDismiss={() => dialog.setOpen(false)}
    >
      <DialogSemanticContent
        id={`${dialog.id}:content`}
        label={props.label ?? "Dialog"}
      >
        <Box
          flexDirection="column"
          width={props.width ?? 60}
          borderStyle={app.capabilities.unicode ? "round" : "classic"}
          borderColor={theme.colors.primary.foreground}
          paddingX={1}
        >
          {props.children}
        </Box>
      </DialogSemanticContent>
    </Overlay>
  );
}

function DialogSemanticContent(props: {
  readonly id: string;
  readonly label: string;
  readonly children?: ReactNode;
}): ReactNode {
  useSemanticNode(
    useMemo(
      () => ({
        key: props.id,
        id: props.id,
        role: "dialog" as const,
        label: props.label,
        expanded: true,
      }),
      [props.id, props.label],
    ),
  );
  return props.children;
}

function DialogTitle(props: { readonly children?: ReactNode }): ReactNode {
  return <Text bold>{props.children}</Text>;
}

function DialogDescription(props: {
  readonly children?: ReactNode;
}): ReactNode {
  return <Text dimColor>{props.children}</Text>;
}

function DialogActions(props: { readonly children?: ReactNode }): ReactNode {
  return (
    <Box flexDirection="row" gap={1} marginTop={1}>
      {props.children}
    </Box>
  );
}

function DialogCancel(props: {
  readonly children?: ReactNode;
  readonly onPress?: () => void | Promise<void>;
}): ReactNode {
  const dialog = useDialogContext();
  return (
    <Button
      onPress={async () => {
        await props.onPress?.();
        await dialog.setOpen(false);
      }}
    >
      {props.children ?? "Cancel"}
    </Button>
  );
}

function DialogConfirm(props: {
  readonly children?: ReactNode;
  readonly onPress?: () => void | Promise<void>;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}): ReactNode {
  const dialog = useDialogContext();
  return (
    <Button
      variant={props.danger ? "danger" : "solid"}
      disabled={props.disabled}
      onPress={async () => {
        await props.onPress?.();
        await dialog.setOpen(false);
      }}
    >
      {props.children ?? "Confirm"}
    </Button>
  );
}

export const Dialog = Object.assign(DialogRoot, {
  Trigger: DialogTrigger,
  Content: DialogContent,
  Title: DialogTitle,
  Description: DialogDescription,
  Actions: DialogActions,
  Cancel: DialogCancel,
  Confirm: DialogConfirm,
});

export interface ConfirmDialogProps extends Omit<DialogProps, "children"> {
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void | Promise<void>;
  readonly onCancel?: () => void | Promise<void>;
  readonly trigger?: ReactNode;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
  trigger,
  ...dialogProps
}: ConfirmDialogProps): ReactNode {
  return (
    <Dialog {...dialogProps}>
      {trigger ? <Dialog.Trigger>{trigger}</Dialog.Trigger> : null}
      <Dialog.Content label={title}>
        <Dialog.Title>{title}</Dialog.Title>
        {description ? (
          <Dialog.Description>{description}</Dialog.Description>
        ) : null}
        <Dialog.Actions>
          <Dialog.Cancel onPress={onCancel}>
            {cancelLabel ?? "Cancel"}
          </Dialog.Cancel>
          <Dialog.Confirm onPress={onConfirm} danger={danger}>
            {confirmLabel ?? "Confirm"}
          </Dialog.Confirm>
        </Dialog.Actions>
      </Dialog.Content>
    </Dialog>
  );
}

export interface TooltipProps {
  readonly targetId: string;
  readonly content: ReactNode;
  readonly description?: string;
  readonly delay?: number;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void | Promise<void>;
  readonly children?: ReactNode;
}

export function Tooltip({
  targetId,
  content,
  description,
  delay = 400,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: TooltipProps): ReactNode {
  const app = useApp();
  const [internal, setInternal] = useState(defaultOpen);
  const reportAsync = useRuntimeAsync();
  const visible = open ?? internal;
  const setOpen = useCallback(
    async (next: boolean) => {
      if (open === undefined) setInternal(next);
      await onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const subscribeToFocus = useCallback(
    (notify: () => void) => app.focus.observe(notify),
    [app.focus],
  );
  const getFocused = useCallback(
    () => app.focus.focusedId === targetId,
    [app.focus, targetId],
  );
  const focused = useSyncExternalStore(
    subscribeToFocus,
    getFocused,
    getFocused,
  );
  useEffect(() => {
    if (!focused) {
      reportAsync(setOpen(false), "tooltip-close");
      return;
    }
    const timer = setTimeout(
      () => reportAsync(setOpen(true), "tooltip-open"),
      delay,
    );
    return () => clearTimeout(timer);
  }, [delay, focused, reportAsync, setOpen]);
  const toggleHelp = useCallback(() => setOpen(!visible), [setOpen, visible]);
  const helpHotkeyOptions = useMemo(
    () => ({
      scope: "application" as const,
      enabled: () => app.focus.focusedId === targetId,
      title: "Toggle contextual help",
    }),
    [app.focus, targetId],
  );
  useHotkey("f1", toggleHelp, helpHotkeyOptions);
  return (
    <Box flexDirection="column">
      {children}
      {visible ? (
        <TooltipContent
          id={`${targetId}:tooltip`}
          label={`Help for ${targetId}`}
          description={
            description ?? (typeof content === "string" ? content : undefined)
          }
        >
          <Text dimColor color={app.theme.colors.info.foreground}>
            {content}
          </Text>
        </TooltipContent>
      ) : null}
    </Box>
  );
}

function TooltipContent(props: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly children?: ReactNode;
}): ReactNode {
  useSemanticNode(
    useMemo(
      () => ({
        key: props.id,
        id: props.id,
        role: "status" as const,
        label: props.label,
        description: props.description,
      }),
      [props.description, props.id, props.label],
    ),
  );
  return props.children;
}

export type ToastVariant = "info" | "success" | "warning" | "danger";

export interface ToastRecord {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly variant: ToastVariant;
  readonly duration: number;
  readonly action?: {
    readonly label: string;
    readonly run: () => void | Promise<void>;
  };
}

class ToastManager {
  readonly #records = new Map<string, ToastRecord>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #observers = new Set<() => void>();
  #snapshot: readonly ToastRecord[] = Object.freeze([]);
  #counter = 0;

  subscribe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  snapshot(): readonly ToastRecord[] {
    return this.#snapshot;
  }

  show(
    toast: Omit<ToastRecord, "id" | "duration" | "variant"> & {
      readonly id?: string;
      readonly duration?: number;
      readonly variant?: ToastVariant;
    },
  ): string {
    const id = toast.id ?? `toast-${++this.#counter}`;
    const record: ToastRecord = Object.freeze({
      id,
      title: toast.title,
      description: toast.description,
      variant: toast.variant ?? "info",
      duration: toast.duration ?? 4_000,
      action: toast.action,
    });
    this.#records.set(id, record);
    this.#schedule(record);
    this.#notify();
    return id;
  }

  update(id: string, patch: Partial<Omit<ToastRecord, "id">>): void {
    const current = this.#records.get(id);
    if (!current) return;
    const next = Object.freeze({ ...current, ...patch, id });
    this.#records.set(id, next);
    this.#schedule(next);
    this.#notify();
  }

  dismiss(id: string): void {
    this.#records.delete(id);
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    this.#notify();
  }

  async promise<T>(
    promise: Promise<T>,
    messages: {
      readonly loading: string;
      readonly success: string | ((value: T) => string);
      readonly error: string | ((error: unknown) => string);
    },
  ): Promise<T> {
    const id = this.show({ title: messages.loading, duration: 0 });
    try {
      const value = await promise;
      this.update(id, {
        title:
          typeof messages.success === "function"
            ? messages.success(value)
            : messages.success,
        variant: "success",
        duration: 4_000,
      });
      return value;
    } catch (error) {
      this.update(id, {
        title:
          typeof messages.error === "function"
            ? messages.error(error)
            : messages.error,
        variant: "danger",
        duration: 6_000,
      });
      throw error;
    }
  }

  dispose(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#records.clear();
    this.#notify();
    this.#observers.clear();
  }

  #schedule(record: ToastRecord): void {
    const existing = this.#timers.get(record.id);
    if (existing) clearTimeout(existing);
    this.#timers.delete(record.id);
    if (record.duration <= 0) return;
    this.#timers.set(
      record.id,
      setTimeout(() => this.dismiss(record.id), record.duration),
    );
  }

  #notify(): void {
    this.#snapshot = Object.freeze([...this.#records.values()]);
    for (const observer of this.#observers) observer();
  }
}

const ToastContext = createContext<ToastManager | undefined>(undefined);
const emptyToastRecords: readonly ToastRecord[] = Object.freeze([]);

export interface ToastApi {
  readonly show: ToastManager["show"];
  readonly update: ToastManager["update"];
  readonly dismiss: ToastManager["dismiss"];
  readonly promise: ToastManager["promise"];
}

export function ToastProvider(props: {
  readonly children?: ReactNode;
}): ReactNode {
  const manager = useMemo(() => new ToastManager(), []);
  useEffect(() => () => manager.dispose(), [manager]);
  return (
    <ToastContext.Provider value={manager}>
      {props.children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const manager = useContext(ToastContext);
  const api = useMemo(
    () =>
      manager
        ? {
            show: manager.show.bind(manager),
            update: manager.update.bind(manager),
            dismiss: manager.dismiss.bind(manager),
            promise: manager.promise.bind(manager),
          }
        : undefined,
    [manager],
  );
  if (!api) throw new Error("useToast requires ToastProvider");
  return api;
}

export function Toast(props: {
  readonly toast: ToastRecord;
  readonly onDismiss?: (id: string) => void;
}): ReactNode {
  const theme = useTheme();
  const color = theme.colors[props.toast.variant].foreground;
  useSemanticNode(
    useMemo(
      () => ({
        key: props.toast.id,
        id: props.toast.id,
        role:
          props.toast.variant === "danger"
            ? ("alert" as const)
            : ("status" as const),
        label: props.toast.title,
        description: props.toast.description,
      }),
      [
        props.toast.description,
        props.toast.id,
        props.toast.title,
        props.toast.variant,
      ],
    ),
  );
  return (
    <Box borderStyle="single" borderColor={color} paddingX={1}>
      <Text color={color} bold>
        {props.toast.title}
      </Text>
      {props.toast.description ? (
        <Text> — {props.toast.description}</Text>
      ) : null}
      {props.toast.action ? (
        <Button onPress={props.toast.action.run}>
          {props.toast.action.label}
        </Button>
      ) : null}
      {props.onDismiss ? (
        <Button onPress={() => props.onDismiss?.(props.toast.id)}>
          Dismiss
        </Button>
      ) : null}
    </Box>
  );
}

export function ToastViewport(): ReactNode {
  const manager = useContext(ToastContext);
  const dismiss = useCallback((id: string) => manager?.dismiss(id), [manager]);
  const records = useOptionalExternalStore(manager, emptyToastRecords);
  if (!manager) throw new Error("ToastViewport requires ToastProvider");
  return (
    <Box flexDirection="column">
      {records.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </Box>
  );
}

export interface CommandPaletteProps {
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void | Promise<void>;
  readonly commands?: readonly Command[];
  readonly placeholder?: string;
  readonly hotkey?: string;
}

function filteredCommands(
  commands: readonly Command[],
  query: string,
): readonly Command[] {
  const normalized = query.toLocaleLowerCase();
  return commands.filter(
    (command) =>
      command.title.toLocaleLowerCase().includes(normalized) ||
      command.id.toLocaleLowerCase().includes(normalized) ||
      Boolean(command.category?.toLocaleLowerCase().includes(normalized)),
  );
}

function useCommandPaletteVisibility(
  props: CommandPaletteProps,
  onClose: () => void,
): {
  readonly visible: boolean;
  readonly setOpen: (next: boolean) => Promise<void>;
} {
  const [internal, setInternal] = useState(props.defaultOpen ?? false);
  const visible = props.open ?? internal;
  const setOpen = useCallback(
    async (next: boolean) => {
      if (props.open === undefined) setInternal(next);
      if (!next) onClose();
      await props.onOpenChange?.(next);
    },
    [onClose, props.onOpenChange, props.open],
  );
  return { visible, setOpen };
}

function useCommandPaletteState(props: CommandPaletteProps) {
  const app = useApp();
  const generated = useId();
  const id = `command-palette:${generated}`;
  const inputId = `${id}:input`;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const setActiveIndex = useCallback((index: number) => {
    activeRef.current = index;
    setActive(index);
  }, []);
  const resetPalette = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
  }, [setActiveIndex]);
  const visibility = useCommandPaletteVisibility(props, resetPalette);
  const visible = visibility.visible;
  const setOpen = visibility.setOpen;
  const togglePalette = useCallback(
    () => setOpen(!visible),
    [setOpen, visible],
  );
  const paletteHotkeyOptions = useMemo(
    () => ({
      scope: "application" as const,
      priority: 500,
      title: "Open command palette",
    }),
    [],
  );
  useHotkey(props.hotkey ?? "mod+k", togglePalette, paletteHotkeyOptions);
  const available = useMemo(
    () => filteredCommands(props.commands ?? app.commands.list(), query),
    [app.commands, props.commands, query],
  );
  const executeCommand = useCallback(
    async (command: Command | undefined) => {
      if (!command) return;
      await app.commands.execute(command.id, { source: id });
      await setOpen(false);
    },
    [app.commands, id, setOpen],
  );
  return {
    app,
    id,
    inputId,
    visible,
    query,
    setQuery,
    active,
    activeRef,
    setActiveIndex,
    setOpen,
    available,
    executeCommand,
  };
}

function useCommandPaletteInteraction(
  state: ReturnType<typeof useCommandPaletteState>,
): void {
  const {
    app,
    id,
    inputId,
    visible,
    activeRef,
    setActiveIndex,
    available,
    executeCommand,
  } = state;
  usePointerEvents(
    useMemo(
      () =>
        available.map((command, index) => ({
          id: `${id}:command:${command.id}`,
          type: "click" as const,
          listener: async () => {
            app.focus.focus(inputId);
            setActiveIndex(index);
            await executeCommand(command);
          },
        })),
      [app.focus, available, executeCommand, id, inputId, setActiveIndex],
    ),
  );
  useTerminalInput(
    async (_input, key) => {
      if (!visible || app.focus.focusedId !== inputId) return false;
      if (key.upArrow) {
        setActiveIndex(Math.max(0, activeRef.current - 1));
        return true;
      }
      if (key.downArrow) {
        setActiveIndex(Math.min(available.length - 1, activeRef.current + 1));
        return true;
      }
      if (key.return) {
        const command = available[activeRef.current];
        if (!command) return true;
        await executeCommand(command);
        return true;
      }
      return false;
    },
    { enabled: visible, priority: 2_100, layerId: id },
  );
}

function CommandPaletteOptions(props: {
  readonly id: string;
  readonly commands: readonly Command[];
  readonly active: number;
  readonly activeColor: string;
}): ReactNode {
  if (props.commands.length === 0)
    return <Text dimColor>No matching commands</Text>;
  return props.commands.map((command, index) => (
    <SemanticBox
      key={command.id}
      id={`${props.id}:command:${command.id}`}
      role="option"
      label={command.title}
      selected={index === props.active}
    >
      <Text
        bold={index === props.active}
        color={index === props.active ? props.activeColor : undefined}
      >
        {index === props.active ? ">" : " "} {command.title}
        {command.category ? ` — ${command.category}` : ""}
      </Text>
    </SemanticBox>
  ));
}

export function CommandPalette(props: CommandPaletteProps): ReactNode {
  const state = useCommandPaletteState(props);
  useCommandPaletteInteraction(state);
  return (
    <Dialog id={state.id} open={state.visible} onOpenChange={state.setOpen}>
      <Dialog.Content label="Command palette" width={70}>
        <Dialog.Title>Commands</Dialog.Title>
        <TextInput
          id={state.inputId}
          label="Command search"
          value={state.query}
          onValueChange={(next) => {
            state.setQuery(next);
            state.setActiveIndex(0);
          }}
          placeholder={props.placeholder ?? "Type a command…"}
          autoFocus
        />
        <Box flexDirection="column">
          <CommandPaletteOptions
            id={state.id}
            commands={state.available}
            active={state.active}
            activeColor={state.app.theme.colors.primary.foreground}
          />
        </Box>
      </Dialog.Content>
    </Dialog>
  );
}

export const Drawer = Dialog;
export const Popover = Dialog;

export function Skeleton(props: {
  readonly width?: number;
  readonly lines?: number;
  readonly label?: string;
}): ReactNode {
  const width = Math.max(1, Math.floor(props.width ?? 20));
  const lines = Math.max(1, Math.floor(props.lines ?? 1));
  return (
    <Box flexDirection="column" aria-label={props.label ?? "Loading"}>
      {Array.from({ length: lines }, (_value, index) => `line-${index}`).map(
        (line) => (
          <Text key={line} dimColor>
            {"░".repeat(width)}
          </Text>
        ),
      )}
    </Box>
  );
}

export interface ErrorBoundaryProps {
  readonly children?: ReactNode;
  readonly fallback?: (error: Error, reset: () => void) => ReactNode;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  readonly error?: Error;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return this.props.fallback ? (
      this.props.fallback(error, this.reset)
    ) : (
      <Box borderStyle="round" flexDirection="column">
        <Text color="red" bold>
          Something went wrong
        </Text>
        <Text>{error.message}</Text>
      </Box>
    );
  }
}
