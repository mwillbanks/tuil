import { describe, expect, test } from "bun:test";
import {
  createTuilGhosttyDocumentSession,
  generatePlaygroundTsx,
  type PlaygroundDocumentV1,
  validatePlaygroundDocument,
} from "./document";
import {
  createTuilGhosttyFeasibilityApp,
  initializeTuilGhostty,
} from "./index";
import ansiEscapes from "./shims/ansi-escapes";
import { CodeDocument } from "./shims/code";
import { throttle } from "./shims/es-toolkit-compat";
import EventEmitter from "./shims/events";
import fs from "./shims/fs";
import fsPromises from "./shims/fs-promises";
import moduleShim from "./shims/module";
import os from "./shims/os";
import path from "./shims/path";
import processShim from "./shims/process";
import { FileManagerApplication } from "./shims/production-examples";
import Stream, { Readable, Writable } from "./shims/stream";
import { BrowserReadableStream, BrowserWritableStream } from "./streams";

describe("browser terminal streams", () => {
  test("forwards input and bounds queued bytes", () => {
    const stream = new BrowserReadableStream(80, 24, 4);
    let failure: unknown;
    stream.on("error", (error) => {
      failure = error;
    });

    stream.push("ok");
    stream.push("toolong");

    expect(stream.read()).toBe("ok");
    expect(stream.read()).toBeNull();
    expect(failure).toBeInstanceOf(RangeError);
  });

  test("preserves asynchronous output order", async () => {
    const writes: string[] = [];
    const callbacks: Array<() => void> = [];
    const stream = new BrowserWritableStream(
      {
        write(data, callback) {
          writes.push(String(data));
          callbacks.push(callback ?? (() => undefined));
        },
      },
      80,
      24,
    );

    stream.write("one");
    stream.write("two");
    expect(writes).toEqual(["one"]);
    callbacks.shift()?.();
    expect(writes).toEqual(["one", "two"]);
    callbacks.shift()?.();
    await stream.whenIdle();
  });

  test("emits one resize event per changed size", () => {
    const stream = new BrowserWritableStream(
      { write: (_data, callback) => callback?.() },
      80,
      24,
    );
    let events = 0;
    stream.on("resize", () => events++);

    stream.resize(80, 24);
    stream.resize(120, 40);

    expect(events).toBe(1);
    expect([stream.columns, stream.rows]).toEqual([120, 40]);
  });

  test("settles late writes after disposal", () => {
    const stream = new BrowserWritableStream(
      { write: (_data, callback) => callback?.() },
      80,
      24,
    );
    stream.destroy();
    let failure: Error | null | undefined;

    expect(stream.write("late", (error) => (failure = error))).toBe(false);
    expect(failure?.message).toBe("Browser terminal output is closed");
  });
});

describe("visual playground document", () => {
  const document: PlaygroundDocumentV1 = {
    version: 1,
    terminal: { width: 80, height: 24, theme: "default-dark" },
    root: {
      id: "application",
      component: "Box",
      props: { flexDirection: "column" },
      children: [
        {
          id: "message",
          component: "Text",
          props: { children: "Ready", color: "green" },
        },
      ],
    },
  };

  test("validates and generates deterministic TSX", () => {
    expect(validatePlaygroundDocument(document)).toBe(document);
    expect(generatePlaygroundTsx(document)).toContain(
      'import { Box, Text } from "@mwillbanks/tuil-ink"',
    );
    expect(generatePlaygroundTsx(document)).toBe(
      generatePlaygroundTsx(document),
    );
  });

  test("rejects unknown props, duplicate ids, and cycles", () => {
    expect(() =>
      validatePlaygroundDocument({
        ...document,
        root: { ...document.root, props: { dangerous: true } },
      }),
    ).toThrow("Unsupported Box prop");
    const duplicate = {
      ...document,
      root: {
        ...document.root,
        children: [
          { id: "application", component: "Text" as const, props: {} },
        ],
      },
    };
    expect(() => validatePlaygroundDocument(duplicate)).toThrow(
      "duplicate node id",
    );
    const props: Record<string, unknown> = {};
    props["children"] = props;
    expect(() =>
      validatePlaygroundDocument({
        ...document,
        root: { ...document.root, props },
      }),
    ).toThrow();
  });

  test("renders named slots and updates a persistent document session", async () => {
    const slotted: PlaygroundDocumentV1 = {
      ...document,
      root: {
        id: "shell",
        component: "AppShell",
        props: {},
        slots: {
          appBar: [
            { id: "title", component: "Text", props: { children: "Title" } },
          ],
          main: [document.root],
          statusBar: [
            { id: "status", component: "Text", props: { children: "Ready" } },
          ],
        },
      },
    };
    const source = generatePlaygroundTsx(slotted);
    expect(source).toContain("<AppShell.AppBar>");
    expect(source).toContain("<AppShell.Main>");
    expect(source).toContain("<AppShell.StatusBar>");
    const session = createTuilGhosttyDocumentSession(document);
    session.update(slotted);
    expect(session.getDocument()).toBe(slotted);
    await session.app.stop();
    expect(() =>
      validatePlaygroundDocument({
        ...document,
        root: { ...document.root, slots: { unsupported: [] } },
      }),
    ).toThrow("Unsupported Box slot");
  });
});

describe("browser compatibility boundary", () => {
  test("loads adapter entrypoints and explicit narrow shims", async () => {
    const app = createTuilGhosttyFeasibilityApp();
    expect(app.id).toBe("tuil-ghostty-feasibility");
    await app.stop();
    expect(new EventEmitter()).toBeInstanceOf(EventEmitter);
    expect(new Stream()).toBeInstanceOf(Stream);
    expect(new Readable().isTTY).toBeTrue();
    expect(new Writable().isTTY).toBeTrue();
    expect(moduleShim.builtinModules).toEqual([]);
    expect(os.platform()).toBe("browser");
    expect(path.basename("/one/two.ts")).toBe("two.ts");
    expect(path.dirname("/one/two.ts")).toBe("/one");
    expect(path.relative("/one", "/one/two.ts")).toBe("two.ts");
    expect(processShim.cwd()).toBe("/");
    expect(() => fs.readFileSync()).toThrow("Filesystem access is unavailable");
    await expect(fsPromises.readFile("fixture")).rejects.toThrow(
      "Filesystem access is unavailable",
    );
    expect(ansiEscapes.cursorTo(2, 3)).toBe("\u001b[4;3H");
    const code = new CodeDocument('const answer = "42";', {
      language: "typescript",
    });
    expect((await code.parse()).spans.length).toBeGreaterThan(0);
    expect(code.render({ lineNumbers: true })[0]).toContain("const answer");
    const calls: string[] = [];
    const throttled = throttle((value: string) => calls.push(value), 0);
    throttled("ready");
    expect(calls).toEqual(["ready"]);
    expect(FileManagerApplication()).toBeTruthy();
    expect((await initializeTuilGhostty()).Terminal).toBeFunction();
    await import("../../../tooling/build/bundle-ghostty-web.ts");
  });
});
