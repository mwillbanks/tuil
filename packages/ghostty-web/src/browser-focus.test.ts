import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { Terminal } from "ghostty-web";
import { useTestClock } from "../../../tests/helpers/clock";
import {
  createTuilGhosttyFeasibilityApp,
  initializeTuilGhostty,
  mountTuilGhostty,
} from "./browser";

describe("Ghostty mount focus policy", () => {
  const clock = useTestClock();
  beforeAll(async () => {
    await initializeTuilGhostty();
  });

  for (const autoFocus of [undefined, true, false]) {
    test(`mount autoFocus=${String(autoFocus)} preserves explicit focus`, async () => {
      const { Terminal: GhosttyTerminal } = await initializeTuilGhostty();
      const app = createTuilGhosttyFeasibilityApp();
      let focusCount = 0;
      const element = {
        focus: () => {
          focusCount += 1;
        },
      } as unknown as HTMLElement;
      const captured: { terminal?: Terminal } = {};
      // Isolate the mount boundary from canvas/WASM rendering. Keep the real
      // upstream focus implementation, including its deferred focus retry.
      const open = spyOn(GhosttyTerminal.prototype, "open").mockImplementation(
        function (this: Terminal, host: HTMLElement) {
          captured.terminal = this;
          Reflect.set(this, "isOpen", true);
          Reflect.set(this, "element", host);
          this.focus();
        },
      );
      const stop = new Error("stop after open");
      const loadAddon = spyOn(
        GhosttyTerminal.prototype,
        "loadAddon",
      ).mockImplementation(() => {
        throw stop;
      });
      try {
        await expect(
          mountTuilGhostty({ app, element, autoFocus }),
        ).rejects.toBe(stop);
        const initialFocus = autoFocus === false ? 0 : 1;
        expect(focusCount).toBe(initialFocus);
        expect(clock.pending()).toBe(initialFocus);
        await clock.advance(0);
        expect(focusCount).toBe(initialFocus * 2);
        expect(clock.pending()).toBe(0);

        expect(captured.terminal).toBeInstanceOf(GhosttyTerminal);
        if (autoFocus !== false)
          expect(captured.terminal?.constructor).toBe(GhosttyTerminal);
        captured.terminal?.focus();
        expect(focusCount).toBe(initialFocus * 2 + 1);
        expect(clock.pending()).toBe(1);
        await clock.advance(0);
        expect(focusCount).toBe(initialFocus * 2 + 2);
        expect(clock.pending()).toBe(0);
      } finally {
        open.mockRestore();
        loadAddon.mockRestore();
        await app.stop();
      }
    });
  }
});
