import { afterEach, beforeEach, expect, jest } from "bun:test";

const epoch = 1_700_000_000_000;
export interface TestClock {
  readonly now: () => number;
  readonly pending: () => number;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly advance: (milliseconds: number) => Promise<void>;
  readonly flush: () => Promise<void>;
}

/** Register one virtual clock per test. Production timers use the same globals. */
export function useTestClock(): TestClock {
  let active = false;
  beforeEach(() => {
    jest.useFakeTimers({ now: epoch });
    active = true;
  });
  afterEach(() => {
    try {
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
      active = false;
    }
  });
  function requireActive() {
    if (!active) throw new Error("Use the clock inside its registered test");
  }
  async function flush() {
    requireActive();
    // Drain promise chains without scheduling a real event-loop tick.
    for (let turn = 0; turn < 32; turn += 1) await Promise.resolve();
  }
  async function advance(milliseconds: number) {
    requireActive();
    if (!Number.isFinite(milliseconds) || milliseconds < 0)
      throw new RangeError(
        "Virtual time must advance by a finite nonnegative duration",
      );
    await flush();
    jest.advanceTimersByTime(milliseconds);
    await flush();
  }
  return {
    now: () => {
      requireActive();
      return Date.now();
    },
    pending: () => {
      requireActive();
      return jest.getTimerCount();
    },
    delay: (milliseconds) => {
      requireActive();
      return new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      });
    },
    advance,
    flush,
  };
}

export async function captureRejection(
  promise: Promise<unknown>,
): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}
