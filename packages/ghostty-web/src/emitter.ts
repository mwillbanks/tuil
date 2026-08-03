export type EventListener = (...args: unknown[]) => void;

export class BrowserEventEmitter {
  readonly #listeners = new Map<string | symbol, Set<EventListener>>();

  on(event: string | symbol, listener: EventListener): this {
    const listeners = this.#listeners.get(event) ?? new Set<EventListener>();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return this;
  }

  addListener(event: string | symbol, listener: EventListener): this {
    return this.on(event, listener);
  }

  once(event: string | symbol, listener: EventListener): this {
    const wrapped: EventListener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string | symbol, listener: EventListener): this {
    const listeners = this.#listeners.get(event);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.#listeners.delete(event);
    return this;
  }

  removeListener(event: string | symbol, listener: EventListener): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const listeners = [...(this.#listeners.get(event) ?? [])];
    for (const listener of listeners) listener(...args);
    return listeners.length > 0;
  }

  listenerCount(event: string | symbol): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  setMaxListeners(_count: number): this {
    return this;
  }
}
