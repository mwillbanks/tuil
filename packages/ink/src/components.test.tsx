import { afterEach, describe, expect, test } from "bun:test";
import { createApp, type TuilRuntime, useApp } from "@mwillbanks/tuil";
import { FocusProvider, FocusScope, FocusTrap } from "@mwillbanks/tuil-focus";
import { Hotkey, HotkeyProvider, useHotkeys } from "@mwillbanks/tuil-hotkeys";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createTheme } from "@mwillbanks/tuil-theme";
import { Text as InkText, type Key, renderToString } from "ink";
import { useEffect, useState } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Container,
  DismissableLayer,
  Divider,
  escapeTerminalControlCharacters,
  Heading,
  HStack,
  Progress,
  ResponsiveStack,
  render,
  renderStatic,
  SemanticProvider,
  SemanticRegistry,
  Spinner,
  Stack,
  StatusBar,
  Text,
  useOptionalExternalStore,
  useOverlayStatus,
  useTerminalInput,
  VStack,
} from "./index.ts";
import { TerminalInputRouter } from "./input.ts";

afterEach(cleanup);

describe("foundational Ink components", () => {
  test("renders static and silent applications through their complete lifecycle", async () => {
    const staticApp = createApp({
      component: () => <Text>Static frame</Text>,
      terminal: { mode: "static" },
    });
    expect(await renderStatic(staticApp, { columns: 40 })).toContain(
      "Static frame",
    );
    expect(staticApp.lifecycle.state).toBe("disposed");

    const silentApp = createApp({
      component: () => <Text>Silent frame</Text>,
      terminal: { mode: "silent" },
    });
    const instance = await render(silentApp);
    expect(instance.ink).toBeUndefined();
    await instance.waitUntilExit();
    await instance.unmount();
    await instance.unmount();
    expect(silentApp.lifecycle.state).toBe("disposed");

    const renderedApp = createApp({
      component: () => <Text>Rendered frame</Text>,
      terminal: { mode: "static" },
    });
    const rendered = await render(renderedApp, { patchConsole: false });
    expect(rendered.ink).toBeDefined();
    await rendered.unmount();
  });

  test("rolls back renderer and static-render failures", async () => {
    const mountError = new Error("mount failed");
    const cleanupError = new Error("cleanup failed");
    const failingMount = {
      mode: "silent",
      mount: async () => {
        throw mountError;
      },
      stop: async () => undefined,
    } as unknown as TuilRuntime;
    await expect(render(failingMount)).rejects.toBe(mountError);

    const failingRollback = {
      mode: "silent",
      mount: async () => {
        throw mountError;
      },
      stop: async () => {
        throw cleanupError;
      },
    } as unknown as TuilRuntime;
    await expect(render(failingRollback)).rejects.toBeInstanceOf(
      AggregateError,
    );

    const failingStatic = {
      capabilities: { width: 80 },
      mount: async () => {
        throw mountError;
      },
      stop: async () => undefined,
    } as unknown as TuilRuntime;
    await expect(renderStatic(failingStatic)).rejects.toBe(mountError);

    const failingStaticCleanup = {
      capabilities: { width: 80 },
      mount: async () => {
        throw mountError;
      },
      stop: async () => {
        throw cleanupError;
      },
    } as unknown as TuilRuntime;
    await expect(renderStatic(failingStaticCleanup)).rejects.toBeInstanceOf(
      AggregateError,
    );
  });

  test("renders semantic application primitives and static content", async () => {
    const view = renderTuil(
      <AppShell>
        <AppShell.Main>
          <Stack>
            <Heading>Project</Heading>
            <Text testId="description">Create a project</Text>
            <Badge tone="success">ready</Badge>
            <Progress value={50} label="Half complete" />
            <Alert tone="info" title="Notice">
              Review configuration
            </Alert>
          </Stack>
        </AppShell.Main>
        <AppShell.StatusBar>
          <StatusBar>
            <Text>Ready</Text>
          </StatusBar>
        </AppShell.StatusBar>
      </AppShell>,
    );
    await view.ready;
    expect(view.screen.getByRole("heading", { name: "Project" })).toBeDefined();
    expect(view.screen.getByTestId("description")).toBeDefined();
    expect(view.screen.getByRole("progressbar").valueText).toBe("50%");
    expect(view.screen.getByRole("alert", { name: "Notice" })).toBeDefined();
    expect(view.screen.frame()).toContain("Create a project");
    await view.cleanup();
  });

  test("responsive stacks adapt to terminal viewport policy", async () => {
    const content = (
      <ResponsiveStack directions={{ wide: "column" }}>
        <Text>Alpha</Text>
        <Text>Beta</Text>
      </ResponsiveStack>
    );
    const compact = renderTuil(content, {
      terminal: { capabilities: { width: 40 } },
    });
    await compact.ready;
    expect(compact.screen.frame()).toContain("Alpha\nBeta");
    await compact.cleanup();

    const regular = renderTuil(content, {
      terminal: { capabilities: { width: 80 } },
    });
    await regular.ready;
    expect(regular.screen.frame()).toContain("AlphaBeta");
    regular.resize(40);
    await Bun.sleep(25);
    expect(regular.screen.frame()).toContain("Alpha\nBeta");
    regular.resize(80);
    await Bun.sleep(25);
    expect(regular.screen.frame()).toContain("AlphaBeta");
    await regular.cleanup();

    const wide = renderTuil(content, {
      terminal: { capabilities: { width: 140 } },
    });
    await wide.ready;
    expect(wide.screen.frame()).toContain("Alpha\nBeta");
  });

  test("layout, divider, and command button variants render and act", async () => {
    const layoutApp = createApp({
      component: () => (
        <VStack>
          <HStack>
            <Container maxWidth={20}>
              <Divider title="Layout" width={12} />
              <Divider orientation="vertical" />
            </Container>
          </HStack>
        </VStack>
      ),
      terminal: {
        mode: "static",
      },
    });
    expect(await renderStatic(layoutApp)).toContain("Layout");

    const view = renderTuil(
      <VStack>
        <Button id="command-button" command="run" suffix="!">
          Run
        </Button>
      </VStack>,
    );
    await view.ready;
    let commands = 0;
    view.app.commands.register({
      id: "run",
      title: "Run",
      execute() {
        commands += 1;
      },
    });
    expect(view.app.focus.focus("command-button")).toBeTrue();
    await view.user.press("enter");
    expect(commands).toBe(1);
  });

  test("routes keyboard input through focus and commands without collisions", async () => {
    const calls: string[] = [];
    const view = renderTuil(
      <Stack>
        <Button
          id="first"
          autoFocus
          onPress={() => {
            calls.push("first");
          }}
        >
          First
        </Button>
        <Button
          id="second"
          onPress={() => {
            calls.push("second");
          }}
        >
          Second
        </Button>
      </Stack>,
    );
    await view.ready;
    await view.user.press("enter");
    await view.user.press("tab");
    expect(view.app.focus.focusedId).toBe("second");
    await view.user.press("enter");
    expect(calls).toEqual(["first", "second"]);
    expect(view.screen.getAllByRole("button")).toHaveLength(2);
    await view.cleanup();
  });

  test("inherits focus scopes and uses render registration order", async () => {
    const view = renderTuil(
      <FocusScope id="actions" loop>
        <Stack>
          <Button id="z-first">First</Button>
          <Button id="a-second">Second</Button>
        </Stack>
      </FocusScope>,
    );
    await view.ready;
    expect(view.app.focus.focusedId).toBe("z-first");
    await view.user.press("tab");
    expect(view.app.focus.focusedId).toBe("a-second");
    await view.cleanup();
  });

  test("lets one active terminal input consumer preempt global hotkeys", async () => {
    const calls: string[] = [];
    function InputConsumer() {
      useTerminalInput((input) => {
        if (input !== "x") return false;
        calls.push("input");
        return true;
      });
      return (
        <Button
          id="global"
          autoFocus
          hotkeys={["x"]}
          onPress={() => {
            calls.push("hotkey");
          }}
        >
          Global
        </Button>
      );
    }
    const view = renderTuil(<InputConsumer />);
    await view.ready;
    await view.user.press("x");
    expect(calls).toEqual(["input"]);
    await view.cleanup();
  });

  test("routes and unregisters terminal input consumers by layer priority", async () => {
    const router = new TerminalInputRouter();
    const calls: string[] = [];
    const key = {} as Key;
    router.register(() => {
      calls.push("low");
      return true;
    }, 1);
    const unregister = router.register(
      () => {
        calls.push("high");
        return true;
      },
      2,
      "dialog",
    );
    expect(await router.dispatch("x", key, "dialog")).toBeTrue();
    expect(calls).toEqual(["high"]);
    unregister();
    expect(await router.dispatch("x", key, "dialog")).toBeFalse();
  });

  test("inherits nested React scope parents and restores the outer trap", async () => {
    let closeInner: (() => void) | undefined;
    function NestedScopes() {
      const [open, setOpen] = useState(true);
      closeInner = () => setOpen(false);
      return (
        <>
          <FocusScope id="outer" trapped loop restoreFocus>
            <Button id="outer-action">Outer</Button>
            {open ? (
              <FocusTrap id="inner" active>
                <Button id="inner-action">Inner</Button>
              </FocusTrap>
            ) : null}
          </FocusScope>
          <Button id="unrelated">Unrelated</Button>
        </>
      );
    }
    const view = renderTuil(<NestedScopes />);
    await view.ready;
    expect(view.app.focus.focusedId).toBe("inner-action");
    closeInner?.();
    await Bun.sleep(10);
    expect(view.app.focus.focusedId).toBe("outer-action");
    expect(view.app.focus.focus("unrelated")).toBeFalse();
    await view.cleanup();
  });

  test("serializes terminal input and reports handler failures through the app", async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    function SerializedInput() {
      useTerminalInput(async (input) => {
        if (input === "x") {
          throw new Error("input failed");
        }
        calls.push(`start:${input}`);
        await Bun.sleep(10);
        calls.push(`end:${input}`);
        return true;
      });
      return <Text>Input</Text>;
    }
    const view = renderTuil(<SerializedInput />, {
      errorHandler(error) {
        errors.push(error);
      },
    });
    await view.ready;
    await view.user.press("a");
    await view.user.press("b");
    await Bun.sleep(30);
    expect(calls).toEqual(["start:a", "end:a", "start:b", "end:b"]);
    await view.user.press("x");
    await Bun.sleep(10);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    await view.cleanup();
  });

  test("uses ASCII interaction and progress glyphs without Unicode capability", async () => {
    const view = renderTuil(
      <Stack>
        <Button id="ascii-button" autoFocus>
          Continue
        </Button>
        <Progress value={50} width={4} />
      </Stack>,
      {
        terminal: {
          capabilities: { unicode: false },
        },
      },
    );
    await view.ready;
    expect(view.screen.frame()).toContain(">[ Continue ]");
    expect(view.screen.frame()).toContain("[##--]");
    expect(view.screen.frame()).not.toContain("▶");
    expect(view.screen.frame()).not.toContain("█");
    await view.cleanup();
  });

  test("animates spinners and escapes every terminal control form", async () => {
    const view = renderTuil(<Spinner label="Working" />, {
      theme: createTheme({
        id: "fast-motion",
        motion: { enabled: true, interval: 1 },
      }),
      terminal: { capabilities: { colorDepth: 24, reducedMotion: false } },
    });
    await view.ready;
    expect(view.app.mode).toBe("interactive");
    expect(view.app.theme.motion.enabled).toBeTrue();
    expect(view.screen.getByRole("status", { name: "Working" })).toBeDefined();
    await Bun.sleep(100);
    expect(view.screen.frame()).toContain("Working");
    expect(escapeTerminalControlCharacters("\r\n\t\u001btext")).toBe(
      "\\r\\n\\t\\u001btext",
    );
    await view.cleanup();
  });

  test("reports deferred hotkey failures through the application boundary", async () => {
    const errors: unknown[] = [];
    function DeferredFailure() {
      const app = useApp();
      useEffect(() => {
        const disposers = [
          app.hotkeys.register({
            keys: "x",
            async handler() {
              throw new Error("deferred hotkey failed");
            },
          }),
          app.hotkeys.register({ keys: "x x", handler() {} }),
        ];
        return () => {
          for (const dispose of disposers) dispose();
        };
      }, [app]);
      return <Text>Deferred hotkey</Text>;
    }
    const view = renderTuil(<DeferredFailure />, {
      errorHandler(error) {
        errors.push(error);
      },
    });
    await view.ready;
    await view.user.press("x");
    await Bun.sleep(view.app.hotkeys.sequenceTimeout + 25);
    expect(errors).toHaveLength(1);
    await view.cleanup();
  });

  test("tracks semantic observers and nested overlay status", async () => {
    const registry = new SemanticRegistry();
    let changes = 0;
    const stopObserving = registry.observe(() => {
      changes += 1;
    });
    const unregister = registry.register({
      key: "status",
      role: "status",
      text: "Starting",
    });
    registry.update({ key: "status", role: "status", text: "Ready" });
    unregister();
    stopObserving();
    registry.update({ key: "ignored", role: "status" });
    expect(changes).toBe(3);

    const statuses: string[] = [];
    function StatusProbe() {
      const status = useOverlayStatus();
      statuses.push(`${status.count}:${status.getTopId() ?? "none"}`);
      return null;
    }
    const view = renderTuil(
      <>
        <StatusProbe />
        <DismissableLayer id="outer" open>
          <DismissableLayer id="inner" open>
            <Text>Nested</Text>
          </DismissableLayer>
        </DismissableLayer>
      </>,
    );
    await view.ready;
    await Bun.sleep(10);
    expect(statuses).toContain("2:inner");
    await view.cleanup();
  });

  test("registers declarative and grouped hotkeys through the shared manager", async () => {
    const calls: string[] = [];
    function Hotkeys() {
      useHotkeys({
        x: () => {
          calls.push("grouped");
        },
      });
      return (
        <Hotkey
          keys="y"
          onTrigger={() => {
            calls.push("declarative");
          }}
        />
      );
    }
    const view = renderTuil(<Hotkeys />);
    await view.ready;
    await view.user.press("x");
    await view.user.press("y");
    expect(calls).toEqual(["grouped", "declarative"]);
    await view.cleanup();
  });

  test("creates default provider services", () => {
    expect(
      renderToString(
        <HotkeyProvider>
          <InkText>Default manager</InkText>
        </HotkeyProvider>,
      ),
    ).toContain("Default manager");
    expect(
      renderToString(
        <FocusProvider>
          <InkText>Default focus</InkText>
        </FocusProvider>,
      ),
    ).toContain("Default focus");
    expect(
      renderToString(
        <SemanticProvider>
          <InkText>Default semantics</InkText>
        </SemanticProvider>,
      ),
    ).toContain("Default semantics");
  });

  test("uses the empty snapshot when an optional external store is absent", async () => {
    function EmptyStoreProbe() {
      const snapshot = useOptionalExternalStore(undefined, "empty");
      return <Text>{snapshot}</Text>;
    }

    const view = renderTuil(<EmptyStoreProbe />);
    await view.ready;
    expect(view.screen.frame()).toContain("empty");
    await view.cleanup();
  });
});
