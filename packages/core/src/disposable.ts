export interface Disposable {
  dispose(): void | Promise<void>;
}

export type Disposer = () => void | Promise<void>;

export function toDisposable(dispose: Disposer): Disposable {
  return { dispose };
}

export function deleteOnDispose<T>(
  collection: Pick<Set<T>, "delete">,
  value: T,
  onDelete?: () => void,
): Disposer {
  return () => {
    collection.delete(value);
    onDelete?.();
  };
}

export class DisposableStack implements Disposable {
  readonly #resources: Disposable[];
  #disposed: boolean;

  constructor() {
    this.#resources = [];
    this.#disposed = false;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  use<T extends Disposable>(value: T): T {
    if (this.#disposed) {
      throw new Error("Cannot add a resource to a disposed stack");
    }
    this.#resources.push(value);
    return value;
  }

  defer(dispose: Disposer): void {
    if (this.#disposed) {
      throw new Error("Cannot add a resource to a disposed stack");
    }
    this.#resources.push(toDisposable(dispose));
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const resource of this.#resources.reverse()) {
      try {
        await resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#resources.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "One or more resources failed to dispose",
      );
    }
  }
}
