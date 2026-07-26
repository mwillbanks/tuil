import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  escapeTerminalControlCharacters,
  useSemanticNode,
  useTerminalInput,
} from "@mwillbanks/tuil-ink";
import {
  resolveSlotProps,
  type SlottedComponentProps,
  useTheme,
} from "@mwillbanks/tuil-theme";
import {
  fitTerminalText,
  getVisibleTerminalIndexes,
  useTerminalVirtualizer,
} from "@mwillbanks/tuil-virtual";
import { Box, type BoxProps, Text, type TextProps } from "ink";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

function SemanticNode(props: {
  readonly id: string;
  readonly role:
    | "table"
    | "row"
    | "cell"
    | "listbox"
    | "option"
    | "tree"
    | "treeitem"
    | "status"
    | "button";
  readonly label: string;
  readonly description?: string;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
  readonly valueText?: string;
  readonly metadata?: CommonComponentProps;
}): null {
  useSemanticNode(
    useMemo(
      () => ({
        key: props.id,
        id: props.id,
        testId: props.metadata?.testId,
        role: props.metadata?.role ?? props.role,
        label: props.metadata?.label ?? props.label,
        description: props.metadata?.description ?? props.description,
        selected: props.metadata?.selected ?? props.selected,
        checked: props.metadata?.checked,
        expanded: props.metadata?.expanded ?? props.expanded,
        disabled: props.metadata?.disabled ?? props.disabled,
        readOnly: props.metadata?.readOnly,
        valueText: props.metadata?.valueText ?? props.valueText,
      }),
      [props],
    ),
  );
  return null;
}

export interface JsonViewerNode {
  readonly path: string;
  readonly key: string;
  readonly depth: number;
  readonly type:
    | "object"
    | "array"
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "undefined"
    | "bigint"
    | "circular";
  readonly value?: string;
  readonly expandable: boolean;
}

function jsonType(value: unknown): JsonViewerNode["type"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "bigint") return "bigint";
  return "string";
}

function displayJsonValue(
  value: unknown,
  type: JsonViewerNode["type"],
): string {
  if (type === "string") return JSON.stringify(String(value));
  if (type === "undefined") return "undefined";
  if (type === "bigint") return `${String(value)}n`;
  if (type === "null") return "null";
  return String(value);
}

export interface FlattenJsonOptions {
  readonly expandedPaths: ReadonlySet<string>;
  readonly maxDepth: number;
  readonly sortKeys: boolean;
  readonly redactKeys: RegExp;
}

function jsonKeys(value: object, type: "array" | "object"): string[] {
  try {
    return type === "array"
      ? Array.from(
          { length: (value as readonly unknown[]).length },
          (_entry, index) => String(index),
        )
      : Object.keys(value);
  } catch {
    return [];
  }
}

function readJsonProperty(
  value: object,
  key: string,
): { readonly value: unknown } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return { value: "[Inaccessible]" };
    if ("value" in descriptor) return { value: descriptor.value };
    return {
      value:
        descriptor.get || descriptor.set
          ? `[${descriptor.get ? "Getter" : ""}${descriptor.get && descriptor.set ? "/" : ""}${descriptor.set ? "Setter" : ""}]`
          : "[Inaccessible]",
    };
  } catch {
    return { value: "[Inaccessible]" };
  }
}

export function flattenJson(
  value: unknown,
  options: FlattenJsonOptions,
): readonly JsonViewerNode[] {
  const nodes: JsonViewerNode[] = [];
  const ancestors = new WeakSet<object>();
  const visit = (
    current: unknown,
    key: string,
    path: string,
    depth: number,
    redacted: boolean,
  ) => {
    if (redacted) {
      nodes.push({
        path,
        key,
        depth,
        type: "string",
        value: "[REDACTED]",
        expandable: false,
      });
      return;
    }
    let type = jsonType(current);
    if (
      current !== null &&
      typeof current === "object" &&
      ancestors.has(current)
    ) {
      type = "circular";
    }
    const keys =
      type === "array"
        ? jsonKeys(current as object, "array")
        : type === "object"
          ? jsonKeys(current as object, "object")
          : [];
    if (options.sortKeys && type === "object") {
      keys.sort((left, right) => left.localeCompare(right));
    }
    const expandable =
      (type === "array" || type === "object") && keys.length > 0;
    nodes.push({
      path,
      key,
      depth,
      type,
      value:
        type === "array"
          ? `[${keys.length}]`
          : type === "object"
            ? `{${keys.length}}`
            : type === "circular"
              ? "[Circular]"
              : displayJsonValue(current, type),
      expandable,
    });
    if (
      !expandable ||
      depth >= options.maxDepth ||
      !options.expandedPaths.has(path)
    ) {
      return;
    }
    ancestors.add(current as object);
    for (const childKey of keys) {
      options.redactKeys.lastIndex = 0;
      const childRedacted = options.redactKeys.test(childKey);
      const child = childRedacted
        ? undefined
        : readJsonProperty(current as object, childKey).value;
      visit(
        child,
        childKey,
        `${path}/${childKey.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        depth + 1,
        childRedacted,
      );
    }
    ancestors.delete(current as object);
  };
  visit(value, "$", "$", 0, false);
  return Object.freeze(nodes);
}

type JsonViewerSlots = {
  root: BoxProps;
  viewport: BoxProps;
  item: TextProps;
  empty: TextProps;
  overflow: TextProps;
};

export interface JsonViewerProps
  extends CommonComponentProps,
    SlottedComponentProps<
      JsonViewerSlots,
      {
        readonly focused: boolean;
        readonly activePath?: string;
        readonly expanded: ReadonlySet<string>;
      }
    > {
  readonly value: unknown;
  readonly expandedPaths?: readonly string[];
  readonly defaultExpandedPaths?: readonly string[];
  readonly onExpandedChange?: (
    paths: readonly string[],
  ) => void | Promise<void>;
  readonly defaultExpandedDepth?: number;
  readonly maxDepth?: number;
  readonly sortKeys?: boolean;
  readonly redactKeys?: RegExp;
  readonly height?: number;
  readonly width?: number;
  readonly staticLimit?: number;
  readonly autoFocus?: boolean;
}

function defaultJsonExpandedPaths(
  value: unknown,
  depthLimit: number,
  maxDepth: number,
): readonly string[] {
  const paths: string[] = [];
  const ancestors = new WeakSet<object>();
  const visit = (current: unknown, path: string, depth: number) => {
    if (
      depth >= depthLimit ||
      depth >= maxDepth ||
      current === null ||
      typeof current !== "object" ||
      ancestors.has(current)
    ) {
      return;
    }
    const type = Array.isArray(current) ? "array" : "object";
    const keys = jsonKeys(current, type);
    if (keys.length === 0) return;
    paths.push(path);
    ancestors.add(current);
    for (const key of keys) {
      const child = readJsonProperty(current, key).value;
      visit(
        child,
        `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        depth + 1,
      );
    }
    ancestors.delete(current);
  };
  visit(value, "$", 0);
  return Object.freeze(paths);
}

export function JsonViewer({
  value,
  expandedPaths,
  defaultExpandedPaths = ["$"],
  onExpandedChange,
  defaultExpandedDepth = 1,
  maxDepth = 32,
  sortKeys = true,
  redactKeys = /password|passphrase|secret|token|private[-_]?key|api[-_]?key/i,
  height = 15,
  width = 100,
  staticLimit = 2_000,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  readOnly = false,
  ...props
}: JsonViewerProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const [internalExpanded, setInternalExpanded] = useState(
    () =>
      new Set([
        ...defaultJsonExpandedPaths(value, defaultExpandedDepth, maxDepth),
        ...defaultExpandedPaths,
      ]),
  );
  const expanded = useMemo(
    () => new Set(expandedPaths ?? internalExpanded),
    [expandedPaths, internalExpanded],
  );
  const nodes = useMemo(
    () =>
      flattenJson(value, {
        expandedPaths: expanded,
        maxDepth,
        sortKeys,
        redactKeys,
      }),
    [expanded, maxDepth, redactKeys, sortKeys, value],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive,
        hidden: false,
        role: "tree" as const,
        label: props.label ?? "JSON viewer",
      }),
      [disabled, id, interactive, props.label],
    ),
  );
  useEffect(() => {
    if (autoFocus && interactive) focus();
  }, [autoFocus, focus, interactive]);
  const move = useCallback(
    (next: number) => {
      const target = Math.min(nodes.length - 1, Math.max(0, next));
      setActiveIndex(Math.max(0, target));
      if (target < offset) setOffset(target);
      if (target >= offset + height) setOffset(target - height + 1);
    },
    [height, nodes.length, offset],
  );
  const toggle = useCallback(
    async (node: JsonViewerNode | undefined) => {
      if (!node?.expandable || readOnly) return;
      const next = new Set(expanded);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      if (expandedPaths === undefined) setInternalExpanded(next);
      await onExpandedChange?.(Object.freeze([...next]));
    },
    [expanded, expandedPaths, onExpandedChange, readOnly],
  );
  useTerminalInput(
    async (input, key) => {
      const node = nodes[activeIndex];
      if (key.upArrow) {
        move(activeIndex - 1);
        return true;
      }
      if (key.downArrow) {
        move(activeIndex + 1);
        return true;
      }
      if (key.pageUp) {
        move(activeIndex - height);
        return true;
      }
      if (key.pageDown) {
        move(activeIndex + height);
        return true;
      }
      if (key.rightArrow && node?.expandable && !expanded.has(node.path)) {
        await toggle(node);
        return true;
      }
      if (key.leftArrow && node?.expandable && expanded.has(node.path)) {
        await toggle(node);
        return true;
      }
      if (key.leftArrow && node) {
        const parentPath = node.path.slice(0, node.path.lastIndexOf("/"));
        move(nodes.findIndex((candidate) => candidate.path === parentPath));
        return true;
      }
      if (key.return || input === " ") {
        await toggle(node);
        return true;
      }
      if (key.home) {
        move(0);
        return true;
      }
      if (key.end) {
        move(nodes.length - 1);
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_520 },
  );
  const range = useTerminalVirtualizer({
    count: nodes.length,
    viewportSize: height,
    scrollOffset: offset,
    overscan: 0,
  });
  const indexes = interactive
    ? getVisibleTerminalIndexes(range)
    : [...nodes.keys()].slice(0, Math.max(0, staticLimit));
  const state = {
    focused,
    activePath: nodes[activeIndex]?.path,
    expanded,
  };
  const Root = slots?.root ?? Box;
  const Viewport = slots?.viewport ?? Box;
  const Item = slots?.item ?? Text;
  const Overflow = slots?.overflow ?? Text;
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticNode
        id={id}
        role="tree"
        label={props.label ?? "JSON viewer"}
        valueText={`${nodes.length} visible nodes`}
        metadata={{ ...props, disabled, readOnly }}
      />
      <Viewport
        flexDirection="column"
        height={interactive ? height : undefined}
        overflow="hidden"
        {...resolveSlotProps(slotProps?.viewport, state, theme)}
      >
        {indexes.map((index) => {
          const node = nodes[index];
          if (!node) return null;
          const active = focused && index === activeIndex;
          const marker = node.expandable
            ? expanded.has(node.path)
              ? app.capabilities.unicode
                ? "▾"
                : "-"
              : app.capabilities.unicode
                ? "▸"
                : "+"
            : " ";
          return (
            <Item
              key={node.path}
              inverse={active}
              bold={active}
              color={
                node.type === "string"
                  ? theme.colors.success.foreground
                  : node.type === "number" || node.type === "bigint"
                    ? theme.colors.info.foreground
                    : node.type === "circular"
                      ? theme.colors.warning.foreground
                      : undefined
              }
              {...resolveSlotProps(slotProps?.item, state, theme)}
            >
              <SemanticNode
                id={`${id}:node:${node.path}`}
                role="treeitem"
                label={`${node.key}: ${node.value ?? node.type}`}
                selected={active}
                expanded={node.expandable ? expanded.has(node.path) : undefined}
              />
              {fitTerminalText(
                `${"  ".repeat(node.depth)}${marker} ${escapeTerminalControlCharacters(node.key)}: ${escapeTerminalControlCharacters(node.value ?? "")}`,
                width,
              )}
            </Item>
          );
        })}
      </Viewport>
      {!interactive && nodes.length > indexes.length ? (
        <Overflow
          dimColor
          {...resolveSlotProps(slotProps?.overflow, state, theme)}
        >
          … {nodes.length - indexes.length} additional nodes omitted
        </Overflow>
      ) : null}
    </Root>
  );
}
