import { Batcher } from "@tanstack/pacer";
import { createNusmStore } from "nusm";

export type OperationStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface OperationProgress {
  readonly current: number;
  readonly total?: number;
  readonly message?: string;
}

export interface OperationError {
  readonly name: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface OperationSnapshot<TResult = unknown> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status: OperationStatus;
  readonly progress?: OperationProgress;
  readonly attempt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly result?: TResult;
  readonly error?: OperationError;
  readonly children: readonly OperationSnapshot[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly logs: readonly string[];
}

export interface OperationContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly updateProgress: (progress: OperationProgress) => void;
  readonly log: (line: string) => void;
  readonly runChild: <T>(definition: OperationDefinition<T>) => Promise<T>;
  readonly block: (message: string) => never;
  readonly waitFor: <T>(work: Promise<T>) => Promise<T>;
}

type OperationRollback<TResult> = {
  bivarianceHack(
    result: TResult | undefined,
    context: OperationContext,
  ): void | Promise<void>;
}["bivarianceHack"];

export interface OperationDefinition<TResult = unknown> {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly retries?: number;
  readonly retryDelay?: number;
  readonly timeout?: number;
  readonly run: (context: OperationContext) => TResult | Promise<TResult>;
  readonly rollback?: OperationRollback<TResult>;
}

export function defineOperation<TResult>(
  definition: OperationDefinition<TResult>,
): OperationDefinition<TResult> {
  return Object.freeze({ ...definition });
}

export interface OperationEvent {
  readonly operation: OperationSnapshot;
  readonly previousStatus?: OperationStatus;
  readonly at: number;
}

interface ChildOperationHandle {
  readonly state: OperationSnapshot;
  cancel(reason?: unknown): void;
  rollback(signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

function operationError(error: unknown): OperationError {
  return Object.freeze({
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

export class OperationBlockedError extends Error {
  override readonly name = "OperationBlockedError";
}

export class OperationTimeoutError extends Error {
  override readonly name = "OperationTimeoutError";
}

export interface OperationExecutorOptions {
  readonly maxLogs?: number;
  readonly onObserverError?: (error: unknown) => void;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class OperationExecutor<TResult = unknown> {
  readonly #store;
  readonly #observers = new Set<(event: OperationEvent) => void>();
  #controller = new AbortController();
  readonly #children: ChildOperationHandle[] = [];
  readonly #childAttempts = new Map<ChildOperationHandle, number>();
  readonly #childUnsubscribes = new Map<ChildOperationHandle, () => void>();
  readonly #logBatcher: Batcher<{
    readonly generation: number;
    readonly line: string;
  }>;
  #lastResult?: TResult;
  #generation = 0;
  #attemptGeneration = 0;

  constructor(
    readonly definition: OperationDefinition<TResult>,
    readonly options: OperationExecutorOptions = {},
  ) {
    this.#store = createNusmStore<OperationSnapshot<TResult>>(
      Object.freeze({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        status: "idle",
        attempt: 0,
        children: Object.freeze([]),
        metadata: Object.freeze({ ...(definition.metadata ?? {}) }),
        logs: Object.freeze([]),
      }),
    );
    this.#logBatcher = new Batcher(
      (entries) => {
        const lines = entries
          .filter((entry) => entry.generation === this.#generation)
          .map((entry) => entry.line);
        if (lines.length === 0) return;
        const logs = [...this.state.logs, ...lines].slice(
          -(this.options.maxLogs ?? 1_000),
        );
        this.#update({ logs: Object.freeze(logs) });
      },
      { maxSize: 50, wait: 16 },
    );
  }

  get state(): OperationSnapshot<TResult> {
    return this.#store.state;
  }

  subscribe(observer: () => void): () => void {
    const subscription = this.#store.subscribe(observer);
    return () => subscription.unsubscribe();
  }

  observe(observer: (event: OperationEvent) => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  restore(snapshot: OperationSnapshot<TResult>): void {
    if (
      ["running", "queued", "waiting", "retrying"].includes(this.state.status)
    ) {
      throw new Error("Cannot restore while the operation is running");
    }
    if (
      ["running", "queued", "waiting", "retrying"].includes(snapshot.status)
    ) {
      throw new Error("Cannot restore an in-flight operation snapshot");
    }
    this.#generation += 1;
    this.#attemptGeneration += 1;
    this.#lastResult = snapshot.result;
    this.#update(
      Object.freeze({
        ...snapshot,
        children: Object.freeze([...snapshot.children]),
        metadata: Object.freeze({ ...snapshot.metadata }),
        logs: Object.freeze([...snapshot.logs]),
      }),
    );
  }

  async execute(signal?: AbortSignal): Promise<TResult> {
    if (["running", "waiting", "retrying"].includes(this.state.status)) {
      throw new Error(`Operation "${this.definition.id}" is already running`);
    }
    if (this.#controller.signal.aborted) {
      this.#controller = new AbortController();
    }
    this.#generation += 1;
    this.#attemptGeneration += 1;
    const generation = this.#generation;
    this.#disposeChildren();
    this.#lastResult = undefined;
    this.#update({
      status: "idle",
      progress: undefined,
      attempt: 0,
      startedAt: undefined,
      completedAt: undefined,
      result: undefined,
      error: undefined,
      children: Object.freeze([]),
      logs: Object.freeze([]),
    });
    const combined = signal
      ? AbortSignal.any([signal, this.#controller.signal])
      : this.#controller.signal;
    const retries = Math.max(0, this.definition.retries ?? 0);
    let lastError: unknown;
    this.#transition("queued");
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      combined.throwIfAborted();
      this.#update({
        attempt,
        startedAt: this.state.startedAt ?? Date.now(),
        error: undefined,
      });
      this.#transition(attempt === 1 ? "running" : "retrying");
      const attemptController = new AbortController();
      const attemptGeneration = ++this.#attemptGeneration;
      const attemptSignal = AbortSignal.any([
        combined,
        attemptController.signal,
      ]);
      let attemptSucceeded = false;
      let attemptChildrenCleaned = false;
      const context = this.#context(
        attemptSignal,
        attempt,
        generation,
        attemptGeneration,
      );
      const execution = Promise.resolve().then(() =>
        this.definition.run(context),
      );
      let settled = false;
      void execution.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const timeout = this.definition.timeout;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      let removeAbortListener: () => void = () => undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        const rejectAborted = () => reject(attemptSignal.reason);
        attemptSignal.addEventListener("abort", rejectAborted, { once: true });
        removeAbortListener = () =>
          attemptSignal.removeEventListener("abort", rejectAborted);
      });
      try {
        const attempts: Promise<TResult>[] = [execution, aborted];
        if (timeout && timeout > 0) {
          attempts.push(
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                timedOut = true;
                const error = new OperationTimeoutError(
                  `Operation timed out after ${timeout}ms`,
                );
                attemptController.abort(error);
                reject(error);
              }, timeout);
            }),
          );
        }
        const result = await Promise.race(attempts);
        combined.throwIfAborted();
        this.#lastResult = result;
        this.#logBatcher.flush();
        this.#update({ result, completedAt: Date.now() });
        this.#transition("succeeded");
        attemptSucceeded = true;
        return result;
      } catch (error) {
        this.#cleanupAttemptChildren(attemptGeneration, false);
        attemptChildrenCleaned = true;
        lastError = error;
        if (combined.aborted) {
          this.#logBatcher.flush();
          this.#update({
            error: operationError(combined.reason ?? error),
            completedAt: Date.now(),
          });
          this.#transition("cancelled");
          throw combined.reason ?? error;
        }
        if (error instanceof OperationBlockedError) {
          this.#logBatcher.flush();
          this.#update({ error: operationError(error) });
          this.#transition("blocked");
          throw error;
        }
        if (timedOut) {
          await Promise.resolve();
          if (!settled) break;
        }
        if (attempt <= retries) {
          this.#update({ error: operationError(error) });
          if ((this.definition.retryDelay ?? 0) > 0) {
            this.#transition("waiting");
            try {
              await abortableDelay(this.definition.retryDelay ?? 0, combined);
            } catch (delayError) {
              this.#logBatcher.flush();
              this.#update({
                error: operationError(delayError),
                completedAt: Date.now(),
              });
              this.#transition("cancelled");
              throw delayError;
            }
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
        removeAbortListener();
        if (!attemptChildrenCleaned) {
          this.#cleanupAttemptChildren(attemptGeneration, attemptSucceeded);
        }
        if (this.#attemptGeneration === attemptGeneration) {
          this.#attemptGeneration += 1;
        }
      }
    }
    this.#logBatcher.flush();
    this.#update({
      error: operationError(lastError),
      completedAt: Date.now(),
    });
    this.#transition("failed");
    throw lastError;
  }

  cancel(reason: unknown = new DOMException("Cancelled", "AbortError")): void {
    this.#attemptGeneration += 1;
    this.#controller.abort(reason);
    for (const child of this.#children) child.cancel(reason);
  }

  async rollback(signal?: AbortSignal): Promise<void> {
    const activeSignal = signal ?? new AbortController().signal;
    activeSignal.throwIfAborted();
    const context = this.#context(
      activeSignal,
      this.state.attempt,
      this.#generation,
      this.#attemptGeneration,
    );
    for (const child of [...this.#children].reverse()) {
      await child.rollback(activeSignal);
      activeSignal.throwIfAborted();
    }
    await this.definition.rollback?.(this.#lastResult, context);
    activeSignal.throwIfAborted();
  }

  skip(): void {
    if (this.state.status !== "idle" && this.state.status !== "queued") {
      throw new Error("Only idle or queued operations can be skipped");
    }
    this.#update({ completedAt: Date.now() });
    this.#transition("skipped");
  }

  dispose(): void {
    this.cancel(new DOMException("Disposed", "AbortError"));
    this.#disposeChildren();
    this.#logBatcher.cancel();
    this.#observers.clear();
  }

  #context(
    signal: AbortSignal,
    attempt: number,
    generation: number,
    attemptGeneration: number,
  ): OperationContext {
    const active = () =>
      generation === this.#generation &&
      attemptGeneration === this.#attemptGeneration &&
      !signal.aborted;
    return {
      signal,
      attempt,
      updateProgress: (progress) => {
        if (active()) {
          this.#update({ progress: Object.freeze({ ...progress }) });
        }
      },
      log: (line) => {
        if (active()) this.#logBatcher.addItem({ generation, line });
      },
      block: (message) => {
        throw new OperationBlockedError(message);
      },
      waitFor: async <T>(work: Promise<T>) => {
        if (active()) this.#transition("waiting");
        try {
          return await work;
        } finally {
          if (active()) this.#transition("running");
        }
      },
      runChild: async <T>(definition: OperationDefinition<T>) => {
        signal.throwIfAborted();
        if (!active()) throw new DOMException("Stale operation", "AbortError");
        const child = new OperationExecutor(definition, this.options);
        this.#children.push(child);
        this.#childAttempts.set(child, attemptGeneration);
        this.#childUnsubscribes.set(
          child,
          child.subscribe(() => {
            if (active())
              this.#update({
                children: Object.freeze(
                  this.#children.map((candidate) => candidate.state),
                ),
              });
          }),
        );
        if (active())
          this.#update({
            children: Object.freeze(
              this.#children.map((candidate) => candidate.state),
            ),
          });
        return child.execute(signal);
      },
    };
  }

  #cleanupAttemptChildren(
    attemptGeneration: number,
    preserveSucceeded: boolean,
  ): void {
    const retained: ChildOperationHandle[] = [];
    for (const child of this.#children) {
      const belongsToAttempt =
        this.#childAttempts.get(child) === attemptGeneration;
      const shouldPreserve =
        preserveSucceeded && child.state.status === "succeeded";
      if (!belongsToAttempt || shouldPreserve) {
        retained.push(child);
        continue;
      }
      this.#disposeChild(child);
    }
    this.#children.splice(0, this.#children.length, ...retained);
    this.#update({
      children: Object.freeze(this.#children.map((child) => child.state)),
    });
  }

  #disposeChild(child: ChildOperationHandle): void {
    this.#childUnsubscribes.get(child)?.();
    this.#childUnsubscribes.delete(child);
    this.#childAttempts.delete(child);
    child.dispose();
  }

  #disposeChildren(): void {
    for (const child of this.#children) this.#disposeChild(child);
    this.#children.length = 0;
    this.#childAttempts.clear();
    this.#childUnsubscribes.clear();
  }

  #transition(status: OperationStatus): void {
    const previousStatus = this.state.status;
    this.#update({ status });
    const event = Object.freeze({
      operation: this.state,
      previousStatus,
      at: Date.now(),
    });
    for (const observer of this.#observers) {
      try {
        observer(event);
      } catch (error) {
        try {
          this.options.onObserverError?.(error);
        } catch {
          // Observer error reporting must not corrupt operation state.
        }
      }
    }
  }

  #update(patch: Partial<OperationSnapshot<TResult>>): void {
    this.#store.setState((state) => Object.freeze({ ...state, ...patch }));
  }
}

export function createOperation<TResult>(
  definition: OperationDefinition<TResult>,
  options?: OperationExecutorOptions,
): OperationExecutor<TResult> {
  return new OperationExecutor(definition, options);
}
