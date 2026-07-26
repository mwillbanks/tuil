import { deleteOnDispose } from "./disposable.ts";

export type AppLifecycleState =
  | "created"
  | "configuring"
  | "initializing"
  | "mounting"
  | "ready"
  | "stopping"
  | "disposed";

const transitions: Record<AppLifecycleState, readonly AppLifecycleState[]> = {
  created: ["configuring", "stopping"],
  configuring: ["initializing", "stopping"],
  initializing: ["mounting", "stopping"],
  mounting: ["ready", "stopping"],
  ready: ["stopping"],
  stopping: ["disposed"],
  disposed: [],
};

export class Lifecycle {
  #state: AppLifecycleState;
  readonly #observers: Set<
    (state: AppLifecycleState, previous: AppLifecycleState) => void
  >;

  constructor() {
    this.#state = "created";
    this.#observers = new Set();
  }

  get state(): AppLifecycleState {
    return this.#state;
  }

  transition(next: AppLifecycleState): void {
    if (!transitions[this.#state].includes(next)) {
      throw new Error(`Invalid lifecycle transition: ${this.#state} → ${next}`);
    }
    const previous = this.#state;
    this.#state = next;
    for (const observer of this.#observers) {
      observer(next, previous);
    }
  }

  observe(
    observer: (state: AppLifecycleState, previous: AppLifecycleState) => void,
  ): () => void {
    this.#observers.add(observer);
    return deleteOnDispose(this.#observers, observer);
  }
}
