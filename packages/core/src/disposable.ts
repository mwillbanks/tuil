export interface Disposable {
  dispose(): void | Promise<void>;
}

export type Disposer = () => void | Promise<void>;

export function toDisposable(dispose: Disposer): Disposable {
  return { dispose };
}

export class DisposableStack implements Disposable {
  readonly #disposers: Disposer[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  use<T extends Disposable>(value: T): T {
    if (this.#disposed) {
      throw new Error("Cannot add a resource to a disposed stack");
    }
    this.#disposers.push(() => value.dispose());
    return value;
  }

  defer(dispose: Disposer): void {
    if (this.#disposed) {
      throw new Error("Cannot add a resource to a disposed stack");
    }
    this.#disposers.push(dispose);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const dispose of this.#disposers.reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#disposers.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "One or more resources failed to dispose",
      );
    }
  }
}
