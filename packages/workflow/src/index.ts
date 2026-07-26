import {
  createOperation,
  type OperationDefinition,
  type OperationSnapshot,
} from "@mwillbanks/tuil-operations";
import { createNusmStore } from "nusm";

export type WorkflowStatus =
  | "idle"
  | "running"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed"
  | "rolling-back";

export interface WorkflowContext<TState> {
  readonly state: TState;
  readonly signal: AbortSignal;
  readonly runner: WorkflowRunner<TState>;
}

export interface WorkflowParallelBranch<TState> {
  readonly id: string;
  readonly run: (
    context: WorkflowContext<TState>,
  ) => unknown | Promise<unknown>;
  readonly compensate?: (
    context: WorkflowContext<TState>,
  ) => void | Promise<void>;
}

export interface WorkflowParallelSnapshot {
  readonly id: string;
  readonly stepId: string;
  readonly status: "running" | "succeeded" | "failed" | "cancelled";
  readonly error?: string;
}

export interface WorkflowStep<TState> {
  readonly id?: string;
  readonly title?: string;
  readonly component?: unknown;
  readonly help?: string;
  readonly when?: (
    context: WorkflowContext<TState>,
  ) => boolean | Promise<boolean>;
  readonly validate?: (
    context: WorkflowContext<TState>,
  ) =>
    | string
    | readonly string[]
    | undefined
    | Promise<string | readonly string[] | undefined>;
  readonly enter?: (context: WorkflowContext<TState>) => void | Promise<void>;
  readonly leave?: (context: WorkflowContext<TState>) => void | Promise<void>;
  readonly compensate?: (
    context: WorkflowContext<TState>,
  ) => void | Promise<void>;
  readonly timeout?: number;
  readonly commands?: readonly string[];
  readonly operations?: readonly OperationDefinition[];
  readonly nested?: WorkflowDefinition<unknown>;
  readonly parallel?: readonly (
    | ((context: WorkflowContext<TState>) => unknown | Promise<unknown>)
    | WorkflowParallelBranch<TState>
  )[];
}

export function defineStep<TState>(
  step: WorkflowStep<TState>,
): WorkflowStep<TState> {
  return Object.freeze({ ...step });
}

export function defineOperationStep<TState>(
  step: WorkflowStep<TState> & {
    readonly operations: readonly OperationDefinition[];
  },
): WorkflowStep<TState> {
  return defineStep(step);
}

export interface WorkflowTransition<TState> {
  readonly from: string;
  readonly to: string;
  readonly when?: (
    context: WorkflowContext<TState>,
  ) => boolean | Promise<boolean>;
}

export function transition<TState>(
  from: string,
  to: string,
  options: Pick<WorkflowTransition<TState>, "when"> = {},
): WorkflowTransition<TState> {
  return Object.freeze({ from, to, ...options });
}

export interface WorkflowPersistence<TState> {
  readonly load: (
    id: string,
    signal: AbortSignal,
  ) =>
    | PersistedWorkflow<TState>
    | undefined
    | Promise<PersistedWorkflow<TState> | undefined>;
  readonly save: (
    id: string,
    value: PersistedWorkflow<TState>,
    signal: AbortSignal,
  ) => void | Promise<void>;
  readonly remove?: (id: string, signal: AbortSignal) => void | Promise<void>;
}

export interface PersistedWorkflow<TState> {
  readonly version: number;
  readonly state: TState;
  readonly currentStep?: string;
  readonly completedSteps: readonly string[];
  readonly skippedSteps: readonly string[];
  readonly history: readonly string[];
  readonly status?: WorkflowStatus;
  readonly errors?: readonly string[];
  readonly nested?: PersistedWorkflow<unknown>;
  readonly parallel?: readonly WorkflowParallelSnapshot[];
  readonly operations?: readonly OperationSnapshot[];
}

export interface WorkflowDefinition<TState> {
  readonly id: string;
  readonly version: number;
  readonly initialState: TState | (() => TState);
  readonly steps: Readonly<Record<string, WorkflowStep<TState>>>;
  readonly transitions: readonly WorkflowTransition<TState>[];
  readonly persistence?: WorkflowPersistence<TState>;
  readonly migrate?: (
    persisted: PersistedWorkflow<unknown>,
    signal: AbortSignal,
  ) => PersistedWorkflow<TState> | Promise<PersistedWorkflow<TState>>;
  readonly exitGuard?: (
    context: WorkflowContext<TState>,
  ) => boolean | Promise<boolean>;
  readonly analytics?: (event: WorkflowEvent<TState>) => void;
  readonly onObserverError?: (error: unknown) => void;
}

export function defineWorkflow<TState>(
  definition: WorkflowDefinition<TState>,
): WorkflowDefinition<TState> {
  return Object.freeze({
    ...definition,
    steps: Object.freeze({ ...definition.steps }),
    transitions: Object.freeze([...definition.transitions]),
  });
}

export interface WorkflowSnapshot<TState> {
  readonly id: string;
  readonly version: number;
  readonly status: WorkflowStatus;
  readonly state: TState;
  readonly currentStep?: string;
  readonly completedSteps: readonly string[];
  readonly skippedSteps: readonly string[];
  readonly history: readonly string[];
  readonly errors: readonly string[];
  readonly operations: readonly OperationSnapshot[];
  readonly nestedWorkflow?: WorkflowSnapshot<unknown>;
  readonly parallel: readonly WorkflowParallelSnapshot[];
  readonly transitioning: boolean;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

export type WorkflowEventType =
  | "workflow:start"
  | "workflow:step-enter"
  | "workflow:step-leave"
  | "workflow:validate"
  | "workflow:skip"
  | "workflow:back"
  | "workflow:resume"
  | "workflow:retry"
  | "workflow:rollback"
  | "workflow:cancel"
  | "workflow:complete"
  | "workflow:error";

export interface WorkflowEvent<TState> {
  readonly type: WorkflowEventType;
  readonly snapshot: WorkflowSnapshot<TState>;
  readonly step?: string;
  readonly error?: unknown;
  readonly at: number;
}

function initialValue<TState>(definition: WorkflowDefinition<TState>): TState {
  return typeof definition.initialState === "function"
    ? (definition.initialState as () => TState)()
    : structuredClone(definition.initialState);
}

export class WorkflowRunner<TState> {
  readonly #store;
  readonly #observers = new Set<(event: WorkflowEvent<TState>) => void>();
  #controller = new AbortController();
  readonly #operationExecutors = new Map<
    string,
    ReturnType<typeof createOperation>
  >();
  readonly #operationUnsubscribes = new Map<string, () => void>();
  #nestedRunner?: WorkflowRunner<unknown>;
  #nestedUnsubscribe?: () => void;
  #pendingStepWork?: Promise<void>;
  #persistenceQueue: Promise<void> = Promise.resolve();
  #cancelDecision?: Promise<boolean>;
  #cancelRequest?: Promise<boolean>;
  #cancellationDurable = false;
  #transitioning = false;
  #disposed = false;

  constructor(readonly definition: WorkflowDefinition<TState>) {
    this.#store = createNusmStore<WorkflowSnapshot<TState>>(
      Object.freeze({
        id: definition.id,
        version: definition.version,
        status: "idle",
        state: initialValue(definition),
        completedSteps: Object.freeze([]),
        skippedSteps: Object.freeze([]),
        history: Object.freeze([]),
        errors: Object.freeze([]),
        operations: Object.freeze([]),
        parallel: Object.freeze([]),
        transitioning: false,
      }),
    );
  }

  get snapshot(): WorkflowSnapshot<TState> {
    return this.#store.state;
  }

  get currentStep(): WorkflowStep<TState> | undefined {
    return this.snapshot.currentStep
      ? this.definition.steps[this.snapshot.currentStep]
      : undefined;
  }

  subscribe(observer: () => void): () => void {
    const subscription = this.#store.subscribe(observer);
    return () => subscription.unsubscribe();
  }

  observe(observer: (event: WorkflowEvent<TState>) => void): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  async updateState(
    updater: TState | ((state: TState) => TState),
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.#disposed) throw new Error("Workflow runner is disposed");
    const activeSignal = this.#activeSignal(signal);
    activeSignal.throwIfAborted();
    const state =
      typeof updater === "function"
        ? (updater as (state: TState) => TState)(this.snapshot.state)
        : updater;
    this.#update({
      state,
      ...(this.snapshot.status === "blocked"
        ? { status: "running" as const, errors: Object.freeze([]) }
        : {}),
    });
    await this.#persist(activeSignal);
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (!this.#beginTransition()) {
      throw new Error(`Workflow "${this.definition.id}" is transitioning`);
    }
    try {
      if (this.#pendingStepWork) {
        throw new Error(
          `Workflow "${this.definition.id}" still has an active step attempt`,
        );
      }
      if (this.snapshot.status !== "idle") {
        throw new Error(`Workflow "${this.definition.id}" has already started`);
      }
      if (this.#controller.signal.aborted) {
        this.#controller = new AbortController();
      }
      const activeSignal = this.#activeSignal(signal);
      activeSignal.throwIfAborted();
      this.#update({ status: "running", startedAt: Date.now() });
      this.#emit("workflow:start");
      const first = Object.keys(this.definition.steps)[0];
      if (!first) {
        await this.#complete();
        return;
      }
      await this.#enterFirstAvailable(first, [], activeSignal);
    } finally {
      this.#endTransition();
    }
  }

  async resume(signal?: AbortSignal): Promise<boolean> {
    if (!this.#beginTransition()) return false;
    try {
      const activeSignal = this.#activeSignal(signal);
      activeSignal.throwIfAborted();
      const persisted = await this.definition.persistence?.load(
        this.definition.id,
        activeSignal,
      );
      activeSignal.throwIfAborted();
      if (!persisted) return false;
      const value =
        persisted.version === this.definition.version
          ? (persisted as PersistedWorkflow<TState>)
          : await this.definition.migrate?.(
              persisted as PersistedWorkflow<unknown>,
              activeSignal,
            );
      await this.#checkpoint(activeSignal);
      if (!value) {
        throw new Error(
          `Workflow "${this.definition.id}" requires a migration from version ${persisted.version}`,
        );
      }
      await this.#restorePersisted(value, activeSignal);
      this.#emit("workflow:resume", value.currentStep);
      return true;
    } finally {
      this.#endTransition();
    }
  }

  async next(signal?: AbortSignal): Promise<boolean> {
    if (!this.#beginTransition()) return false;
    try {
      const activeSignal = this.#activeSignal(signal);
      activeSignal.throwIfAborted();
      const currentId = this.snapshot.currentStep;
      if (!currentId || this.snapshot.status !== "running") return false;
      if (
        this.#nestedRunner &&
        this.#nestedRunner.snapshot.status !== "completed"
      ) {
        const moved = await this.#nestedRunner.next(activeSignal);
        if (!moved || !this.#nestedIsComplete()) {
          await this.#persist(activeSignal);
          return moved;
        }
      }
      if (!(await this.#validateCurrent(activeSignal))) return false;
      const context = this.#context(activeSignal);
      await this.currentStep?.leave?.(context);
      await this.#checkpoint(activeSignal);
      this.#emit("workflow:step-leave", currentId);
      const next = await this.#nextStep(currentId, activeSignal);
      const completedSteps = Object.freeze([
        ...new Set([...this.snapshot.completedSteps, currentId]),
      ]);
      if (!next) {
        this.#update({ completedSteps });
        await this.#complete();
        return true;
      }
      await this.#enterFirstAvailable(next, completedSteps, activeSignal);
      return true;
    } finally {
      this.#endTransition();
    }
  }

  async back(signal?: AbortSignal): Promise<boolean> {
    if (!this.#beginTransition()) return false;
    try {
      const activeSignal = this.#activeSignal(signal);
      activeSignal.throwIfAborted();
      if (
        this.#nestedRunner &&
        this.#nestedRunner.snapshot.status === "running" &&
        (await this.#nestedRunner.back(activeSignal))
      ) {
        return true;
      }
      const history = [...this.snapshot.history];
      const current = history.pop();
      const previous = history.at(-1);
      if (!current || !previous) return false;
      this.#update({
        status: "running",
        currentStep: previous,
        completedSteps: Object.freeze(
          this.snapshot.completedSteps.filter((step) => step !== previous),
        ),
        history: Object.freeze(history),
        errors: Object.freeze([]),
      });
      this.#emit("workflow:back", previous);
      await this.definition.steps[previous]?.enter?.(
        this.#context(activeSignal),
      );
      activeSignal.throwIfAborted();
      await this.#persist(activeSignal);
      return true;
    } finally {
      this.#endTransition();
    }
  }

  async skip(signal?: AbortSignal): Promise<boolean> {
    if (!this.#beginTransition()) return false;
    try {
      const activeSignal = this.#activeSignal(signal);
      activeSignal.throwIfAborted();
      const current = this.snapshot.currentStep;
      if (
        !current ||
        (this.snapshot.status !== "running" &&
          this.snapshot.status !== "blocked")
      ) {
        return false;
      }
      this.#update({
        status: "running",
        errors: Object.freeze([]),
        skippedSteps: Object.freeze([
          ...new Set([...this.snapshot.skippedSteps, current]),
        ]),
      });
      this.#emit("workflow:skip", current);
      const next = await this.#nextStep(current, activeSignal);
      if (!next) {
        await this.#complete();
        return true;
      }
      await this.#enterFirstAvailable(
        next,
        this.snapshot.completedSteps,
        activeSignal,
      );
      return true;
    } finally {
      this.#endTransition();
    }
  }

  async validate(signal?: AbortSignal): Promise<boolean> {
    if (!this.#beginTransition()) return false;
    try {
      const activeSignal = this.#activeSignal(signal);
      return await this.#validateCurrent(activeSignal);
    } finally {
      this.#endTransition();
    }
  }

  async #validateCurrent(activeSignal: AbortSignal): Promise<boolean> {
    activeSignal.throwIfAborted();
    const current = this.snapshot.currentStep;
    if (!current) return true;
    const validation = await this.currentStep?.validate?.(
      this.#context(activeSignal),
    );
    await this.#checkpoint(activeSignal);
    const errors = !validation
      ? []
      : typeof validation === "string"
        ? [validation]
        : [...validation];
    this.#update({
      errors: Object.freeze(errors),
      status: errors.length > 0 ? "blocked" : "running",
    });
    this.#emit("workflow:validate", current);
    return errors.length === 0;
  }

  async retry(signal?: AbortSignal): Promise<boolean> {
    if (!this.#beginTransition()) return false;
    try {
      if (this.#pendingStepWork) return false;
      const activeSignal = this.#activeSignal(signal);
      activeSignal.throwIfAborted();
      if (
        this.snapshot.status !== "failed" &&
        this.snapshot.status !== "blocked"
      ) {
        return false;
      }
      this.#update({ status: "running", errors: Object.freeze([]) });
      this.#emit("workflow:retry", this.snapshot.currentStep);
      await this.#executeStep(this.snapshot.currentStep, true, activeSignal);
      return true;
    } finally {
      this.#endTransition();
    }
  }

  async cancel(signal?: AbortSignal): Promise<boolean> {
    if (this.#disposed) throw new Error("Workflow runner is disposed");
    const requestSignal = signal ?? new AbortController().signal;
    requestSignal.throwIfAborted();
    if (this.#cancelRequest) return this.#cancelRequest;
    if (this.snapshot.status === "completed") return false;
    if (this.snapshot.status === "cancelled") {
      if (this.#cancellationDurable) return false;
      const retry = this.#persistCancellation(requestSignal)
        .then(() => true)
        .finally(() => {
          if (this.#cancelRequest === retry) {
            this.#cancelRequest = undefined;
          }
        });
      this.#cancelRequest = retry;
      return retry;
    }
    const decision = this.#decideCancellation(requestSignal);
    this.#cancelDecision = decision;
    const request = decision
      .then(async (approved) => {
        if (!approved) return false;
        await this.#persistCancellation(requestSignal);
        return true;
      })
      .finally(() => {
        if (this.#cancelDecision === decision) {
          this.#cancelDecision = undefined;
        }
        if (this.#cancelRequest === request) {
          this.#cancelRequest = undefined;
        }
      });
    this.#cancelRequest = request;
    return request;
  }

  async rollback(signal?: AbortSignal): Promise<void> {
    if (!this.#beginTransition()) {
      throw new Error(`Workflow "${this.definition.id}" is transitioning`);
    }
    try {
      if (this.#pendingStepWork) {
        throw new Error(
          `Workflow "${this.definition.id}" cannot roll back while a timed-out step is still stopping`,
        );
      }
      if (this.#cancelRequest) {
        throw new Error(
          `Workflow "${this.definition.id}" cannot roll back while cancellation is pending`,
        );
      }
      if (this.#controller.signal.aborted) {
        this.#controller = new AbortController();
      }
      const activeSignal = this.#activeSignal(signal);
      activeSignal.throwIfAborted();
      this.#update({ status: "rolling-back" });
      this.#emit("workflow:rollback", this.snapshot.currentStep);
      for (const operation of [
        ...this.#operationExecutors.values(),
      ].reverse()) {
        await operation.rollback(activeSignal);
        await this.#checkpoint(activeSignal);
      }
      await this.#compensateParallel(activeSignal);
      await this.#checkpoint(activeSignal);
      await this.#nestedRunner?.rollback(activeSignal);
      await this.#checkpoint(activeSignal);
      for (const stepId of [...this.snapshot.completedSteps].reverse()) {
        await this.definition.steps[stepId]?.compensate?.(
          this.#context(activeSignal),
        );
        await this.#checkpoint(activeSignal);
      }
      this.#update({
        status: "idle",
        currentStep: undefined,
        completedSteps: Object.freeze([]),
        skippedSteps: Object.freeze([]),
        history: Object.freeze([]),
        errors: Object.freeze([]),
        operations: Object.freeze([]),
        nestedWorkflow: undefined,
        parallel: Object.freeze([]),
        state: initialValue(this.definition),
        startedAt: undefined,
        completedAt: undefined,
      });
      this.#clearExecutors();
      await this.#removePersistence(activeSignal);
      await this.#checkpoint(activeSignal);
    } finally {
      this.#endTransition();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#controller.abort(new DOMException("Disposed", "AbortError"));
    this.#clearExecutors();
    this.#observers.clear();
  }

  async #enterFirstAvailable(
    stepId: string,
    completedSteps: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    const step = this.definition.steps[stepId];
    if (!step) throw new Error(`Unknown workflow step "${stepId}"`);
    const available = !step.when || (await step.when(this.#context(signal)));
    await this.#checkpoint(signal);
    if (!available) {
      this.#update({
        completedSteps,
        skippedSteps: Object.freeze([
          ...new Set([...this.snapshot.skippedSteps, stepId]),
        ]),
      });
      const next = await this.#nextStep(stepId, signal);
      if (next) {
        await this.#enterFirstAvailable(next, completedSteps, signal);
      } else {
        await this.#complete();
      }
      return;
    }
    this.#update({
      status: "running",
      currentStep: stepId,
      completedSteps,
      history: Object.freeze([...this.snapshot.history, stepId]),
      errors: Object.freeze([]),
    });
    this.#emit("workflow:step-enter", stepId);
    await this.#executeStep(stepId, true, signal);
    await this.#persist(signal);
  }

  async #executeStep(
    stepId: string | undefined,
    includeEnter: boolean,
    parentSignal: AbortSignal,
  ): Promise<void> {
    if (!stepId) return;
    const step = this.definition.steps[stepId];
    if (!step) return;
    const localController = new AbortController();
    const signal = AbortSignal.any([parentSignal, localController.signal]);
    const timeout = step.timeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let settled = false;
    let work: Promise<void> | undefined;
    try {
      work = this.#runStepWork(stepId, signal, includeEnter).finally(() => {
        settled = true;
      });
      await (timeout && timeout > 0
        ? Promise.race([
            work,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                const error = new Error(
                  `Workflow step "${stepId}" timed out after ${timeout}ms`,
                );
                timedOut = true;
                localController.abort(error);
                reject(error);
              }, timeout);
            }),
          ])
        : work);
    } catch (error) {
      if (parentSignal.aborted && this.snapshot.status === "cancelled") {
        throw parentSignal.reason ?? error;
      }
      await Promise.resolve();
      if (timedOut && !settled && work) {
        const pending = this.#runPendingStepCleanup(work);
        this.#pendingStepWork = pending;
      }
      this.#update({
        status: "failed",
        errors: Object.freeze([
          error instanceof Error ? error.message : String(error),
        ]),
      });
      this.#emit("workflow:error", stepId, error);
      await this.#persist(parentSignal);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #runPendingStepCleanup(work: Promise<void>): Promise<void> {
    try {
      await work;
    } catch {
      // The original attempt reports its own failure.
    } finally {
      this.#pendingStepWork = undefined;
    }
  }

  async #runStepWork(
    stepId: string,
    signal: AbortSignal,
    includeEnter: boolean,
  ): Promise<void> {
    const step = this.definition.steps[stepId];
    if (!step) return;
    const context = this.#context(signal);
    if (includeEnter) await step.enter?.(context);
    signal.throwIfAborted();
    if (step.nested) {
      if (!this.#nestedRunner) {
        const nestedRunner = createWorkflow(step.nested);
        this.#attachNested(nestedRunner);
        await nestedRunner.start(signal);
        this.#update({ nestedWorkflow: nestedRunner.snapshot });
      }
      signal.throwIfAborted();
    }
    if (step.parallel) {
      const results = await Promise.allSettled(
        step.parallel.map(async (rawBranch, index) => {
          const branch =
            typeof rawBranch === "function"
              ? {
                  id: `${stepId}:${index}`,
                  run: rawBranch,
                  compensate: undefined,
                }
              : rawBranch;
          const previous = this.snapshot.parallel.find(
            (candidate) =>
              candidate.stepId === stepId && candidate.id === branch.id,
          );
          if (previous?.status === "succeeded") return;
          this.#setParallelBranch({
            id: branch.id,
            stepId,
            status: "running",
          });
          try {
            await branch.run(context);
            signal.throwIfAborted();
            this.#setParallelBranch({
              id: branch.id,
              stepId,
              status: "succeeded",
            });
          } catch (error) {
            this.#setParallelBranch({
              id: branch.id,
              stepId,
              status: signal.aborted ? "cancelled" : "failed",
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }),
      );
      const failures = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((failure) => failure.reason),
          `Parallel workflow step "${stepId}" failed`,
        );
      }
      signal.throwIfAborted();
    }
    for (const definition of step.operations ?? []) {
      const existing = this.#operationExecutors.get(definition.id);
      if (existing?.state.status === "succeeded") continue;
      const operation = createOperation(definition);
      this.#attachOperation(definition.id, operation);
      await operation.execute(signal);
    }
  }

  #setParallelBranch(branch: WorkflowParallelSnapshot): void {
    const parallel = this.snapshot.parallel.filter(
      (candidate) =>
        candidate.stepId !== branch.stepId || candidate.id !== branch.id,
    );
    this.#update({
      parallel: Object.freeze([...parallel, Object.freeze(branch)]),
    });
    void this.#persist().catch((error) => {
      this.#emit("workflow:error", branch.stepId, error);
    });
  }

  async #compensateParallel(signal: AbortSignal): Promise<void> {
    for (const [stepId, step] of Object.entries(
      this.definition.steps,
    ).reverse()) {
      for (const [index, rawBranch] of [
        ...(step.parallel ?? []).entries(),
      ].reverse()) {
        if (typeof rawBranch === "function" || !rawBranch.compensate) continue;
        const id = rawBranch.id || `${stepId}:${index}`;
        const snapshot = this.snapshot.parallel.find(
          (candidate) =>
            candidate.stepId === stepId &&
            candidate.id === id &&
            candidate.status === "succeeded",
        );
        if (!snapshot) continue;
        await rawBranch.compensate(this.#context(signal));
        signal.throwIfAborted();
      }
    }
  }

  async #nextStep(
    stepId: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    for (const candidate of this.definition.transitions) {
      if (candidate.from !== stepId) continue;
      const matches =
        !candidate.when || (await candidate.when(this.#context(signal)));
      await this.#checkpoint(signal);
      if (matches) {
        return candidate.to;
      }
    }
    await this.#checkpoint(signal);
    return undefined;
  }

  async #decideCancellation(signal: AbortSignal): Promise<boolean> {
    if (!(await this.#canCancel(signal))) return false;
    if (
      this.snapshot.status === "completed" ||
      this.snapshot.status === "cancelled"
    ) {
      return false;
    }
    const reason = new DOMException("Cancelled", "AbortError");
    this.#commitCancellation(reason);
    return true;
  }

  async #canCancel(signal: AbortSignal): Promise<boolean> {
    if (
      this.snapshot.status === "completed" ||
      this.snapshot.status === "cancelled"
    ) {
      return true;
    }
    if (
      this.definition.exitGuard &&
      !(await this.definition.exitGuard(this.#context(signal)))
    ) {
      return false;
    }
    signal.throwIfAborted();
    if (this.#nestedRunner && !(await this.#nestedRunner.#canCancel(signal))) {
      return false;
    }
    signal.throwIfAborted();
    return true;
  }

  #commitCancellation(reason: unknown): void {
    if (
      this.snapshot.status === "completed" ||
      this.snapshot.status === "cancelled"
    ) {
      return;
    }
    this.#controller.abort(reason);
    this.#cancellationDurable = false;
    for (const operation of this.#operationExecutors.values()) {
      operation.cancel(reason);
    }
    if (this.#nestedRunner) {
      this.#nestedRunner.#commitCancellation(reason);
    }
    this.#update({ status: "cancelled", completedAt: Date.now() });
    this.#emit("workflow:cancel", this.snapshot.currentStep);
  }

  async #persistCancellation(signal: AbortSignal): Promise<void> {
    if (this.#nestedRunner && !this.#nestedRunner.#cancellationDurable) {
      await this.#nestedRunner.#persistCancellation(signal);
    }
    signal.throwIfAborted();
    if (!this.#cancellationDurable) {
      await this.#persist(signal);
      this.#cancellationDurable = true;
    }
  }

  async #checkpoint(signal: AbortSignal): Promise<void> {
    await this.#cancelDecision;
    signal.throwIfAborted();
  }

  #nestedIsComplete(): boolean {
    return this.#nestedRunner?.snapshot.status === "completed";
  }

  #beginTransition(): boolean {
    if (this.#disposed) throw new Error("Workflow runner is disposed");
    if (this.#transitioning) return false;
    this.#transitioning = true;
    this.#update({ transitioning: true });
    return true;
  }

  #endTransition(): void {
    this.#transitioning = false;
    this.#update({ transitioning: false });
  }

  #activeSignal(signal?: AbortSignal): AbortSignal {
    return signal
      ? AbortSignal.any([this.#controller.signal, signal])
      : this.#controller.signal;
  }

  async #restorePersisted(
    value: PersistedWorkflow<TState>,
    signal: AbortSignal,
  ): Promise<void> {
    const restoredOperations = Object.freeze(
      (value.operations ?? []).map((operation) =>
        ["queued", "running", "waiting", "retrying"].includes(operation.status)
          ? Object.freeze({
              ...operation,
              status: "failed" as const,
              completedAt: Date.now(),
              error: Object.freeze({
                name: "OperationInterruptedError",
                message: "Operation was interrupted before workflow recovery",
              }),
            })
          : operation,
      ),
    );
    const restoredParallel = Object.freeze(
      (value.parallel ?? []).map((branch) =>
        branch.status === "running"
          ? Object.freeze({
              ...branch,
              status: "failed" as const,
              error: "Parallel branch was interrupted before workflow recovery",
            })
          : branch,
      ),
    );
    const interrupted =
      restoredOperations.some(
        (operation, index) => operation !== (value.operations ?? [])[index],
      ) ||
      restoredParallel.some(
        (branch, index) => branch !== (value.parallel ?? [])[index],
      );
    const status = interrupted
      ? "failed"
      : value.status === "completed" ||
          value.status === "cancelled" ||
          value.status === "failed" ||
          value.status === "blocked"
        ? value.status
        : "running";
    const preparedOperations: [string, ReturnType<typeof createOperation>][] =
      [];
    let preparedNested: WorkflowRunner<unknown> | undefined;
    try {
      for (const snapshot of restoredOperations) {
        const definition = Object.values(this.definition.steps)
          .flatMap((step) => [...(step.operations ?? [])])
          .find((candidate) => candidate.id === snapshot.id);
        if (!definition) continue;
        const operation = createOperation(definition);
        operation.restore(snapshot);
        preparedOperations.push([definition.id, operation]);
      }
      const step = value.currentStep
        ? this.definition.steps[value.currentStep]
        : undefined;
      if (step?.nested && value.nested) {
        preparedNested = createWorkflow(step.nested);
        const nestedValue =
          value.nested.version === step.nested.version
            ? value.nested
            : await step.nested.migrate?.(value.nested, signal);
        await this.#checkpoint(signal);
        if (!nestedValue) {
          throw new Error(
            `Nested workflow "${step.nested.id}" requires a migration from version ${value.nested.version}`,
          );
        }
        await preparedNested.#restorePersisted(nestedValue, signal);
      }
      await this.#checkpoint(signal);
    } catch (error) {
      for (const [, operation] of preparedOperations) operation.dispose();
      preparedNested?.dispose();
      throw error;
    }
    this.#clearExecutors();
    this.#update({
      status,
      state: value.state,
      currentStep: value.currentStep,
      completedSteps: Object.freeze([...value.completedSteps]),
      skippedSteps: Object.freeze([...value.skippedSteps]),
      history: Object.freeze([...value.history]),
      errors: Object.freeze(
        interrupted
          ? [
              ...(value.errors ?? []),
              "Workflow work was interrupted and must be retried",
            ]
          : (value.errors ??
              (status === "failed"
                ? ["Workflow failed before it was persisted"]
                : [])),
      ),
      operations: restoredOperations,
      parallel: restoredParallel,
      nestedWorkflow: undefined,
      startedAt: Date.now(),
      completedAt:
        value.status === "completed" || value.status === "cancelled"
          ? Date.now()
          : undefined,
    });
    this.#cancellationDurable = status === "cancelled";
    for (const [id, operation] of preparedOperations) {
      this.#attachOperation(id, operation);
    }
    if (preparedNested) {
      this.#attachNested(preparedNested);
      this.#update({ nestedWorkflow: preparedNested.snapshot });
    }
  }

  #attachNested(runner: WorkflowRunner<unknown>): void {
    this.#nestedUnsubscribe?.();
    this.#nestedRunner?.dispose();
    this.#nestedRunner = runner;
    this.#nestedUnsubscribe = runner.subscribe(() => {
      this.#update({ nestedWorkflow: runner.snapshot });
      if (this.#controller.signal.aborted) return;
      void this.#persist().catch((error) => {
        this.#emit("workflow:error", this.snapshot.currentStep, error);
      });
    });
  }

  #attachOperation(
    id: string,
    operation: ReturnType<typeof createOperation>,
  ): void {
    this.#operationUnsubscribes.get(id)?.();
    this.#operationExecutors.get(id)?.dispose();
    this.#operationExecutors.set(id, operation);
    this.#operationUnsubscribes.set(
      id,
      operation.subscribe(() => {
        this.#update({
          operations: Object.freeze(
            [...this.#operationExecutors.values()].map(
              (candidate) => candidate.state,
            ),
          ),
        });
      }),
    );
    this.#update({
      operations: Object.freeze(
        [...this.#operationExecutors.values()].map(
          (candidate) => candidate.state,
        ),
      ),
    });
  }

  #clearExecutors(): void {
    this.#nestedUnsubscribe?.();
    this.#nestedUnsubscribe = undefined;
    this.#nestedRunner?.dispose();
    this.#nestedRunner = undefined;
    for (const unsubscribe of this.#operationUnsubscribes.values()) {
      unsubscribe();
    }
    this.#operationUnsubscribes.clear();
    for (const operation of this.#operationExecutors.values()) {
      operation.dispose();
    }
    this.#operationExecutors.clear();
  }

  async #complete(): Promise<void> {
    this.#update({ status: "completed", completedAt: Date.now() });
    this.#emit("workflow:complete", this.snapshot.currentStep);
    await this.#persist();
  }

  #context(
    signal: AbortSignal = this.#controller.signal,
  ): WorkflowContext<TState> {
    return {
      state: this.snapshot.state,
      signal,
      runner: this,
    };
  }

  async #persist(signal: AbortSignal = this.#controller.signal): Promise<void> {
    if (!this.definition.persistence) return;
    signal.throwIfAborted();
    const value = this.#persistedValue();
    await this.#enqueuePersistence(async () => {
      signal.throwIfAborted();
      await this.definition.persistence?.save(
        this.definition.id,
        value,
        signal,
      );
    });
  }

  async #removePersistence(signal: AbortSignal): Promise<void> {
    if (!this.definition.persistence?.remove) return;
    signal.throwIfAborted();
    await this.#enqueuePersistence(async () => {
      signal.throwIfAborted();
      await this.definition.persistence?.remove?.(this.definition.id, signal);
    });
  }

  async #enqueuePersistence(work: () => Promise<void>): Promise<void> {
    const queued = this.#persistenceQueue.catch(() => undefined).then(work);
    this.#persistenceQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    await queued;
  }

  #persistedValue(): PersistedWorkflow<TState> {
    return Object.freeze({
      version: this.definition.version,
      state: this.snapshot.state,
      currentStep: this.snapshot.currentStep,
      completedSteps: this.snapshot.completedSteps,
      skippedSteps: this.snapshot.skippedSteps,
      history: this.snapshot.history,
      status: this.snapshot.status,
      errors: this.snapshot.errors,
      nested: this.#nestedRunner
        ? this.#nestedRunner.#persistedValue()
        : undefined,
      parallel: this.snapshot.parallel,
      operations: this.snapshot.operations,
    });
  }

  #update(patch: Partial<WorkflowSnapshot<TState>>): void {
    if (this.#disposed) return;
    this.#store.setState((state) => Object.freeze({ ...state, ...patch }));
  }

  #emit(type: WorkflowEventType, step?: string, error?: unknown): void {
    if (this.#disposed) return;
    const event = Object.freeze({
      type,
      snapshot: this.snapshot,
      step,
      error,
      at: Date.now(),
    });
    try {
      this.definition.analytics?.(event);
    } catch (analyticsError) {
      try {
        this.definition.onObserverError?.(analyticsError);
      } catch {
        // Observer error reporting must not corrupt workflow state.
      }
    }
    for (const observer of this.#observers) {
      try {
        observer(event);
      } catch (observerError) {
        try {
          this.definition.onObserverError?.(observerError);
        } catch {
          // Observer error reporting must not corrupt workflow state.
        }
      }
    }
  }
}

export function createWorkflow<TState>(
  definition: WorkflowDefinition<TState>,
): WorkflowRunner<TState> {
  return new WorkflowRunner(definition);
}
