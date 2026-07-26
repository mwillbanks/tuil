import { afterEach, describe, expect, test } from "bun:test";
import { FocusScope, FocusTrap } from "@mwillbanks/tuil-focus";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { useState } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Heading,
  Progress,
  Stack,
  StatusBar,
  Text,
  useTerminalInput,
} from "./index.ts";

afterEach(cleanup);

describe("foundational Ink components", () => {
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
});
