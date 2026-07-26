import { expect, test } from "bun:test";
import {
  createOperation,
  defineOperation,
  OperationBlockedError,
} from "./index.ts";

test("operations report progress, batch bounded logs, retry, nest, cancel, and rollback", async () => {
  let attempts = 0;
  const rolledBack: string[] = [];
  const child = defineOperation({
    id: "child",
    title: "Child",
    run: ({ log }) => {
      log("child");
      return "child-result";
    },
    rollback: () => {
      rolledBack.push("child");
    },
  });
  const operation = createOperation(
    defineOperation({
      id: "parent",
      title: "Parent",
      retries: 1,
      run: async ({ updateProgress, log, runChild }) => {
        attempts += 1;
        log(`attempt:${attempts}`);
        if (attempts === 1) throw new Error("retry");
        updateProgress({ current: 1, total: 1 });
        return runChild(child);
      },
      rollback: () => {
        rolledBack.push("parent");
      },
    }),
    { maxLogs: 2 },
  );
  const statuses: string[] = [];
  operation.observe((event) => statuses.push(event.operation.status));
  expect(await operation.execute()).toBe("child-result");
  expect(operation.state.status).toBe("succeeded");
  expect(operation.state.progress).toEqual({ current: 1, total: 1 });
  expect(operation.state.children[0]?.status).toBe("succeeded");
  expect(operation.state.logs.length).toBeLessThanOrEqual(2);
  expect(statuses).toContain("retrying");
  await operation.rollback();
  expect(rolledBack).toEqual(["child", "parent"]);

  const cancellation = createOperation(
    defineOperation({
      id: "cancel",
      title: "Cancel",
      run: async ({ signal }) => {
        await Bun.sleep(20);
        signal.throwIfAborted();
      },
    }),
  );
  const running = cancellation.execute();
  cancellation.cancel("stop");
  await expect(running).rejects.toBe("stop");
  expect(cancellation.state.status).toBe("cancelled");
});

test("operations support waiting, blocking, timeout retries, and reuse after cancellation", async () => {
  const states: string[] = [];
  const waiting = createOperation(
    defineOperation({
      id: "wait",
      title: "Wait",
      run: ({ waitFor }) => waitFor(Bun.sleep(1).then(() => "ready")),
    }),
  );
  waiting.observe((event) => states.push(event.operation.status));
  expect(await waiting.execute()).toBe("ready");
  expect(states).toContain("waiting");
  expect(waiting.state.status).toBe("succeeded");

  const blocked = createOperation(
    defineOperation({
      id: "blocked",
      title: "Blocked",
      run: ({ block }) => block("Approval required"),
    }),
  );
  await expect(blocked.execute()).rejects.toBeInstanceOf(OperationBlockedError);
  expect(blocked.state.status).toBe("blocked");
  expect(blocked.state.error?.message).toBe("Approval required");

  let active = 0;
  let maximumActive = 0;
  let timedAttempts = 0;
  const timed = createOperation(
    defineOperation({
      id: "timed",
      title: "Timed",
      timeout: 5,
      retries: 1,
      run: ({ signal }) =>
        new Promise<string>((resolve, reject) => {
          timedAttempts += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          const timer = setTimeout(() => {
            active -= 1;
            resolve("late");
          }, 30);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              active -= 1;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    }),
  );
  await expect(timed.execute()).rejects.toThrow("timed out");
  expect(timedAttempts).toBe(2);
  expect(maximumActive).toBe(1);
  expect(timed.state.status).toBe("failed");

  let executions = 0;
  const reusable = createOperation(
    defineOperation({
      id: "reusable",
      title: "Reusable",
      run: () => {
        executions += 1;
        return executions;
      },
    }),
  );
  reusable.cancel();
  expect(await reusable.execute()).toBe(1);
});

test("non-cooperative work is fenced after timeout or cancellation", async () => {
  let timeoutAttempts = 0;
  const timed = createOperation(
    defineOperation({
      id: "non-cooperative-timeout",
      title: "Non-cooperative timeout",
      timeout: 2,
      retries: 2,
      run: async ({ updateProgress }) => {
        timeoutAttempts += 1;
        await Bun.sleep(25);
        updateProgress({ current: 99 });
        return "late";
      },
    }),
  );
  const started = performance.now();
  await expect(timed.execute()).rejects.toThrow("timed out");
  expect(performance.now() - started).toBeLessThan(20);
  expect(timeoutAttempts).toBe(1);
  await Bun.sleep(30);
  expect(timed.state.status).toBe("failed");
  expect(timed.state.progress).toBeUndefined();

  const cancelled = createOperation(
    defineOperation({
      id: "non-cooperative-cancel",
      title: "Non-cooperative cancel",
      run: async ({ updateProgress }) => {
        await Bun.sleep(25);
        updateProgress({ current: 100 });
        return "late";
      },
    }),
  );
  const running = cancelled.execute();
  await Bun.sleep(1);
  const cancelStarted = performance.now();
  cancelled.cancel("stop now");
  await expect(running).rejects.toBe("stop now");
  expect(performance.now() - cancelStarted).toBeLessThan(20);
  await Bun.sleep(30);
  expect(cancelled.state.status).toBe("cancelled");
  expect(cancelled.state.progress).toBeUndefined();
});

test("operation observer failures are isolated", async () => {
  const observerErrors: unknown[] = [];
  const operation = createOperation(
    defineOperation({
      id: "observer",
      title: "Observer",
      run: () => "done",
    }),
    {
      onObserverError: (error) => observerErrors.push(error),
    },
  );
  operation.observe(() => {
    throw new Error("observer failed");
  });
  expect(await operation.execute()).toBe("done");
  expect(operation.state.status).toBe("succeeded");
  expect(observerErrors).toHaveLength(3);
});

test("operation retries fence writes from completed attempts", async () => {
  let attempts = 0;
  const operation = createOperation(
    defineOperation({
      id: "attempt-fencing",
      title: "Attempt fencing",
      retries: 1,
      async run({ updateProgress }) {
        attempts += 1;
        if (attempts === 1) {
          void Bun.sleep(20).then(() => {
            updateProgress({ current: 99 });
          });
          throw new Error("retry");
        }
        updateProgress({ current: 1, total: 1 });
        return "done";
      },
    }),
  );
  expect(await operation.execute()).toBe("done");
  await Bun.sleep(25);
  expect(operation.state.status).toBe("succeeded");
  expect(operation.state.progress).toEqual({ current: 1, total: 1 });
});

test("operation retries dispose children owned by failed attempts", async () => {
  let attempts = 0;
  let failedAttemptChildAborted = false;
  const failedAttemptChild = defineOperation({
    id: "failed-attempt-child",
    title: "Failed attempt child",
    run: ({ signal }) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            failedAttemptChildAborted = true;
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  });
  const successfulChild = defineOperation({
    id: "successful-child",
    title: "Successful child",
    run: () => "child-result",
  });
  const operation = createOperation(
    defineOperation({
      id: "attempt-child-ownership",
      title: "Attempt child ownership",
      retries: 1,
      async run({ runChild }) {
        attempts += 1;
        if (attempts === 1) {
          void runChild(failedAttemptChild).catch(() => undefined);
          await Bun.sleep(1);
          throw new Error("retry");
        }
        return runChild(successfulChild);
      },
    }),
  );

  expect(await operation.execute()).toBe("child-result");
  expect(failedAttemptChildAborted).toBeTrue();
  expect(operation.state.children).toHaveLength(1);
  expect(operation.state.children[0]).toMatchObject({
    id: "successful-child",
    status: "succeeded",
  });
});
