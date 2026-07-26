import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

export type HotkeyScope =
  | "application"
  | "route"
  | "focus-scope"
  | "component"
  | "overlay"
  | "dialog";

const scopePriority: Record<HotkeyScope, number> = {
  application: 0,
  route: 1,
  "focus-scope": 2,
  component: 3,
  overlay: 4,
  dialog: 5,
};

export interface TerminalKey {
  readonly name?: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly escape?: boolean;
  readonly return?: boolean;
  readonly tab?: boolean;
  readonly backspace?: boolean;
  readonly delete?: boolean;
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly leftArrow?: boolean;
  readonly rightArrow?: boolean;
  readonly pageUp?: boolean;
  readonly pageDown?: boolean;
  readonly home?: boolean;
  readonly end?: boolean;
}

export interface HotkeyMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly category?: string;
  readonly commandId?: string;
  readonly visibleInHelp?: boolean;
  readonly platforms?: readonly NodeJS.Platform[];
}

export interface HotkeyBinding extends HotkeyMetadata {
  readonly keys: string;
  readonly scope?: HotkeyScope;
  readonly scopeId?: string;
  readonly priority?: number;
  readonly enabled?: boolean | (() => boolean);
  readonly handler: (event: HotkeyEvent) => void | Promise<void>;
}

export interface HotkeyEvent {
  readonly keys: string;
  readonly input: string;
  readonly sequence: readonly string[];
  readonly binding: HotkeyBinding;
  defaultPrevented: boolean;
  preventDefault(): void;
}

export interface HotkeyConflict {
  readonly keys: string;
  readonly bindings: readonly HotkeyBinding[];
  readonly resolved: HotkeyBinding;
}

export interface HotkeyDispatchContext {
  readonly activeScopes?:
    | Partial<Record<HotkeyScope, string | true>>
    | (() => Partial<Record<HotkeyScope, string | true>>);
  readonly platform?: NodeJS.Platform;
  readonly onError?: (error: unknown) => void;
}

interface PendingHotkey {
  readonly binding: HotkeyBinding;
  readonly input: string;
  readonly sequence: readonly string[];
  readonly context: HotkeyDispatchContext;
  readonly platform: NodeJS.Platform;
}

function keyName(input: string, key: TerminalKey): string {
  if (key.return) return "enter";
  if (key.escape) return "escape";
  if (key.tab) return "tab";
  if (key.backspace) return "backspace";
  if (key.delete) return "delete";
  if (key.upArrow) return "arrowup";
  if (key.downArrow) return "arrowdown";
  if (key.leftArrow) return "arrowleft";
  if (key.rightArrow) return "arrowright";
  if (key.pageUp) return "pageup";
  if (key.pageDown) return "pagedown";
  if (key.home) return "home";
  if (key.end) return "end";
  if (input === " ") return "space";
  return (key.name ?? input).toLowerCase();
}

export function normalizeTerminalKey(
  input: string,
  key: TerminalKey = {},
  platform: NodeJS.Platform = process.platform,
): string {
  const name = keyName(input, key);
  const modifiers: string[] = [];
  if (key.ctrl) modifiers.push("ctrl");
  if (key.alt || (key.meta && platform !== "darwin")) modifiers.push("alt");
  if (key.meta && platform === "darwin") modifiers.push("meta");
  if (key.shift) modifiers.push("shift");
  return [...modifiers, name].filter(Boolean).join("+");
}

export function normalizeHotkeyNotation(
  notation: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return notation
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((chord) =>
      chord
        .split("+")
        .map((part) =>
          part === "mod" ? (platform === "darwin" ? "meta" : "ctrl") : part,
        )
        .sort((left, right) => {
          const order = ["ctrl", "alt", "meta", "shift"];
          const leftIndex = order.indexOf(left);
          const rightIndex = order.indexOf(right);
          if (leftIndex < 0 && rightIndex < 0) return 0;
          if (leftIndex < 0) return 1;
          if (rightIndex < 0) return -1;
          return leftIndex - rightIndex;
        })
        .join("+"),
    )
    .join(" ");
}

export class HotkeyManager {
  readonly #bindings = new Set<HotkeyBinding>();
  readonly #observers = new Set<(event: HotkeyEvent) => void>();
  readonly #sequence: string[] = [];
  #sequenceTimer?: ReturnType<typeof setTimeout>;
  #pendingExact?: PendingHotkey;
  readonly #deferredErrors: unknown[] = [];

  constructor(readonly sequenceTimeout = 750) {}

  register(binding: HotkeyBinding): () => void {
    if (!binding.keys.trim()) {
      throw new Error("Hotkey notation cannot be empty");
    }
    const registered = Object.freeze({ ...binding });
    this.#bindings.add(registered);
    return () => {
      this.#bindings.delete(registered);
      if (this.#pendingExact?.binding === registered) {
        this.#pendingExact = undefined;
        this.#sequence.length = 0;
        if (this.#sequenceTimer) clearTimeout(this.#sequenceTimer);
      }
    };
  }

  list(): readonly HotkeyBinding[] {
    return [...this.#bindings];
  }

  conflicts(
    platform: NodeJS.Platform = process.platform,
  ): readonly HotkeyConflict[] {
    const groups = new Map<string, HotkeyBinding[]>();
    for (const binding of this.#bindings) {
      const key = normalizeHotkeyNotation(binding.keys, platform);
      const current = groups.get(key) ?? [];
      current.push(binding);
      groups.set(key, current);
    }
    return [...groups.entries()]
      .filter(([, bindings]) => bindings.length > 1)
      .map(([keys, bindings]) => ({
        keys,
        bindings,
        resolved: [...bindings].sort(
          (left, right) => this.#rank(right) - this.#rank(left),
        )[0] as HotkeyBinding,
      }));
  }

  observe(observer: (event: HotkeyEvent) => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  drainErrors(): readonly unknown[] {
    return this.#deferredErrors.splice(0);
  }

  async dispatch(
    input: string,
    key: TerminalKey = {},
    context: HotkeyDispatchContext = {},
  ): Promise<HotkeyBinding | undefined> {
    const platform = context.platform ?? process.platform;
    const chord = normalizeHotkeyNotation(
      normalizeTerminalKey(input, key, platform),
      platform,
    );
    this.#sequence.push(chord);
    if (this.#sequenceTimer) clearTimeout(this.#sequenceTimer);
    const sequence = this.#sequence.join(" ");
    const eligible = [...this.#bindings].filter((binding) =>
      this.#isEligible(binding, context, platform),
    );
    const exact = eligible
      .filter(
        (binding) =>
          normalizeHotkeyNotation(binding.keys, platform) === sequence,
      )
      .sort((left, right) => this.#rank(right) - this.#rank(left));
    const hasLongerPrefix = eligible.some((candidate) =>
      normalizeHotkeyNotation(candidate.keys, platform).startsWith(
        `${sequence} `,
      ),
    );
    const binding = exact[0];
    if (binding && hasLongerPrefix) {
      this.#pendingExact = {
        binding,
        input,
        sequence: [...this.#sequence],
        context,
        platform,
      };
      this.#sequenceTimer = setTimeout(() => {
        const pending = this.#pendingExact;
        this.#pendingExact = undefined;
        this.#sequence.length = 0;
        if (pending && this.#isPendingEligible(pending)) {
          void this.#executeBinding(
            pending.binding,
            pending.input,
            pending.sequence,
            pending.platform,
          ).catch((error) => {
            this.#handleDeferredError(error, pending.context);
          });
        }
      }, this.sequenceTimeout);
      return undefined;
    }
    if (!binding && hasLongerPrefix) {
      this.#sequenceTimer = setTimeout(() => {
        this.#pendingExact = undefined;
        this.#sequence.length = 0;
      }, this.sequenceTimeout);
      return undefined;
    }
    if (!binding) {
      const pending = this.#pendingExact;
      this.#pendingExact = undefined;
      this.#sequence.length = 0;
      if (pending && this.#isPendingEligible(pending)) {
        await this.#executeBinding(
          pending.binding,
          pending.input,
          pending.sequence,
          pending.platform,
        );
        return this.dispatch(input, key, context);
      }
      return undefined;
    }
    this.#pendingExact = undefined;
    if (this.#sequenceTimer) clearTimeout(this.#sequenceTimer);
    const pressed = [...this.#sequence];
    this.#sequence.length = 0;
    await this.#executeBinding(binding, input, pressed, platform);
    return binding;
  }

  async #executeBinding(
    binding: HotkeyBinding,
    input: string,
    sequence: readonly string[],
    platform: NodeJS.Platform,
  ): Promise<void> {
    const event: HotkeyEvent = {
      keys: normalizeHotkeyNotation(binding.keys, platform),
      input,
      sequence,
      binding,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    await binding.handler(event);
    for (const observer of this.#observers) {
      observer(event);
    }
  }

  #isEligible(
    binding: HotkeyBinding,
    context: HotkeyDispatchContext,
    platform: NodeJS.Platform,
  ): boolean {
    if (binding.platforms && !binding.platforms.includes(platform)) {
      return false;
    }
    if (
      binding.enabled === false ||
      (typeof binding.enabled === "function" && !binding.enabled())
    ) {
      return false;
    }
    const scope = binding.scope ?? "application";
    const activeScopes =
      typeof context.activeScopes === "function"
        ? context.activeScopes()
        : context.activeScopes;
    const active = activeScopes?.[scope];
    return (
      scope === "application" ||
      active === true ||
      (typeof active === "string" && active === binding.scopeId)
    );
  }

  #rank(binding: HotkeyBinding): number {
    return (
      scopePriority[binding.scope ?? "application"] * 1000 +
      (binding.priority ?? 0)
    );
  }

  #isPendingEligible(pending: PendingHotkey): boolean {
    return (
      this.#bindings.has(pending.binding) &&
      this.#isEligible(pending.binding, pending.context, pending.platform)
    );
  }

  #handleDeferredError(error: unknown, context: HotkeyDispatchContext): void {
    if (context.onError) {
      try {
        context.onError(error);
        return;
      } catch (reportError) {
        this.#deferredErrors.push(
          new AggregateError(
            [error, reportError],
            "Hotkey handler and error reporting failed",
          ),
        );
        return;
      }
    }
    this.#deferredErrors.push(error);
  }
}

const HotkeyContext = createContext<HotkeyManager | undefined>(undefined);

export function HotkeyProvider(props: {
  readonly manager?: HotkeyManager;
  readonly children?: ReactNode;
}): ReactNode {
  const manager = useMemo(
    () => props.manager ?? new HotkeyManager(),
    [props.manager],
  );
  return createElement(
    HotkeyContext.Provider,
    { value: manager },
    props.children,
  );
}

export function useHotkeyManager(): HotkeyManager {
  const manager = useContext(HotkeyContext);
  if (!manager) {
    throw new Error("useHotkeyManager must be used inside HotkeyProvider");
  }
  return manager;
}

export function useHotkey(
  keys: string,
  handler: HotkeyBinding["handler"],
  options: Omit<HotkeyBinding, "keys" | "handler"> = {},
): void {
  const manager = useHotkeyManager();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(
    () =>
      manager.register({
        ...options,
        keys,
        handler: (event) => handlerRef.current(event),
      }),
    [keys, manager, options],
  );
}

export function useHotkeys(
  bindings: Readonly<Record<string, HotkeyBinding["handler"]>>,
  options: Omit<HotkeyBinding, "keys" | "handler"> = {},
): void {
  const manager = useHotkeyManager();
  useEffect(() => {
    const disposers = Object.entries(bindings).map(([keys, handler]) =>
      manager.register({ ...options, keys, handler }),
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [bindings, manager, options]);
}

export function Hotkey(
  props: Omit<HotkeyBinding, "handler"> & {
    readonly onTrigger: HotkeyBinding["handler"];
  },
): null {
  const { onTrigger, ...options } = props;
  useHotkey(props.keys, onTrigger, options);
  return null;
}
