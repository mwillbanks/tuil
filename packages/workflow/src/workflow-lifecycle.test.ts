import { expect, test } from "bun:test";
import { useTestClock } from "../../../tests/helpers/clock.ts";
import { createWorkflow, defineWorkflow, transition } from "./index.ts";

useTestClock();

test("guarded transitions reject overlap and ignore movement outside an active step", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const definition = defineWorkflow({
    id: "transition",
    version: 1,
    initialState: 0,
    steps: {
      first: {
        enter: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    },
    transitions: [],
  });
  const runner = createWorkflow(definition);
  try {
    expect(await runner.next()).toBe(false);
    expect(await runner.back()).toBe(false);
    expect(await runner.skip()).toBe(false);
    expect(await runner.retry()).toBe(false);
    expect(await runner.validate()).toBe(true);
    expect(await runner.resume()).toBe(false);

    const starting = runner.start();
    await entered.promise;
    try {
      await expect(runner.start()).rejects.toThrow("transitioning");
      await expect(runner.rollback()).rejects.toThrow("transitioning");
      expect(await runner.resume()).toBe(false);
      expect(await runner.next()).toBe(false);
      expect(await runner.back()).toBe(false);
      expect(await runner.skip()).toBe(false);
      expect(await runner.retry()).toBe(false);
      expect(await runner.validate()).toBe(false);
    } finally {
      release.resolve();
      await starting;
    }
    await expect(runner.start()).rejects.toThrow("already started");
    expect(await runner.skip()).toBe(true);
    expect(runner.snapshot.skippedSteps).toEqual(["first"]);
    expect(runner.snapshot.status).toBe("completed");
    expect(await runner.cancel()).toBe(false);
  } finally {
    runner.dispose();
  }
  runner.dispose();
  await expect(runner.updateState(1)).rejects.toThrow("disposed");
  await expect(runner.cancel()).rejects.toThrow("disposed");
});

test("runs all available parallel jobs and compensates successful jobs in reverse order", async () => {
  const delivered: string[] = [];
  const runner = createWorkflow(
    defineWorkflow({
      id: "parallel",
      version: 1,
      initialState: 0,
      steps: {
        hidden: { when: () => false },
        work: {
          parallel: [
            () => delivered.push("standalone"),
            {
              id: "first",
              run: () => delivered.push("first"),
              compensate: () => {
                delivered.push("undo first");
              },
            },
            {
              id: "second",
              run: () => delivered.push("second"),
              compensate: () => {
                delivered.push("undo second");
              },
            },
          ],
        },
        terminal: {},
      },
      transitions: [
        transition<number>("hidden", "work"),
        transition<number>("work", "terminal"),
      ],
    }),
  );
  try {
    await runner.start();
    expect(runner.snapshot.skippedSteps).toEqual(["hidden"]);
    expect(runner.snapshot.currentStep).toBe("work");
    expect(delivered).toEqual(["standalone", "first", "second"]);
    expect(await runner.next()).toBe(true);
    expect(runner.snapshot.completedSteps).toEqual(["work"]);
    await runner.rollback();
    expect(delivered).toEqual([
      "standalone",
      "first",
      "second",
      "undo second",
      "undo first",
    ]);
    expect(runner.snapshot.status).toBe("idle");
  } finally {
    runner.dispose();
  }
});

test("cancellation waits for the guard, serializes retry, and resets on rollback", async () => {
  const decision = Promise.withResolvers<boolean>();
  let durable = false;
  let guardCalls = 0;
  const runner = createWorkflow(
    defineWorkflow({
      id: "cancel",
      version: 1,
      initialState: 0,
      steps: { first: {} },
      transitions: [],
      exitGuard: () => {
        guardCalls += 1;
        return decision.promise;
      },
      persistence: {
        load: () => undefined,
        save: (_id, snapshot) => {
          if (snapshot.status === "cancelled" && !durable)
            throw new Error("temporary persistence failure");
        },
      },
    }),
  );
  try {
    await runner.start();
    const cancel = runner.cancel();
    const duplicate = runner.cancel();
    const both = Promise.allSettled([cancel, duplicate]);
    await expect(runner.rollback()).rejects.toThrow("cancellation is pending");
    decision.resolve(true);
    expect((await both).map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(guardCalls).toBe(1);
    expect(runner.snapshot.status).toBe("cancelled");
    durable = true;
    expect(await runner.cancel()).toBe(true);
    expect(await runner.cancel()).toBe(false);
    await runner.rollback();
    expect(runner.snapshot.status).toBe("idle");
    await runner.start();
    expect(runner.snapshot.status).toBe("running");
  } finally {
    runner.dispose();
  }
});

test("an empty workflow completes without entering a step", async () => {
  const runner = createWorkflow(
    defineWorkflow({
      id: "empty",
      version: 1,
      initialState: 0,
      steps: {},
      transitions: [],
    }),
  );
  try {
    await runner.start();
    expect(runner.snapshot.status).toBe("completed");
    expect(runner.snapshot.currentStep).toBeUndefined();
  } finally {
    runner.dispose();
  }
});

test("an empty workflow and an unavailable final step complete without entering", async () => {
  const empty = createWorkflow(
    defineWorkflow({
      id: "empty",
      version: 1,
      initialState: 0,
      steps: {},
      transitions: [],
    }),
  );
  const skipped = createWorkflow(
    defineWorkflow({
      id: "hidden",
      version: 1,
      initialState: 0,
      steps: {
        hidden: {
          when: () => false,
          enter: () => {
            throw new Error("hidden step entered");
          },
        },
      },
      transitions: [],
    }),
  );
  try {
    await empty.start();
    expect(empty.snapshot.status).toBe("completed");
    expect(empty.snapshot.history).toEqual([]);
    await skipped.start();
    expect(skipped.snapshot.status).toBe("completed");
    expect(skipped.snapshot.skippedSteps).toEqual(["hidden"]);
    expect(skipped.currentStep).toBeUndefined();
  } finally {
    empty.dispose();
    skipped.dispose();
  }
});

test("resume rejects an incompatible persisted version without replacing state", async () => {
  const runner = createWorkflow(
    defineWorkflow({
      id: "restore",
      version: 2,
      initialState: 7,
      steps: { first: {} },
      transitions: [],
      persistence: {
        load: () => ({
          version: 1,
          state: 8,
          completedSteps: [],
          skippedSteps: [],
          history: ["first"],
          currentStep: "first",
        }),
        save: () => {},
      },
    }),
  );
  try {
    await expect(runner.resume()).rejects.toThrow(
      "requires a migration from version 1",
    );
    expect(runner.snapshot).toMatchObject({
      status: "idle",
      state: 7,
      transitioning: false,
    });
    await runner.start();
    expect(runner.currentStep).toBeDefined();
  } finally {
    runner.dispose();
  }
});

test("a failed persistence write leaves subsequent state updates durable", async () => {
  const writes: number[] = [];
  const runner = createWorkflow(
    defineWorkflow({
      id: "writes",
      version: 1,
      initialState: 0,
      steps: { first: {} },
      transitions: [],
      persistence: {
        load: () => undefined,
        save: (_id, snapshot) => {
          writes.push(snapshot.state);
          if (snapshot.state === 1) throw new Error("storage failed");
        },
      },
    }),
  );
  try {
    await runner.start();
    await expect(runner.updateState(1)).rejects.toThrow("storage failed");
    await runner.updateState((previous) => previous + 1);
    expect(writes).toEqual([0, 1, 2]);
    expect(runner.snapshot.state).toBe(2);
  } finally {
    runner.dispose();
  }
});
