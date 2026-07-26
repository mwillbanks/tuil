import { useApp } from "@mwillbanks/tuil";
import { useFocusable } from "@mwillbanks/tuil-focus";
import {
  type CommonComponentProps,
  escapeTerminalControlCharacters,
  TerminalSemanticNode as SemanticNode,
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
  useRef,
  useState,
} from "react";

export type LogLevel = "trace" | "debug" | "info" | "warning" | "error";

export interface LogEntry {
  readonly id: string;
  readonly message: string;
  readonly level?: LogLevel;
  readonly timestamp?: string | number | Date;
}

type LogViewerSlots = {
  root: BoxProps;
  viewport: BoxProps;
  line: TextProps;
  status: TextProps;
  empty: TextProps;
};

export interface LogViewerProps
  extends CommonComponentProps,
    SlottedComponentProps<
      LogViewerSlots,
      {
        readonly focused: boolean;
        readonly following: boolean;
        readonly offset: number;
      }
    > {
  readonly lines: readonly (string | LogEntry)[];
  readonly height?: number;
  readonly width?: number;
  readonly maxLines?: number;
  readonly filter?: string;
  readonly follow?: boolean;
  readonly defaultFollow?: boolean;
  readonly onFollowChange?: (follow: boolean) => void | Promise<void>;
  readonly showTimestamp?: boolean;
  readonly staticLimit?: number;
  readonly autoFocus?: boolean;
}

function normalizeLogEntries(
  lines: readonly (string | LogEntry)[],
  maxLines: number,
): readonly LogEntry[] {
  const limit = Math.max(0, Math.floor(maxLines));
  if (limit === 0) return [];
  const newestFirst: LogEntry[] = [];
  for (
    let sourceIndex = lines.length - 1;
    sourceIndex >= 0 && newestFirst.length < limit;
    sourceIndex -= 1
  ) {
    const line = lines[sourceIndex];
    if (line === undefined) continue;
    const entry: LogEntry =
      typeof line === "string"
        ? {
            id: `line:${sourceIndex}`,
            message: line,
            level: "info",
          }
        : line;
    let end = entry.message.length;
    while (newestFirst.length < limit) {
      let separator = -1;
      for (let index = end - 1; index >= 0; index -= 1) {
        const character = entry.message[index];
        if (character === "\n" || character === "\r") {
          separator = index;
          break;
        }
      }
      const start = separator + 1;
      newestFirst.push({
        ...entry,
        id: `${entry.id}:${start}`,
        message: escapeTerminalControlCharacters(
          entry.message.slice(start, end),
        ),
      });
      if (separator < 0) break;
      end =
        entry.message[separator] === "\n" &&
        separator > 0 &&
        entry.message[separator - 1] === "\r"
          ? separator - 1
          : separator;
    }
  }
  return Object.freeze(newestFirst.reverse());
}

export function LogViewer({
  lines,
  height = 12,
  width = 100,
  maxLines = 10_000,
  filter = "",
  follow,
  defaultFollow = true,
  onFollowChange,
  showTimestamp = true,
  staticLimit = 1_000,
  autoFocus,
  slots,
  slotProps,
  disabled = false,
  ...props
}: LogViewerProps): ReactNode {
  const app = useApp();
  const theme = useTheme();
  const generated = useId();
  const id = props.id ?? generated;
  const interactive = app.mode === "interactive";
  const [internalFollow, setInternalFollow] = useState(defaultFollow);
  const [offset, setOffset] = useState(0);
  const following = follow ?? internalFollow;
  const normalized = useMemo(
    () => normalizeLogEntries(lines, maxLines),
    [lines, maxLines],
  );
  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query
      ? normalized.filter((entry) =>
          entry.message.toLowerCase().includes(query),
        )
      : normalized;
  }, [filter, normalized]);
  const maximumOffset = Math.max(0, filtered.length - height);
  const previousLength = useRef(filtered.length);
  useEffect(() => {
    if (following && filtered.length !== previousLength.current) {
      setOffset(maximumOffset);
    }
    previousLength.current = filtered.length;
  }, [filtered.length, following, maximumOffset]);
  const { focused, focus } = useFocusable(
    useMemo(
      () => ({
        id,
        disabled: disabled || !interactive,
        hidden: false,
        role: "status" as const,
        label: props.label ?? "Log viewer",
      }),
      [disabled, id, interactive, props.label],
    ),
  );
  useEffect(() => {
    if (autoFocus && interactive) focus();
  }, [autoFocus, focus, interactive]);
  const setFollowing = useCallback(
    async (value: boolean) => {
      if (follow === undefined) setInternalFollow(value);
      await onFollowChange?.(value);
      if (value) setOffset(maximumOffset);
    },
    [follow, maximumOffset, onFollowChange],
  );
  useTerminalInput(
    async (input, key) => {
      if (key.upArrow) {
        await setFollowing(false);
        setOffset((value) => Math.max(0, value - 1));
        return true;
      }
      if (key.downArrow) {
        const next = Math.min(maximumOffset, offset + 1);
        setOffset(next);
        if (next === maximumOffset) await setFollowing(true);
        return true;
      }
      if (key.pageUp) {
        await setFollowing(false);
        setOffset((value) => Math.max(0, value - height));
        return true;
      }
      if (key.pageDown) {
        const next = Math.min(maximumOffset, offset + height);
        setOffset(next);
        if (next === maximumOffset) await setFollowing(true);
        return true;
      }
      if (key.home) {
        await setFollowing(false);
        setOffset(0);
        return true;
      }
      if (key.end) {
        await setFollowing(true);
        return true;
      }
      if (input === " ") {
        await setFollowing(!following);
        return true;
      }
      return false;
    },
    { enabled: focused && !disabled, priority: 1_510 },
  );
  const range = useTerminalVirtualizer({
    count: filtered.length,
    viewportSize: height,
    scrollOffset: following ? maximumOffset : offset,
    overscan: 0,
  });
  const staticCount = Math.max(0, Math.floor(staticLimit));
  const indexes = interactive
    ? getVisibleTerminalIndexes(range)
    : staticCount === 0
      ? []
      : [...filtered.keys()].slice(-staticCount);
  const state = { focused, following, offset: range.offset };
  const Root = slots?.root ?? Box;
  const Viewport = slots?.viewport ?? Box;
  const Line = slots?.line ?? Text;
  const Status = slots?.status ?? Text;
  const Empty = slots?.empty ?? Text;
  return (
    <Root
      flexDirection="column"
      {...resolveSlotProps(slotProps?.root, state, theme)}
    >
      <SemanticNode
        id={id}
        role="status"
        label={props.label ?? "Log viewer"}
        valueText={`${filtered.length} lines, ${following ? "following" : "paused"}`}
        metadata={{ ...props, disabled }}
      />
      {filtered.length === 0 ? (
        <Empty dimColor {...resolveSlotProps(slotProps?.empty, state, theme)}>
          No log entries
        </Empty>
      ) : (
        <Viewport
          flexDirection="column"
          height={interactive ? height : undefined}
          overflow="hidden"
          {...resolveSlotProps(slotProps?.viewport, state, theme)}
        >
          {indexes.map((index) => {
            const entry = filtered[index];
            if (!entry) return null;
            const time =
              showTimestamp && entry.timestamp !== undefined
                ? entry.timestamp instanceof Date
                  ? entry.timestamp.toISOString()
                  : String(entry.timestamp)
                : "";
            const safeTime = escapeTerminalControlCharacters(time);
            const color =
              entry.level === "error"
                ? theme.colors.danger.foreground
                : entry.level === "warning"
                  ? theme.colors.warning.foreground
                  : entry.level === "debug" || entry.level === "trace"
                    ? theme.colors.muted
                    : undefined;
            return (
              <Line
                key={entry.id}
                color={color}
                {...resolveSlotProps(slotProps?.line, state, theme)}
              >
                {fitTerminalText(
                  `${safeTime ? `${safeTime} ` : ""}${entry.level ? `${entry.level.toUpperCase()} ` : ""}${entry.message}`,
                  width,
                )}
              </Line>
            );
          })}
        </Viewport>
      )}
      <Status dimColor {...resolveSlotProps(slotProps?.status, state, theme)}>
        {following ? "Following output" : "Paused"} · {filtered.length}/
        {normalized.length} visible · {normalized.length} retained
      </Status>
    </Root>
  );
}
