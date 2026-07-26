import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  normalizeHotkeyNotation,
  normalizeTerminalKey,
  useHotkey,
} from "@mwillbanks/tuil-hotkeys";
import { useSemanticNode, useTerminalInput } from "@mwillbanks/tuil-ink";
import type {
  OperationSnapshot,
  OperationStatus,
} from "@mwillbanks/tuil-operations";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import type {
  WorkflowRunner,
  WorkflowSnapshot,
} from "@mwillbanks/tuil-workflow";
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  type ComponentType,
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "../components/button.tsx";
import { Dialog } from "../feedback/overlays.tsx";
import { TextInput } from "../forms/controls.tsx";
import {
  Stepper,
  type StepperItem,
  type StepperProps,
} from "../navigation/navigation.tsx";

type AnyRunner = WorkflowRunner<unknown>;

interface WorkflowContextValue {
  readonly runner: AnyRunner;
  readonly snapshot: WorkflowSnapshot<unknown>;
  readonly slots?: Partial<
    Record<keyof WorkflowSlots, ComponentType<BoxProps>>
  >;
  readonly slotProps?: WorkflowProps<unknown>["slotProps"];
}

const WorkflowContext = createContext<WorkflowContextValue | undefined>(
  undefined,
);

function useWorkflow(): WorkflowContextValue {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("Workflow compound components require a Workflow parent");
  }
  return context;
}

type WorkflowSlots = {
  root: BoxProps;
  content: BoxProps;
};

export interface WorkflowProps<TState>
  extends SlottedComponentProps<WorkflowSlots> {
  readonly id?: string;
  readonly workflow: WorkflowRunner<TState>;
  readonly autoStart?: boolean;
  readonly children?: ReactNode;
}

function WorkflowRoot<TState>({
  id: providedId,
  workflow,
  autoStart = true,
  children,
  slots,
  slotProps,
}: WorkflowProps<TState>): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = providedId ?? generated;
  const snapshot = useSyncExternalStore(
    (notify) => workflow.subscribe(notify),
    () => workflow.snapshot,
    () => workflow.snapshot,
  );
  const [startError, setStartError] = useState<unknown>();
  useEffect(() => {
    if (autoStart && workflow.snapshot.status === "idle") {
      void (async () => {
        try {
          await workflow.start();
        } catch (cause) {
          try {
            await app.reportError(cause, "workflow-start");
          } catch (reportError) {
            setStartError(
              new AggregateError(
                [cause, reportError],
                "Workflow startup and error reporting failed",
              ),
            );
          }
        }
      })();
    }
  }, [app, autoStart, workflow]);
  if (startError) throw startError;
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        role: "application" as const,
        label: `Workflow ${snapshot.id}`,
        valueText: snapshot.status,
      }),
      [id, snapshot.id, snapshot.status],
    ),
  );
  const Root = slots?.root ?? Box;
  const state = { status: snapshot.status };
  const value = useMemo(
    () => ({
      runner: workflow as unknown as AnyRunner,
      snapshot: snapshot as WorkflowSnapshot<unknown>,
      slots,
      slotProps: slotProps as WorkflowProps<unknown>["slotProps"],
    }),
    [slotProps, slots, snapshot, workflow],
  );
  return (
    <WorkflowContext.Provider value={value}>
      <Root
        flexDirection="column"
        {...resolveSlotProps(slotProps?.root, state, theme)}
      >
        {children}
      </Root>
    </WorkflowContext.Provider>
  );
}

function WorkflowStepper(
  props: Omit<StepperProps, "steps" | "current">,
): ReactNode {
  const { runner, snapshot } = useWorkflow();
  const steps = useMemo<readonly StepperItem[]>(
    () =>
      Object.entries(runner.definition.steps).map(([id, step]) => ({
        id,
        label: step.title ?? id,
        description: step.help,
        status:
          snapshot.currentStep === id
            ? snapshot.status === "failed" || snapshot.status === "blocked"
              ? "error"
              : "current"
            : snapshot.completedSteps.includes(id)
              ? "completed"
              : snapshot.skippedSteps.includes(id)
                ? "skipped"
                : "pending",
      })),
    [runner.definition.steps, snapshot],
  );
  return (
    <Stepper
      id={`${snapshot.id}:stepper`}
      steps={steps}
      current={snapshot.currentStep}
      {...props}
    />
  );
}

function WorkflowContent(props: {
  readonly empty?: ReactNode;
  readonly render?: (
    step: AnyRunner["currentStep"],
    context: WorkflowContextValue,
  ) => ReactNode;
}): ReactNode {
  const context = useWorkflow();
  const { runner, snapshot } = context;
  const theme = useTheme();
  const Content = context.slots?.content ?? Box;
  const step = runner.currentStep;
  if (!step) return props.empty ?? null;
  let content: ReactNode;
  if (props.render) {
    content = props.render(step, context);
  } else if (typeof step.component === "function") {
    content = createElement(
      step.component as ComponentType<{ readonly workflow: AnyRunner }>,
      { workflow: runner },
    );
  } else {
    content = step.component as ReactNode;
  }
  return (
    <Content
      flexDirection="column"
      {...resolveSlotProps(
        context.slotProps?.content,
        { status: snapshot.status },
        theme,
      )}
    >
      <Text bold>{step.title ?? snapshot.currentStep}</Text>
      {step.help ? <Text dimColor>{step.help}</Text> : null}
      {typeof content === "string" || typeof content === "number" ? (
        <Text>{content}</Text>
      ) : (
        content
      )}
      {snapshot.nestedWorkflow ? (
        <Text dimColor>
          Nested: {snapshot.nestedWorkflow.currentStep ?? "complete"} (
          {snapshot.nestedWorkflow.status})
        </Text>
      ) : null}
      {step.commands?.length ? (
        <Text color={theme.colors.muted}>
          Commands: {step.commands.join(", ")}
        </Text>
      ) : null}
    </Content>
  );
}

function WorkflowErrorSemantic(props: {
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

function WorkflowErrors(
  props: SlottedComponentProps<{ root: BoxProps; error: TextProps }>,
): ReactNode {
  const { snapshot } = useWorkflow();
  const theme = useTheme();
  if (snapshot.errors.length === 0) return null;
  const Root = props.slots?.root ?? Box;
  const ErrorText = props.slots?.error ?? Text;
  const state = { invalid: true };
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(props.slotProps?.root, state, theme)}
    >
      {snapshot.errors.map((error, index) => (
        <WorkflowErrorSemantic
          key={error}
          id={`${snapshot.id}:error:${index}`}
          message={error}
        >
          <ErrorText
            color={theme.colors.danger.foreground}
            {...resolveSlotProps(props.slotProps?.error, state, theme)}
          >
            ! {error}
          </ErrorText>
        </WorkflowErrorSemantic>
      ))}
    </Root>
  );
}

function WorkflowActions(
  props: {
    readonly nextLabel?: string;
    readonly backLabel?: string;
    readonly cancelLabel?: string;
    readonly showSkip?: boolean;
  } & SlottedComponentProps<{ root: BoxProps }>,
): ReactNode {
  const { runner, snapshot } = useWorkflow();
  const theme = useTheme();
  const terminal =
    snapshot.status === "completed" || snapshot.status === "cancelled";
  if (terminal) return null;
  const Root = props.slots?.root ?? Box;
  return (
    <Root
      flexDirection="row"
      gap={1}
      {...resolveSlotProps(
        props.slotProps?.root,
        { transitioning: snapshot.transitioning },
        theme,
      )}
    >
      <Button
        disabled={snapshot.transitioning || snapshot.history.length < 2}
        onPress={async () => {
          await runner.back();
        }}
      >
        {props.backLabel ?? "Back"}
      </Button>
      {props.showSkip ? (
        <Button
          disabled={snapshot.transitioning}
          onPress={async () => {
            await runner.skip();
          }}
        >
          Skip
        </Button>
      ) : null}
      {snapshot.status === "failed" || snapshot.status === "blocked" ? (
        <Button
          disabled={snapshot.transitioning}
          onPress={async () => {
            await runner.retry();
          }}
        >
          Retry
        </Button>
      ) : (
        <Button
          disabled={snapshot.transitioning}
          onPress={async () => {
            await runner.next();
          }}
        >
          {props.nextLabel ?? "Next"}
        </Button>
      )}
      <Button
        variant="danger"
        onPress={async () => {
          await runner.cancel();
        }}
      >
        {props.cancelLabel ?? "Cancel"}
      </Button>
    </Root>
  );
}

function WorkflowOperations(
  props: Omit<OperationListProps, "operations">,
): ReactNode {
  const { snapshot } = useWorkflow();
  return <OperationList {...props} operations={snapshot.operations} />;
}

export const Workflow = Object.assign(WorkflowRoot, {
  Stepper: WorkflowStepper,
  Content: WorkflowContent,
  Errors: WorkflowErrors,
  Operations: WorkflowOperations,
  Actions: WorkflowActions,
});

const statusMarkers: Readonly<Record<OperationStatus, string>> = {
  idle: " ",
  queued: ".",
  running: ">",
  waiting: "~",
  blocked: "!",
  retrying: "r",
  succeeded: "x",
  failed: "!",
  cancelled: "-",
  skipped: "-",
};

function duration(operation: OperationSnapshot): string | undefined {
  if (!operation.startedAt) return undefined;
  const end = operation.completedAt ?? Date.now();
  return `${Math.max(0, end - operation.startedAt)}ms`;
}

function OperationSemantic(props: {
  readonly operation: OperationSnapshot;
  readonly tree: boolean;
  readonly expanded?: boolean;
  readonly prefix?: string;
}): null {
  useSemanticNode(
    useMemo(
      () => ({
        key: `${props.prefix ?? "operation"}:${props.operation.id}`,
        id: `${props.prefix ?? "operation"}:${props.operation.id}`,
        role: props.tree ? ("treeitem" as const) : ("status" as const),
        label: props.operation.title,
        description: props.operation.description,
        expanded: props.expanded,
        valueText: props.operation.status,
      }),
      [props.expanded, props.operation, props.tree, props.prefix],
    ),
  );
  return null;
}

type OperationSlots = {
  root: BoxProps;
  item: BoxProps;
  title: TextProps;
  metadata: TextProps;
};

export interface OperationListProps
  extends SlottedComponentProps<OperationSlots> {
  readonly id?: string;
  readonly operations: readonly OperationSnapshot[];
  readonly expandable?: boolean;
  readonly showDuration?: boolean;
  readonly showAttempts?: boolean;
  readonly showProgress?: boolean;
}

export function OperationList({
  id = "operations",
  operations,
  expandable = false,
  showDuration = false,
  showAttempts = false,
  showProgress = true,
  slots,
  slotProps,
}: OperationListProps): ReactNode {
  const theme = useTheme();
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        role: "status" as const,
        label: "Operations",
        valueText: `${operations.length}`,
      }),
      [id, operations.length],
    ),
  );
  const Root = slots?.root ?? Box;
  const Item = slots?.item ?? Box;
  const Title = slots?.title ?? Text;
  const Metadata = slots?.metadata ?? Text;
  const state = { empty: operations.length === 0 };
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      {operations.map((operation, index) => {
        const operationKey = `${id}:${index}:${operation.id}`;
        return (
          <Item
            key={operationKey}
            flexDirection="column"
            {...resolveSlotProps(slotProps?.item, state, theme)}
          >
            <Title {...resolveSlotProps(slotProps?.title, state, theme)}>
              <OperationSemantic
                operation={operation}
                tree={false}
                prefix={operationKey}
              />
              [{statusMarkers[operation.status]}] {operation.title}
              {showAttempts && operation.attempt > 0
                ? ` (attempt ${operation.attempt})`
                : ""}
              {showDuration && duration(operation)
                ? ` ${duration(operation)}`
                : ""}
            </Title>
            {showProgress && operation.progress ? (
              <Metadata
                dimColor
                {...resolveSlotProps(slotProps?.metadata, state, theme)}
              >
                {operation.progress.current}
                {operation.progress.total ? `/${operation.progress.total}` : ""}
                {operation.progress.message
                  ? ` ${operation.progress.message}`
                  : ""}
              </Metadata>
            ) : null}
            {operation.error ? (
              <Text color={theme.colors.danger.foreground}>
                {operation.error.message}
              </Text>
            ) : null}
            {expandable && operation.children.length > 0 ? (
              <Box marginLeft={2}>
                <OperationList
                  operations={operation.children}
                  id={`${operationKey}:children`}
                  expandable
                  showDuration={showDuration}
                  showAttempts={showAttempts}
                  showProgress={showProgress}
                />
              </Box>
            ) : null}
          </Item>
        );
      })}
      {operations.length === 0 ? <Text dimColor>No operations</Text> : null}
    </Root>
  );
}

export interface OperationTreeProps
  extends Omit<OperationListProps, "expandable"> {
  readonly expanded?: readonly string[];
  readonly defaultExpanded?: readonly string[];
  readonly onExpandedChange?: (
    expanded: readonly string[],
  ) => void | Promise<void>;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void | Promise<void>;
}

export function OperationTree({
  id = "operation-tree",
  operations,
  expanded,
  defaultExpanded = operations.map((operation) => operation.id),
  onExpandedChange,
  value,
  defaultValue,
  onValueChange,
  slots,
  slotProps,
  ...props
}: OperationTreeProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const [internalExpanded, setInternalExpanded] = useState(
    () => new Set(defaultExpanded),
  );
  const resolvedExpanded = useMemo(
    () => new Set(expanded ?? internalExpanded),
    [expanded, internalExpanded],
  );
  const allRows = useMemo(() => {
    const rows: {
      readonly operation: OperationSnapshot;
      readonly depth: number;
      readonly key: string;
      readonly parentKey?: string;
    }[] = [];
    const visit = (
      items: readonly OperationSnapshot[],
      depth: number,
      parentKey?: string,
    ) => {
      for (const [index, operation] of items.entries()) {
        const key = `${parentKey ?? id}/${index}:${operation.id}`;
        rows.push({ operation, depth, key, parentKey });
        if (
          operation.children.length > 0 &&
          (app.mode !== "interactive" ||
            resolvedExpanded.has(key) ||
            resolvedExpanded.has(operation.id))
        ) {
          visit(operation.children, depth + 1, key);
        }
      }
    };
    visit(operations, 0);
    return rows;
  }, [app.mode, id, operations, resolvedExpanded]);
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? allRows[0]?.key ?? "",
  );
  const selected = value ?? internalValue;
  const selectedIndex = Math.max(
    0,
    allRows.findIndex(
      (row) => row.key === selected || row.operation.id === selected,
    ),
  );
  const [active, setActive] = useState(selectedIndex);
  const { focused } = useFocusable(
    useMemo(
      () => ({
        id,
        hidden: false,
        disabled: false,
        role: "tree",
        label: "Operation tree",
      }),
      [id],
    ),
  );
  useEffect(() => setActive(selectedIndex), [selectedIndex]);
  const select = async (index: number) => {
    const row = allRows[index];
    if (!row) return;
    setActive(index);
    if (value === undefined) setInternalValue(row.key);
    await onValueChange?.(row.key);
  };
  const setExpanded = async (next: Set<string>) => {
    if (expanded === undefined) setInternalExpanded(next);
    await onExpandedChange?.(Object.freeze([...next]));
  };
  const toggle = async (row: (typeof allRows)[number], next?: boolean) => {
    if (row.operation.children.length === 0) return;
    const values = new Set(resolvedExpanded);
    const isExpanded = values.has(row.key) || values.has(row.operation.id);
    const shouldExpand = next ?? !isExpanded;
    values.delete(row.operation.id);
    if (shouldExpand) values.add(row.key);
    else values.delete(row.key);
    await setExpanded(values);
  };
  useTerminalInput(
    async (_input, key) => {
      const row = allRows[active];
      if (key.upArrow) {
        await select(Math.max(0, active - 1));
        return true;
      }
      if (key.downArrow) {
        await select(Math.min(allRows.length - 1, active + 1));
        return true;
      }
      if (key.rightArrow && row) {
        await toggle(row, true);
        return true;
      }
      if (key.leftArrow && row) {
        if (
          resolvedExpanded.has(row.key) ||
          resolvedExpanded.has(row.operation.id)
        ) {
          await toggle(row, false);
        } else if (row.parentKey) {
          await select(
            allRows.findIndex((candidate) => candidate.key === row.parentKey),
          );
        }
        return true;
      }
      if (key.return && row) {
        await toggle(row);
        await select(active);
        return true;
      }
      return false;
    },
    { enabled: focused && allRows.length > 0, priority: 1_650 },
  );
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        role: "tree" as const,
        label: "Operation tree",
        valueText: selected,
      }),
      [id, selected],
    ),
  );
  const Root = slots?.root ?? Box;
  const Item = slots?.item ?? Box;
  const Title = slots?.title ?? Text;
  const Metadata = slots?.metadata ?? Text;
  const state = { focused, empty: allRows.length === 0 };
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      {allRows.map((row, index) => {
        const isExpanded =
          resolvedExpanded.has(row.key) ||
          resolvedExpanded.has(row.operation.id);
        return (
          <Item
            key={row.key}
            flexDirection="column"
            marginLeft={row.depth * 2}
            {...resolveSlotProps(slotProps?.item, state, theme)}
          >
            <Title
              bold={focused && index === active}
              {...resolveSlotProps(slotProps?.title, state, theme)}
            >
              <OperationSemantic
                operation={row.operation}
                tree
                expanded={
                  row.operation.children.length > 0 ? isExpanded : undefined
                }
                prefix={`${id}:${row.key}`}
              />
              {focused && index === active ? "> " : "  "}
              {row.operation.children.length > 0
                ? isExpanded
                  ? app.capabilities.unicode
                    ? "▾ "
                    : "- "
                  : app.capabilities.unicode
                    ? "▸ "
                    : "+ "
                : "  "}
              [{statusMarkers[row.operation.status]}] {row.operation.title}
              {props.showAttempts && row.operation.attempt > 0
                ? ` (attempt ${row.operation.attempt})`
                : ""}
              {props.showDuration && duration(row.operation)
                ? ` ${duration(row.operation)}`
                : ""}
            </Title>
            {props.showProgress !== false && row.operation.progress ? (
              <Metadata
                dimColor
                {...resolveSlotProps(slotProps?.metadata, state, theme)}
              >
                {row.operation.progress.current}
                {row.operation.progress.total
                  ? `/${row.operation.progress.total}`
                  : ""}
                {row.operation.progress.message
                  ? ` ${row.operation.progress.message}`
                  : ""}
              </Metadata>
            ) : null}
          </Item>
        );
      })}
      {allRows.length === 0 ? <Text dimColor>No operations</Text> : null}
    </Root>
  );
}

export interface SplashScreenProps {
  readonly id?: string;
  readonly logo?: string | readonly string[];
  readonly title: string;
  readonly message?: string;
  readonly progress?: number;
  readonly status?: string;
}

export function SplashScreen({
  id = "splash",
  logo,
  title,
  message,
  progress,
  status,
}: SplashScreenProps): ReactNode {
  const app = useApp();
  const value =
    progress === undefined ? undefined : Math.min(1, Math.max(0, progress));
  useSemanticNode(
    useMemo(
      () => ({
        key: id,
        id,
        role:
          progress === undefined
            ? ("status" as const)
            : ("progressbar" as const),
        label: title,
        description: message,
        valueText: value === undefined ? status : `${Math.round(value * 100)}%`,
      }),
      [id, message, status, title, value, progress],
    ),
  );
  const logoLines = typeof logo === "string" ? logo.split("\n") : logo;
  const logoOccurrences = new Map<string, number>();
  const logoEntries = logoLines?.map((line) => {
    const occurrence = logoOccurrences.get(line) ?? 0;
    logoOccurrences.set(line, occurrence + 1);
    return { key: `${line}:${occurrence}`, line };
  });
  const width = 20;
  const filled = value === undefined ? 0 : Math.round(value * width);
  return (
    <Box flexDirection="column" alignItems="center">
      {logoEntries?.map((entry) => (
        <Text key={entry.key}>{entry.line}</Text>
      ))}
      <Text bold>{title}</Text>
      {message ? <Text>{message}</Text> : null}
      {value !== undefined ? (
        <Text>
          [{(app.capabilities.unicode ? "█" : "#").repeat(filled)}
          {" ".repeat(width - filled)}] {Math.round(value * 100)}%
        </Text>
      ) : null}
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}

export interface HelpOverlayProps {
  readonly id?: string;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void | Promise<void>;
  readonly hotkey?: string;
  readonly title?: string;
}

export function HelpOverlay({
  id = "help",
  open,
  defaultOpen = false,
  onOpenChange,
  hotkey = "f1",
  title = "Keyboard help",
}: HelpOverlayProps): ReactNode {
  const app = useApp();
  const [internal, setInternal] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const visible = open ?? internal;
  const setOpen = async (next: boolean) => {
    if (open === undefined) setInternal(next);
    await onOpenChange?.(next);
  };
  useHotkey(hotkey, () => setOpen(!visible), {
    scope: "application",
    priority: 10_000,
    title,
    enabled: () => !visible,
  });
  useHotkey(hotkey, () => setOpen(false), {
    scope: "overlay",
    scopeId: id,
    priority: 10_000,
    title: `Close ${title}`,
    enabled: () => visible,
  });
  useTerminalInput(
    async (input, key) => {
      const pressed = normalizeHotkeyNotation(normalizeTerminalKey(input, key));
      if (pressed !== normalizeHotkeyNotation(hotkey)) return false;
      await setOpen(false);
      return true;
    },
    { enabled: visible, layerId: id, priority: 100_000 },
  );
  const [, refresh] = useState(0);
  useEffect(() => {
    const disposable = app.commands.observeRegistry(() =>
      refresh((value) => value + 1),
    );
    return () => {
      void disposable.dispose();
    };
  }, [app.commands]);
  const commands = app.commands
    .list()
    .filter((command) =>
      `${command.title} ${command.description ?? ""} ${command.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  return (
    <Dialog id={id} open={visible} onOpenChange={setOpen}>
      <Dialog.Content label={title}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>
          Search registered commands and their hotkeys.
        </Dialog.Description>
        <TextInput
          id={`${id}:search`}
          label="Search help"
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
        <Box flexDirection="column">
          {commands.map((command) => (
            <Text key={command.id}>
              {command.title}
              {command.hotkeys?.length
                ? ` — ${command.hotkeys.join(", ")}`
                : ""}
              <Text dimColor> ({command.id})</Text>
            </Text>
          ))}
          {commands.length === 0 ? (
            <Text dimColor>No commands found</Text>
          ) : null}
        </Box>
        <Dialog.Actions>
          <Dialog.Cancel>Close</Dialog.Cancel>
        </Dialog.Actions>
      </Dialog.Content>
    </Dialog>
  );
}
