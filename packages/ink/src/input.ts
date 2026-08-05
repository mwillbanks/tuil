import { deleteOnDispose } from "@mwillbanks/tuil-core";
import type { Key } from "ink";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";

export type TerminalInputHandler = (
  input: string,
  key: Key,
) => boolean | Promise<boolean>;

const terminalControlSequence = /^(?:\[[0-?]*[ -/]*[@-~]|O[@-~])$/u;
const terminalEscape = String.fromCharCode(27);

export function isTerminalControlSequence(input: string): boolean {
  return input.includes(terminalEscape) || terminalControlSequence.test(input);
}

interface TerminalInputRegistration {
  readonly id: number;
  readonly priority: number;
  readonly layerId?: string;
  readonly handler: TerminalInputHandler;
}

export class TerminalInputRouter {
  readonly #registrations: Map<number, TerminalInputRegistration>;
  #nextId: number;

  constructor() {
    this.#registrations = new Map();
    this.#nextId = 0;
  }

  register(
    handler: TerminalInputHandler,
    priority: number,
    layerId?: string,
  ): () => void {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#registrations.set(id, { id, priority, layerId, handler });
    return deleteOnDispose(this.#registrations, id);
  }

  async dispatch(
    input: string,
    key: Key,
    activeLayerId?: string,
  ): Promise<boolean> {
    const registrations = [...this.#registrations.values()]
      .filter(
        (registration) =>
          activeLayerId === undefined || registration.layerId === activeLayerId,
      )
      .sort(
        (left, right) => right.priority - left.priority || right.id - left.id,
      );
    for (const registration of registrations) {
      if (await registration.handler(input, key)) return true;
    }
    return false;
  }
}

export const TerminalInputContext = createContext<
  TerminalInputRouter | undefined
>(undefined);
const TerminalInputLayerContext = createContext<string | undefined>(undefined);

export function TerminalInputLayer(props: {
  readonly id: string;
  readonly children?: ReactNode;
}): ReactNode {
  return createElement(
    TerminalInputLayerContext.Provider,
    { value: props.id },
    props.children,
  );
}

export function useTerminalInput(
  handler: TerminalInputHandler,
  options: {
    readonly enabled?: boolean;
    readonly priority?: number;
    readonly layerId?: string;
  } = {},
): void {
  const router = useContext(TerminalInputContext);
  const inheritedLayerId = useContext(TerminalInputLayerContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const enabled = options.enabled ?? true;
  const priority = options.priority ?? 0;
  const layerId = options.layerId ?? inheritedLayerId;
  useEffect(() => {
    if (!router || !enabled) return;
    return router.register(
      (input, key) => handlerRef.current(input, key),
      priority,
      layerId,
    );
  }, [enabled, layerId, priority, router]);
}
