import { expect, test } from "bun:test";
import { defineOperation } from "@mwillbanks/tuil-operations";
import {
  createWorkflow,
  defineOperationStep,
  defineStep,
  defineWorkflow,
  type PersistedWorkflow,
  transition,
} from "./index.ts";

test("workflow validates, branches, operates, persists, resumes, navigates back, and rolls back", async () => {
  const storage = new Map<string, PersistedWorkflow<{ cloud: boolean }>>();
  const events: string[] = [];
  const compensated: string[] = [];
  const definition = defineWorkflow<{ cloud: boolean }>({
    id: "project",
    version: 1,
    initialState: { cloud: false },
    persistence: {
      load: (id) => storage.get(id),
      save: (id, value) => {
        storage.set(id, value);
      },
      remove: (id) => {
        storage.delete(id);
      },
    },
    steps: {
      details: defineStep<{ cloud: boolean }>({
        validate: ({ state }) => (state.cloud ? undefined : "Choose cloud"),
        compensate: () => {
          compensated.push("details");
        },
      }),
      cloud: defineStep<{ cloud: boolean }>({
        when: ({ state }) => state.cloud,
      }),
      create: defineOperationStep<{ cloud: boolean }>({
        operations: [
          defineOperation({
            id: "create",
            title: "Create",
            run: () => "created",
            rollback: () => {
              compensated.push("operation");
            },
          }),
        ],
      }),
    },
    transitions: [
      transition("details", "cloud"),
      transition("cloud", "create"),
    ],
    analytics: (event) => events.push(event.type),
  });
  const runner = createWorkflow(definition);
  await runner.start();
  expect(await runner.next()).toBeFalse();
  expect(runner.snapshot.errors).toEqual(["Choose cloud"]);
  await runner.updateState({ cloud: true });
  expect(await runner.next()).toBeTrue();
  expect(runner.snapshot.currentStep).toBe("cloud");
  expect(await runner.back()).toBeTrue();
  expect(runner.snapshot.currentStep).toBe("details");
  await runner.next();
  await runner.next();
  expect(runner.snapshot.operations[0]?.status).toBe("succeeded");
  await runner.next();
  expect(runner.snapshot.status).toBe("completed");
  expect(storage.get("project")?.currentStep).toBe("create");
  expect(events).toContain("workflow:complete");
  await runner.rollback();
  expect(compensated).toEqual(["operation", "details"]);
  expect(storage.has("project")).toBeFalse();

  storage.set("project", {
    version: 1,
    state: { cloud: true },
    currentStep: "cloud",
    completedSteps: ["details"],
    skippedSteps: [],
    history: ["details", "cloud"],
  });
  const resumed = createWorkflow(definition);
  expect(await resumed.resume()).toBeTrue();
  expect(resumed.snapshot.currentStep).toBe("cloud");
});

test("workflow skips conditions, nests, runs parallel work, times out, and migrates", async () => {
  const nested = defineWorkflow({
    id: "nested",
    version: 1,
    initialState: {},
    steps: {
      one: defineStep({ title: "One" }),
      two: defineStep({ title: "Two" }),
    },
    transitions: [transition("one", "two")],
  });
  const branches: string[] = [];
  const outer = createWorkflow(
    defineWorkflow<{ include: boolean }>({
      id: "outer",
      version: 1,
      initialState: { include: false },
      steps: {
        conditional: defineStep<{ include: boolean }>({
          when: ({ state }) => state.include,
        }),
        nested: defineStep<{ include: boolean }>({ nested }),
        parallel: defineStep<{ include: boolean }>({
          parallel: [
            async () => {
              await Bun.sleep(1);
              branches.push("a");
            },
            () => {
              branches.push("b");
            },
          ],
        }),
      },
      transitions: [
        transition("conditional", "nested"),
        transition("nested", "parallel"),
      ],
    }),
  );
  await outer.start();
  expect(outer.snapshot.currentStep).toBe("nested");
  expect(outer.snapshot.skippedSteps).toEqual(["conditional"]);
  expect(outer.snapshot.completedSteps).toEqual([]);
  expect(outer.snapshot.nestedWorkflow?.currentStep).toBe("one");
  await outer.next();
  expect(outer.snapshot.nestedWorkflow?.currentStep).toBe("two");
  expect(outer.snapshot.currentStep).toBe("nested");
  await outer.next();
  expect(outer.snapshot.currentStep).toBe("parallel");
  expect(branches.sort()).toEqual(["a", "b"]);
  await outer.next();
  expect(outer.snapshot.status).toBe("completed");

  const timed = createWorkflow(
    defineWorkflow({
      id: "timed",
      version: 1,
      initialState: {},
      steps: {
        slow: defineStep({
          timeout: 2,
          enter: ({ signal }) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 50);
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(signal.reason);
                },
                { once: true },
              );
            }),
        }),
      },
      transitions: [],
    }),
  );
  await expect(timed.start()).rejects.toThrow("timed out");
  expect(timed.snapshot.status).toBe("failed");

  const persisted: PersistedWorkflow<unknown> = {
    version: 1,
    state: { legacy: true },
    currentStep: "only",
    completedSteps: [],
    skippedSteps: [],
    history: ["only"],
  };
  const migrated = createWorkflow(
    defineWorkflow({
      id: "migrated",
      version: 2,
      initialState: { value: 0 },
      steps: { only: defineStep({}) },
      transitions: [],
      persistence: {
        load: () => persisted,
        save: () => undefined,
      },
      migrate: (value) => ({
        ...value,
        version: 2,
        state: { value: 42 },
      }),
    }),
  );
  expect(await migrated.resume()).toBeTrue();
  expect(migrated.snapshot.state).toEqual({ value: 42 });
});

test("workflow does not overlap retry with non-cooperative timed-out steps", async () => {
  let attempts = 0;
  let active = 0;
  let maximumActive = 0;
  const runner = createWorkflow(
    defineWorkflow({
      id: "non-cooperative-workflow-timeout",
      version: 1,
      initialState: {},
      steps: {
        slow: defineStep({
          timeout: 2,
          enter: async () => {
            attempts += 1;
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            if (attempts === 1) await Bun.sleep(25);
            active -= 1;
          },
        }),
      },
      transitions: [],
    }),
  );
  await expect(runner.start()).rejects.toThrow("timed out");
  expect(await runner.retry()).toBeFalse();
  expect(maximumActive).toBe(1);
  await Bun.sleep(30);
  expect(await runner.retry()).toBeTrue();
  expect(attempts).toBe(2);
  expect(maximumActive).toBe(1);
});

test("workflow cancellation honors guards, persists, rolls back, and can restart", async () => {
  let allowExit = false;
  let savedStatus = "";
  const runner = createWorkflow(
    defineWorkflow({
      id: "cancel",
      version: 1,
      initialState: {},
      steps: {
        required: defineStep({
          validate: () => "Incomplete",
          compensate: () => {
            savedStatus = "compensated";
          },
        }),
        finish: defineStep({}),
      },
      transitions: [transition("required", "finish")],
      persistence: {
        load: () => undefined,
        save: (_id, value) => {
          savedStatus = value.currentStep ?? "";
        },
        remove: () => {
          savedStatus = "removed";
        },
      },
      exitGuard: () => allowExit,
    }),
  );
  await runner.start();
  expect(await runner.next()).toBeFalse();
  expect(runner.snapshot.status).toBe("blocked");
  expect(await runner.skip()).toBeTrue();
  expect(runner.snapshot.currentStep).toBe("finish");
  expect(await runner.cancel()).toBeFalse();
  allowExit = true;
  expect(await runner.cancel()).toBeTrue();
  expect(runner.snapshot.status).toBe("cancelled");
  expect(savedStatus).toBe("finish");
  await runner.rollback();
  expect(savedStatus).toBe("removed");
  await runner.start();
  expect(runner.snapshot.currentStep).toBe("required");
});

test("workflow serializes repeated transitions", async () => {
  let leaves = 0;
  let enters = 0;
  const runner = createWorkflow(
    defineWorkflow({
      id: "serialized",
      version: 1,
      initialState: {},
      steps: {
        first: defineStep({
          leave: async () => {
            leaves += 1;
            await Bun.sleep(5);
          },
        }),
        second: defineStep({
          enter: () => {
            enters += 1;
          },
        }),
      },
      transitions: [transition("first", "second")],
    }),
  );
  await runner.start();
  const results = await Promise.all([runner.next(), runner.next()]);
  expect(results.sort()).toEqual([false, true]);
  expect(leaves).toBe(1);
  expect(enters).toBe(1);
  expect(runner.snapshot.history).toEqual(["first", "second"]);
  expect(runner.snapshot.transitioning).toBeFalse();
});

test("workflow cancellation interrupts an active transition", async () => {
  let aborted = false;
  const runner = createWorkflow(
    defineWorkflow({
      id: "interruptible-cancel",
      version: 1,
      initialState: {},
      steps: {
        slow: defineStep({
          enter: ({ signal }) =>
            new Promise<void>((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  reject(signal.reason);
                },
                { once: true },
              );
            }),
        }),
      },
      transitions: [],
    }),
  );
  const starting = runner.start();
  await Bun.sleep(1);
  expect(runner.snapshot.transitioning).toBeTrue();
  expect(await runner.cancel()).toBeTrue();
  await expect(starting).rejects.toThrow("Cancelled");
  expect(aborted).toBeTrue();
  expect(runner.snapshot.status).toBe("cancelled");
  expect(runner.snapshot.transitioning).toBeFalse();
});

test("workflow cancellation arbitrates asynchronous transition conditions", async () => {
  let releaseCondition: (value: boolean) => void = () => undefined;
  let releaseGuard: (value: boolean) => void = () => undefined;
  let conditionStarted: () => void = () => undefined;
  let guardStarted: () => void = () => undefined;
  const conditionReady = new Promise<void>((resolve) => {
    conditionStarted = resolve;
  });
  const guardReady = new Promise<void>((resolve) => {
    guardStarted = resolve;
  });
  let secondEntered = false;
  const runner = createWorkflow(
    defineWorkflow({
      id: "cancel-arbitration",
      version: 1,
      initialState: {},
      steps: {
        first: defineStep({}),
        second: defineStep({
          enter: () => {
            secondEntered = true;
          },
        }),
      },
      transitions: [
        transition("first", "second", {
          when: () =>
            new Promise<boolean>((resolve) => {
              releaseCondition = resolve;
              conditionStarted();
            }),
        }),
      ],
      exitGuard: () =>
        new Promise<boolean>((resolve) => {
          releaseGuard = resolve;
          guardStarted();
        }),
    }),
  );
  await runner.start();
  const moving = runner.next();
  await conditionReady;
  const cancelling = runner.cancel();
  await guardReady;
  releaseCondition(true);
  await Bun.sleep(1);
  expect(runner.snapshot.currentStep).toBe("first");
  expect(runner.snapshot.status).toBe("running");
  releaseGuard(true);
  expect(await cancelling).toBeTrue();
  await expect(moving).rejects.toThrow("Cancelled");
  expect(secondEntered).toBeFalse();
  expect(runner.snapshot.currentStep).toBe("first");
  expect(runner.snapshot.status).toBe("cancelled");
});

test("workflow cancellation interrupts rollback without resetting cancelled state", async () => {
  let compensationStarted: () => void = () => undefined;
  let releaseCompensation: () => void = () => undefined;
  const compensationReady = new Promise<void>((resolve) => {
    compensationStarted = resolve;
  });
  const compensationGate = new Promise<void>((resolve) => {
    releaseCompensation = resolve;
  });
  const runner = createWorkflow(
    defineWorkflow({
      id: "cancel-rollback",
      version: 1,
      initialState: {},
      steps: {
        only: defineStep({
          compensate: async () => {
            compensationStarted();
            await compensationGate;
          },
        }),
      },
      transitions: [],
    }),
  );
  await runner.start();
  await runner.next();
  expect(runner.snapshot.status).toBe("completed");
  const rollingBack = runner.rollback();
  await compensationReady;
  expect(await runner.cancel()).toBeTrue();
  releaseCompensation();
  await expect(rollingBack).rejects.toThrow("Cancelled");
  expect(runner.snapshot.status).toBe("cancelled");
  expect(runner.snapshot.transitioning).toBeFalse();
});

test("cancellation persistence follows an in-flight rollback removal", async () => {
  let removeStarted: () => void = () => undefined;
  let releaseRemove: () => void = () => undefined;
  const removeReady = new Promise<void>((resolve) => {
    removeStarted = resolve;
  });
  const removeGate = new Promise<void>((resolve) => {
    releaseRemove = resolve;
  });
  let persisted: PersistedWorkflow<unknown> | undefined;
  const runner = createWorkflow(
    defineWorkflow({
      id: "ordered-removal",
      version: 1,
      initialState: {},
      steps: { only: defineStep({}) },
      transitions: [],
      persistence: {
        load: () => persisted,
        save: (_id, value) => {
          persisted = value;
        },
        remove: async () => {
          removeStarted();
          await removeGate;
          persisted = undefined;
        },
      },
    }),
  );
  await runner.start();
  await runner.next();
  const rollingBack = runner.rollback();
  await removeReady;
  const cancelling = runner.cancel();
  releaseRemove();
  await expect(rollingBack).rejects.toThrow("Cancelled");
  expect(await cancelling).toBeTrue();
  expect(runner.snapshot.status).toBe("cancelled");
  expect(persisted?.status).toBe("cancelled");
});

test("committed cancellation retries failed persistence", async () => {
  let attempts = 0;
  let persisted: PersistedWorkflow<unknown> | undefined;
  const runner = createWorkflow(
    defineWorkflow({
      id: "retry-cancel-persistence",
      version: 1,
      initialState: {},
      steps: {},
      transitions: [],
      persistence: {
        load: () => persisted,
        save: (_id, value) => {
          attempts += 1;
          if (attempts === 1) throw new Error("disk down");
          persisted = value;
        },
      },
    }),
  );
  await expect(runner.cancel()).rejects.toThrow("disk down");
  expect(runner.snapshot.status).toBe("cancelled");
  expect(await runner.cancel()).toBeTrue();
  expect(attempts).toBe(2);
  expect(persisted?.status).toBe("cancelled");
  expect(await runner.cancel()).toBeFalse();
});

test("nested exit guards veto parent cancellation before either runner commits", async () => {
  const nested = defineWorkflow({
    id: "guarded-child",
    version: 1,
    initialState: {},
    steps: { child: defineStep({}) },
    transitions: [],
    exitGuard: () => false,
  });
  const runner = createWorkflow(
    defineWorkflow({
      id: "guarded-parent",
      version: 1,
      initialState: {},
      steps: {
        parent: defineStep({ nested }),
      },
      transitions: [],
    }),
  );
  await runner.start();
  expect(await runner.cancel()).toBeFalse();
  expect(runner.snapshot.status).toBe("running");
  expect(runner.snapshot.nestedWorkflow?.status).toBe("running");
});

test("workflow migration receives cancellation and cannot restore after abort", async () => {
  let migrationStarted: () => void = () => undefined;
  let releaseMigration: () => void = () => undefined;
  const migrationReady = new Promise<void>((resolve) => {
    migrationStarted = resolve;
  });
  const migrationGate = new Promise<void>((resolve) => {
    releaseMigration = resolve;
  });
  let migrationSignal: AbortSignal | undefined;
  const runner = createWorkflow(
    defineWorkflow<{ migrated: boolean }>({
      id: "cancellable-migration",
      version: 2,
      initialState: { migrated: false },
      steps: { migrated: defineStep({}) },
      transitions: [],
      persistence: {
        load: () => ({
          version: 1,
          state: { migrated: false },
          currentStep: "legacy",
          completedSteps: [],
          skippedSteps: [],
          history: ["legacy"],
        }),
        save: () => undefined,
      },
      migrate: async (_persisted, signal) => {
        migrationSignal = signal;
        migrationStarted();
        await migrationGate;
        return {
          version: 2,
          state: { migrated: true },
          currentStep: "migrated",
          completedSteps: [],
          skippedSteps: [],
          history: ["migrated"],
        };
      },
    }),
  );
  const controller = new AbortController();
  const resuming = runner.resume(controller.signal);
  await migrationReady;
  controller.abort(new DOMException("Migration cancelled", "AbortError"));
  releaseMigration();
  await expect(resuming).rejects.toThrow("Migration cancelled");
  expect(migrationSignal?.aborted).toBeTrue();
  expect(runner.snapshot.status).toBe("idle");
  expect(runner.snapshot.currentStep).toBeUndefined();
  expect(runner.snapshot.state).toEqual({ migrated: false });
});

test("nested migration cancellation leaves the parent restore uncommitted", async () => {
  let migrationStarted: () => void = () => undefined;
  let releaseMigration: () => void = () => undefined;
  const migrationReady = new Promise<void>((resolve) => {
    migrationStarted = resolve;
  });
  const migrationGate = new Promise<void>((resolve) => {
    releaseMigration = resolve;
  });
  let nestedSignal: AbortSignal | undefined;
  const nested = defineWorkflow<unknown>({
    id: "migrated-child",
    version: 2,
    initialState: { restored: false },
    steps: { child: defineStep({}) },
    transitions: [],
    migrate: async (_persisted, signal) => {
      nestedSignal = signal;
      migrationStarted();
      await migrationGate;
      return {
        version: 2,
        state: { restored: true },
        currentStep: "child",
        completedSteps: [],
        skippedSteps: [],
        history: ["child"],
      };
    },
  });
  const runner = createWorkflow(
    defineWorkflow<{ restored: boolean }>({
      id: "transactional-parent-restore",
      version: 1,
      initialState: { restored: false },
      steps: {
        parent: defineStep({ nested }),
      },
      transitions: [],
      persistence: {
        load: () => ({
          version: 1,
          state: { restored: true },
          currentStep: "parent",
          completedSteps: [],
          skippedSteps: [],
          history: ["parent"],
          nested: {
            version: 1,
            state: { restored: false },
            currentStep: "legacy",
            completedSteps: [],
            skippedSteps: [],
            history: ["legacy"],
          },
        }),
        save: () => undefined,
      },
    }),
  );
  const controller = new AbortController();
  const resuming = runner.resume(controller.signal);
  await migrationReady;
  controller.abort(
    new DOMException("Nested migration cancelled", "AbortError"),
  );
  releaseMigration();
  await expect(resuming).rejects.toThrow("Nested migration cancelled");
  expect(nestedSignal?.aborted).toBeTrue();
  expect(runner.snapshot.status).toBe("idle");
  expect(runner.snapshot.currentStep).toBeUndefined();
  expect(runner.snapshot.history).toEqual([]);
  expect(runner.snapshot.state).toEqual({ restored: false });
  expect(runner.snapshot.nestedWorkflow).toBeUndefined();
});

test("workflow persistence serializes snapshots in mutation order", async () => {
  const completions: number[] = [];
  let stored = -1;
  const runner = createWorkflow(
    defineWorkflow<{ value: number }>({
      id: "ordered-persistence",
      version: 1,
      initialState: { value: 0 },
      steps: { edit: defineStep({}) },
      transitions: [],
      persistence: {
        load: () => undefined,
        save: async (_id, value) => {
          if (value.state.value === 1) await Bun.sleep(20);
          stored = value.state.value;
          completions.push(value.state.value);
        },
      },
    }),
  );
  await runner.start();
  completions.length = 0;
  const first = runner.updateState({ value: 1 });
  const second = runner.updateState({ value: 2 });
  await Promise.all([first, second]);
  expect(completions).toEqual([1, 2]);
  expect(stored).toBe(2);
});

test("nested and parallel progress persists and resumes without repeating successes", async () => {
  const storage = new Map<string, PersistedWorkflow<{ value: number }>>();
  const nested = defineWorkflow({
    id: "child",
    version: 1,
    initialState: {},
    steps: {
      one: defineStep({}),
      two: defineStep({}),
    },
    transitions: [transition("one", "two")],
  });
  let successfulRuns = 0;
  let flakyRuns = 0;
  const compensated: string[] = [];
  const definition = defineWorkflow<{ value: number }>({
    id: "recoverable",
    version: 1,
    initialState: { value: 0 },
    persistence: {
      load: (id) => storage.get(id),
      save: (id, value) => {
        storage.set(id, value);
      },
    },
    steps: {
      nested: defineStep({ nested }),
      parallel: defineStep({
        parallel: [
          {
            id: "successful",
            run: () => {
              successfulRuns += 1;
            },
            compensate: () => {
              compensated.push("successful");
            },
          },
          {
            id: "flaky",
            run: () => {
              flakyRuns += 1;
              if (flakyRuns === 1) throw new Error("flaky");
            },
            compensate: () => {
              compensated.push("flaky");
            },
          },
        ],
      }),
    },
    transitions: [transition("nested", "parallel")],
  });
  const first = createWorkflow(definition);
  await first.start();
  await first.next();
  expect(storage.get("recoverable")?.nested?.currentStep).toBe("two");

  const resumed = createWorkflow(definition);
  expect(await resumed.resume()).toBeTrue();
  expect(resumed.snapshot.nestedWorkflow?.currentStep).toBe("two");
  await expect(resumed.next()).rejects.toThrow("Parallel workflow");
  expect(successfulRuns).toBe(1);
  expect(flakyRuns).toBe(1);
  expect(
    resumed.snapshot.parallel.map((branch) => branch.status).sort(),
  ).toEqual(["failed", "succeeded"]);
  expect(await resumed.retry()).toBeTrue();
  expect(successfulRuns).toBe(1);
  expect(flakyRuns).toBe(2);
  await resumed.next();
  await resumed.rollback();
  expect(compensated).toEqual(["flaky", "successful"]);
});

test("workflow retains successful operations on retry and clears executors on rollback", async () => {
  let firstRuns = 0;
  let secondRuns = 0;
  const rollbacks: string[] = [];
  const runner = createWorkflow(
    defineWorkflow({
      id: "operations-retry",
      version: 1,
      initialState: {},
      steps: {
        execute: defineOperationStep({
          operations: [
            defineOperation({
              id: "first",
              title: "First",
              run: () => {
                firstRuns += 1;
                return "first";
              },
              rollback: () => {
                rollbacks.push("first");
              },
            }),
            defineOperation({
              id: "second",
              title: "Second",
              run: () => {
                secondRuns += 1;
                if (secondRuns === 1) throw new Error("second failed");
                return "second";
              },
              rollback: () => {
                rollbacks.push("second");
              },
            }),
          ],
        }),
      },
      transitions: [],
    }),
  );
  await expect(runner.start()).rejects.toThrow("second failed");
  await runner.retry();
  expect(firstRuns).toBe(1);
  expect(secondRuns).toBe(2);
  await runner.next();
  await runner.rollback();
  expect(rollbacks).toEqual(["second", "first"]);
  await runner.start();
  expect(firstRuns).toBe(2);
});

test("workflow resumes persisted failures for retry without repeating successful operations", async () => {
  const storage = new Map<string, PersistedWorkflow<Record<string, never>>>();
  let firstRuns = 0;
  let secondRuns = 0;
  const definition = defineWorkflow<Record<string, never>>({
    id: "persisted-operation-retry",
    version: 1,
    initialState: {},
    persistence: {
      load: (id) => storage.get(id),
      save: (id, value) => {
        storage.set(id, value);
      },
    },
    steps: {
      execute: defineOperationStep({
        operations: [
          defineOperation({
            id: "persisted-first",
            title: "First",
            run: () => {
              firstRuns += 1;
              return "first";
            },
          }),
          defineOperation({
            id: "persisted-second",
            title: "Second",
            run: () => {
              secondRuns += 1;
              if (secondRuns === 1) throw new Error("retry after resume");
              return "second";
            },
          }),
        ],
      }),
    },
    transitions: [],
  });
  const first = createWorkflow(definition);
  await expect(first.start()).rejects.toThrow("retry after resume");
  expect(storage.get(definition.id)?.status).toBe("failed");

  const resumed = createWorkflow(definition);
  expect(await resumed.resume()).toBeTrue();
  expect(resumed.snapshot.status).toBe("failed");
  expect(resumed.snapshot.errors).toContain("retry after resume");
  expect(await resumed.retry()).toBeTrue();
  expect(firstRuns).toBe(1);
  expect(secondRuns).toBe(2);
  expect(
    resumed.snapshot.operations.map((operation) => operation.status),
  ).toEqual(["succeeded", "succeeded"]);
});

test("workflow converts persisted in-flight work into a retryable interruption", async () => {
  let executions = 0;
  const persisted: PersistedWorkflow<Record<string, never>> = {
    version: 1,
    state: {},
    currentStep: "execute",
    completedSteps: [],
    skippedSteps: [],
    history: ["execute"],
    status: "running",
    operations: [
      {
        id: "interrupted-operation",
        title: "Interrupted operation",
        status: "running",
        attempt: 1,
        startedAt: Date.now(),
        children: [],
        metadata: {},
        logs: [],
      },
    ],
  };
  const runner = createWorkflow(
    defineWorkflow<Record<string, never>>({
      id: "interrupted-resume",
      version: 1,
      initialState: {},
      persistence: {
        load: () => persisted,
        save: () => undefined,
      },
      steps: {
        execute: defineOperationStep({
          operations: [
            defineOperation({
              id: "interrupted-operation",
              title: "Interrupted operation",
              run: () => {
                executions += 1;
                return "recovered";
              },
            }),
          ],
        }),
      },
      transitions: [],
    }),
  );
  expect(await runner.resume()).toBeTrue();
  expect(runner.snapshot.status).toBe("failed");
  expect(runner.snapshot.operations[0]?.status).toBe("failed");
  expect(runner.snapshot.operations[0]?.error?.name).toBe(
    "OperationInterruptedError",
  );
  expect(await runner.retry()).toBeTrue();
  expect(executions).toBe(1);
  expect(runner.snapshot.operations[0]?.status).toBe("succeeded");
});

test("workflow restores interrupted parallel branches and validates explicitly", async () => {
  const persisted: PersistedWorkflow<Record<string, never>> = {
    version: 1,
    state: {},
    currentStep: "parallel",
    completedSteps: [],
    skippedSteps: [],
    history: ["parallel"],
    status: "running",
    parallel: [
      {
        id: "branch",
        stepId: "parallel",
        status: "running",
      },
    ],
  };
  const runner = createWorkflow(
    defineWorkflow({
      id: "parallel-resume",
      version: 1,
      initialState: {},
      persistence: {
        load: () => persisted,
        save: () => undefined,
      },
      steps: {
        parallel: defineStep({
          validate: () => "Review the interrupted branch",
        }),
      },
      transitions: [],
    }),
  );
  expect(await runner.resume()).toBeTrue();
  expect(runner.snapshot.parallel[0]).toMatchObject({
    status: "failed",
    error: "Parallel branch was interrupted before workflow recovery",
  });
  expect(await runner.validate()).toBeFalse();
  expect(runner.snapshot.errors).toEqual(["Review the interrupted branch"]);
});

test("disposing a workflow aborts work and isolates observer failures", async () => {
  const observerErrors: unknown[] = [];
  let lateEnter = false;
  const runner = createWorkflow(
    defineWorkflow({
      id: "dispose",
      version: 1,
      initialState: {},
      steps: {
        slow: defineStep({
          enter: async ({ signal }) => {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                lateEnter = true;
                resolve();
              }, 30);
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(signal.reason);
                },
                { once: true },
              );
            });
          },
        }),
      },
      transitions: [],
      analytics: () => {
        throw new Error("analytics failed");
      },
      onObserverError: (error) => observerErrors.push(error),
    }),
  );
  runner.observe(() => {
    throw new Error("observer failed");
  });
  const starting = runner.start();
  await Bun.sleep(1);
  const snapshot = runner.snapshot;
  runner.dispose();
  await expect(starting).rejects.toThrow();
  await Bun.sleep(35);
  expect(lateEnter).toBeFalse();
  expect(runner.snapshot).toBe(snapshot);
  expect(observerErrors.length).toBeGreaterThan(0);
});
