import {
  type Disposable,
  type TerminalCapabilities,
  toDisposable,
} from "@mwillbanks/tuil-core";
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

export type ColorScheme = "light" | "dark" | "auto";
export type SpacingToken = "none" | "xs" | "sm" | "md" | "lg" | "xl";

export interface SemanticColor {
  readonly foreground: string;
  readonly background: string;
  readonly border: string;
}

export interface ComponentTheme {
  readonly defaultProps?: Readonly<Record<string, unknown>>;
  readonly variants?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly sizes?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface Theme {
  readonly id: string;
  readonly colorScheme: ColorScheme;
  readonly colors: {
    readonly background: string;
    readonly foreground: string;
    readonly muted: string;
    readonly subtle: string;
    readonly border: string;
    readonly primary: SemanticColor;
    readonly secondary: SemanticColor;
    readonly success: SemanticColor;
    readonly warning: SemanticColor;
    readonly danger: SemanticColor;
    readonly info: SemanticColor;
  };
  readonly spacing: Record<SpacingToken, number>;
  readonly borders: {
    readonly none: readonly [string, string, string, string, string, string];
    readonly single: readonly [string, string, string, string, string, string];
    readonly round: readonly [string, string, string, string, string, string];
    readonly double: readonly [string, string, string, string, string, string];
  };
  readonly typography: {
    readonly headingBold: boolean;
    readonly codeColor: string;
  };
  readonly icons: {
    readonly success: string;
    readonly warning: string;
    readonly error: string;
    readonly pending: string;
  };
  readonly motion: {
    readonly enabled: boolean;
    readonly spinnerFrames: readonly string[];
    readonly interval: number;
  };
  readonly components: Readonly<Record<string, ComponentTheme>>;
}

type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [TKey in keyof T]?: DeepPartial<T[TKey]> }
    : T;

export type ThemeInput = DeepPartial<Theme>;

export interface ThemeRegistryEntry {
  readonly theme: Theme;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export class ThemeRegistry {
  readonly #entries = new Map<string, ThemeRegistryEntry>();
  #defaultId?: string;

  register(
    entry: ThemeRegistryEntry,
    options: { readonly default?: boolean } = {},
  ): Disposable {
    if (this.#entries.has(entry.theme.id)) {
      throw new Error(`Theme "${entry.theme.id}" is already registered`);
    }
    const registered = Object.freeze({
      ...entry,
      tags: Object.freeze([...new Set(entry.tags ?? [])]),
    });
    this.#entries.set(entry.theme.id, registered);
    if (options.default || this.#defaultId === undefined) {
      this.#defaultId = entry.theme.id;
    }
    return toDisposable(() => {
      if (this.#entries.get(entry.theme.id) !== registered) return;
      this.#entries.delete(entry.theme.id);
      if (this.#defaultId === entry.theme.id) {
        this.#defaultId = this.list()[0]?.theme.id;
      }
    });
  }

  get(id: string): ThemeRegistryEntry | undefined {
    return this.#entries.get(id);
  }

  resolve(id?: string): Theme {
    const selected = id ?? this.#defaultId;
    const theme = selected ? this.#entries.get(selected)?.theme : undefined;
    if (!theme) {
      throw new Error(
        selected
          ? `Theme "${selected}" is not registered`
          : "No theme is registered",
      );
    }
    return theme;
  }

  list(options: { readonly tag?: string } = {}): readonly ThemeRegistryEntry[] {
    return [...this.#entries.values()]
      .filter((entry) => !options.tag || entry.tags?.includes(options.tag))
      .sort((left, right) => left.theme.id.localeCompare(right.theme.id));
  }
}

const semantic = (
  foreground: string,
  background: string,
  border = foreground,
): SemanticColor => ({ foreground, background, border });

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export const defaultTheme: Theme = deepFreeze({
  id: "default-dark",
  colorScheme: "dark",
  colors: {
    background: "black",
    foreground: "white",
    muted: "gray",
    subtle: "gray",
    border: "gray",
    primary: semantic("cyan", "black"),
    secondary: semantic("magenta", "black"),
    success: semantic("green", "black"),
    warning: semantic("yellow", "black"),
    danger: semantic("red", "black"),
    info: semantic("blue", "black"),
  },
  spacing: { none: 0, xs: 0, sm: 1, md: 2, lg: 3, xl: 4 },
  borders: {
    none: ["", "", "", "", "", ""],
    single: ["─", "│", "┌", "┐", "└", "┘"],
    round: ["─", "│", "╭", "╮", "╰", "╯"],
    double: ["═", "║", "╔", "╗", "╚", "╝"],
  },
  typography: { headingBold: true, codeColor: "cyan" },
  icons: { success: "✓", warning: "!", error: "×", pending: "…" },
  motion: {
    enabled: true,
    spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    interval: 80,
  },
  components: {},
} satisfies Theme);

function isMergeableRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecord<T extends object>(base: T, override?: Partial<T>): T {
  if (!override) {
    return base;
  }
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] =
      isMergeableRecord(value) && isMergeableRecord(current)
        ? mergeRecord(current, value)
        : value;
  }
  return result as T;
}

export function createTheme(...inputs: readonly ThemeInput[]): Theme {
  let theme = defaultTheme;
  for (const input of inputs) {
    theme = mergeRecord(theme, input as unknown as Partial<Theme>) as Theme;
  }
  return deepFreeze(theme);
}

export const defaultLightTheme: Theme = createTheme(defaultTheme, {
  id: "default-light",
  colorScheme: "light",
  colors: {
    background: "white",
    foreground: "black",
    muted: "gray",
    subtle: "gray",
    border: "gray",
    primary: semantic("blue", "white"),
    secondary: semantic("magenta", "white"),
    success: semantic("green", "white"),
    warning: semantic("yellow", "white"),
    danger: semantic("red", "white"),
    info: semantic("cyan", "white"),
  },
  typography: { headingBold: true, codeColor: "blue" },
});

export function createDefaultThemeRegistry(): ThemeRegistry {
  const registry = new ThemeRegistry();
  registry.register(
    {
      theme: defaultTheme,
      description: "Default dark terminal theme",
      tags: ["default", "dark"],
    },
    { default: true },
  );
  registry.register({
    theme: defaultLightTheme,
    description: "Default light terminal theme",
    tags: ["default", "light"],
  });
  return registry;
}

export function normalizeTheme(
  theme: Theme,
  capabilities: TerminalCapabilities,
): Theme {
  if (capabilities.colorDepth === 1) {
    const monochrome = semantic("white", "black", "white");
    return createTheme(theme, {
      colors: {
        background: "black",
        foreground: "white",
        muted: "white",
        subtle: "white",
        border: "white",
        primary: monochrome,
        secondary: monochrome,
        success: monochrome,
        warning: monochrome,
        danger: monochrome,
        info: monochrome,
      },
      motion: { enabled: false, spinnerFrames: ["-", "\\", "|", "/"] },
      borders: capabilities.unicode
        ? undefined
        : {
            single: ["-", "|", "+", "+", "+", "+"],
            round: ["-", "|", "+", "+", "+", "+"],
            double: ["=", "|", "+", "+", "+", "+"],
          },
      icons: capabilities.unicode
        ? undefined
        : { success: "OK", warning: "!", error: "X", pending: "..." },
    });
  }
  if (!capabilities.unicode) {
    return createTheme(theme, {
      borders: {
        single: ["-", "|", "+", "+", "+", "+"],
        round: ["-", "|", "+", "+", "+", "+"],
        double: ["=", "|", "+", "+", "+", "+"],
      },
      motion: { spinnerFrames: ["-", "\\", "|", "/"] },
      icons: { success: "OK", warning: "!", error: "X", pending: "..." },
    });
  }
  if (capabilities.reducedMotion) {
    return createTheme(theme, { motion: { enabled: false } });
  }
  return theme;
}

export type SlotMap = Record<string, object>;
export type SlotComponents<TSlots extends SlotMap> = {
  [TSlot in keyof TSlots]: React.ComponentType<TSlots[TSlot]>;
};
export type SlotPropFactory<TProps extends object, TState> = (
  state: TState & { readonly theme: Theme },
) => Partial<TProps>;
export type SlotProps<TSlots extends SlotMap, TState = object> = {
  [TSlot in keyof TSlots]:
    | Partial<TSlots[TSlot]>
    | SlotPropFactory<TSlots[TSlot], TState>;
};
export interface SlottedComponentProps<
  TSlots extends SlotMap,
  TState = object,
> {
  readonly slots?: Partial<SlotComponents<TSlots>>;
  readonly slotProps?: Partial<SlotProps<TSlots, TState>>;
  readonly unstyled?: boolean;
  readonly variant?: string;
  readonly size?: "sm" | "md" | "lg";
}

export function resolveSlotProps<TProps extends object, TState>(
  props: Partial<TProps> | SlotPropFactory<TProps, TState> | undefined,
  state: TState,
  theme: Theme,
): Partial<TProps> {
  return typeof props === "function"
    ? props({ ...state, theme })
    : (props ?? {});
}

export type TerminalStyleProps = Record<string, string | number | boolean>;

const utilityCache = new WeakMap<Theme, Map<string, TerminalStyleProps>>();

export function compileUtilities(
  className: string,
  theme: Theme,
  state: Readonly<Record<string, boolean>> = {},
): TerminalStyleProps {
  const stateKey = Object.entries(state)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .sort()
    .join(",");
  const cacheKey = `${stateKey}:${className}`;
  const themeCache = utilityCache.get(theme) ?? new Map();
  if (!utilityCache.has(theme)) {
    utilityCache.set(theme, themeCache);
  }
  const cached = themeCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const style: TerminalStyleProps = {};
  for (const token of className.split(/\s+/).filter(Boolean)) {
    const stateMatch = token.match(/^([a-z]+):(.+)$/);
    if (stateMatch) {
      const [, condition, nested] = stateMatch;
      if (condition && nested && state[condition]) {
        Object.assign(style, compileUtilities(nested, theme, state));
      }
      continue;
    }
    if (token === "row") style["flexDirection"] = "row";
    else if (token === "column") style["flexDirection"] = "column";
    else if (token === "grow") style["flexGrow"] = 1;
    else if (token === "bold") style["bold"] = true;
    else if (token === "dim") style["dimColor"] = true;
    else if (token === "underline") style["underline"] = true;
    else if (token === "hidden") style["display"] = "none";
    else if (token === "border") style["borderStyle"] = "single";
    else if (token.startsWith("p-")) {
      const spacing = token.slice(2) as SpacingToken;
      if (spacing in theme.spacing) style["padding"] = theme.spacing[spacing];
    } else if (token.startsWith("gap-")) {
      const spacing = token.slice(4) as SpacingToken;
      if (spacing in theme.spacing) style["gap"] = theme.spacing[spacing];
    } else if (token.startsWith("text-")) {
      const color = token.slice(5);
      const value = theme.colors[color as keyof Theme["colors"]];
      style["color"] = typeof value === "string" ? value : value?.foreground;
    }
  }
  const compiled = Object.freeze(style);
  themeCache.set(cacheKey, compiled);
  return compiled;
}

export function resolveComponentProps(
  componentName: string,
  options: {
    readonly variant?: string;
    readonly size?: "sm" | "md" | "lg";
    readonly unstyled?: boolean;
    readonly className?: string;
  },
  state: Readonly<Record<string, boolean>>,
  theme: Theme,
): TerminalStyleProps {
  const component = theme.components[componentName];
  return Object.freeze({
    ...(options.unstyled ? {} : component?.defaultProps),
    ...(options.unstyled || !options.variant
      ? {}
      : component?.variants?.[options.variant]),
    ...(options.unstyled || !options.size
      ? {}
      : component?.sizes?.[options.size]),
    ...(options.className
      ? compileUtilities(options.className, theme, state)
      : {}),
  }) as TerminalStyleProps;
}

export type ThemeFactory = (base: Theme) => Theme;

export class ThemeController {
  readonly #capabilities: TerminalCapabilities;
  readonly #observers = new Set<() => void>();
  #theme: Theme;

  constructor(theme: Theme, capabilities: TerminalCapabilities) {
    this.#capabilities = capabilities;
    this.#theme = normalizeTheme(theme, capabilities);
  }

  get(): Theme {
    return this.#theme;
  }

  set(theme: Theme | ThemeFactory): Theme {
    const selected = typeof theme === "function" ? theme(this.#theme) : theme;
    const next = normalizeTheme(selected, this.#capabilities);
    if (next === this.#theme) return next;
    this.#theme = next;
    for (const observer of this.#observers) observer();
    return next;
  }

  observe(observer: () => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }
}

const ThemeContext = createContext<Theme>(defaultTheme);

function ControlledThemeProvider(props: {
  readonly controller: ThemeController;
  readonly children?: ReactNode;
}): ReactNode {
  const subscribe = useCallback(
    (observer: () => void) => props.controller.observe(observer),
    [props.controller],
  );
  const getSnapshot = useCallback(
    () => props.controller.get(),
    [props.controller],
  );
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return createElement(ThemeContext.Provider, { value }, props.children);
}

function StaticThemeProvider(props: {
  readonly theme: Theme | ThemeFactory;
  readonly children?: ReactNode;
}): ReactNode {
  const parent = useContext(ThemeContext);
  const value = useMemo(
    () =>
      typeof props.theme === "function" ? props.theme(parent) : props.theme,
    [parent, props.theme],
  );
  return createElement(ThemeContext.Provider, { value }, props.children);
}

export function ThemeProvider(props: {
  readonly theme: Theme | ThemeFactory | ThemeController;
  readonly children?: ReactNode;
}): ReactNode {
  return props.theme instanceof ThemeController
    ? createElement(
        ControlledThemeProvider,
        { controller: props.theme },
        props.children,
      )
    : createElement(
        StaticThemeProvider,
        { theme: props.theme },
        props.children,
      );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
