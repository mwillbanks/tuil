import { expect, test } from "bun:test";
import { LayoutProjection } from "@mwillbanks/tuil-renderer";
import {
  PointerRouter,
  parseSgrPointer,
  pointerTracking,
  SgrPointerDecoder,
  semanticPointerFixture,
} from "./index.ts";

function layout(): LayoutProjection {
  const projection = new LayoutProjection();
  projection.upsert({
    id: "root",
    bounds: { x: 0, y: 0, width: 20, height: 10 },
    clip: { x: 0, y: 0, width: 20, height: 10 },
    zIndex: 0,
    focusable: false,
    pointerEvents: "auto",
    semantics: { role: "application" },
  });
  projection.upsert({
    id: "button",
    parentId: "root",
    bounds: { x: 2, y: 2, width: 5, height: 2 },
    clip: { x: 0, y: 0, width: 20, height: 10 },
    zIndex: 1,
    focusable: true,
    pointerEvents: "auto",
    semantics: { role: "button", label: "Save" },
  });
  return projection;
}

test("SGR parser handles buttons, modifiers, motion, and wheel axes", () => {
  expect(parseSgrPointer("\u001b[<20;3;4M")).toMatchObject({
    x: 2,
    y: 3,
    button: "primary",
    pressed: true,
    modifiers: { ctrl: true },
  });
  expect(parseSgrPointer("\u001b[<65;2;2M")).toMatchObject({
    button: "wheel",
    wheelY: 1,
  });
  expect(parseSgrPointer("not-mouse")).toBeUndefined();
  expect(parseSgrPointer("\u001b[<0;2;3Mtail")).toBeUndefined();
});

test("streaming pointer decoding preserves batched non-pointer bytes and partial suffixes", () => {
  const decoder = new SgrPointerDecoder();
  expect(decoder.push("before\u001b[<0;2")).toEqual({
    events: [],
    passthrough: "before",
  });
  const decoded = decoder.push(";3Mmiddle\u001b[<65;4;5Mafter");
  expect(decoded.events).toHaveLength(2);
  expect(decoded.events[0]).toEqual(
    expect.objectContaining({ x: 1, y: 2, button: "primary" }),
  );
  expect(decoded.events[1]).toEqual(
    expect.objectContaining({ x: 3, y: 4, button: "wheel", wheelY: 1 }),
  );
  expect(decoded.passthrough).toBe("middleafter");
  expect(decoder.flush()).toBe("");

  decoder.push("\u001b[<0;1");
  expect(decoder.flush()).toBe("\u001b[<0;1");
  expect(decoder.push("\u001b[A").passthrough).toBe("\u001b[A");
});

test("pointer router dispatches capture/bubble, focus, clicks, hover, and drag", () => {
  const projection = layout();
  const order: string[] = [];
  let focused = "";
  const router = new PointerRouter(projection, {
    focus: (id) => {
      focused = id;
      return true;
    },
    now: () => 100,
  });
  router.on("root", "down", () => order.push("root-capture"), {
    capture: true,
  });
  router.on("button", "down", () => order.push("button"));
  router.on("root", "down", () => order.push("root"));
  router.on("button", "dragstart", () => order.push("dragstart"));
  router.dispatch({
    x: 2,
    y: 2,
    button: "primary",
    pressed: true,
    motion: false,
    wheelX: 0,
    wheelY: 0,
    modifiers: { shift: false, alt: false, ctrl: false },
  });
  router.capture("button");
  router.dispatch({
    x: 9,
    y: 2,
    button: "primary",
    pressed: true,
    motion: true,
    wheelX: 0,
    wheelY: 0,
    modifiers: { shift: false, alt: false, ctrl: false },
  });
  expect(focused).toBe("button");
  expect(order).toEqual(["root-capture", "button", "root", "dragstart"]);
});

test("pointer helpers expose terminal protocol and semantic fixtures", () => {
  expect(pointerTracking(true)).toContain("?1006h");
  expect(pointerTracking(false)).toContain("?1000l");
  expect(semanticPointerFixture("click", "save").targetId).toBe("save");
});

test("pointer event lifecycle covers hover, wheel, clicks, cancellation, and release", () => {
  const projection = layout();
  let now = 0;
  const router = new PointerRouter(projection, { now: () => now });
  const events: string[] = [];
  const off = router.on("button", "click", (event) => {
    events.push(`${event.type}:${event.clickCount}`);
    expect(event.currentTargetId).toBe("button");
    expect(event.defaultPrevented).toBeFalse();
    event.preventDefault();
    event.stopPropagation();
    expect(event.defaultPrevented).toBeTrue();
    expect(event.propagationStopped).toBeTrue();
  });
  const base = {
    x: 2,
    y: 2,
    button: "primary" as const,
    motion: false,
    wheelX: 0,
    wheelY: 0,
    modifiers: { shift: false, alt: false, ctrl: false },
  };
  router.dispatch({ ...base, pressed: true });
  router.dispatch({ ...base, pressed: false });
  now += 10;
  router.dispatch({ ...base, pressed: true });
  router.dispatch({ ...base, pressed: false });
  expect(events).toEqual(["click:1", "click:2"]);
  off();
  router.dispatch({ ...base, pressed: true });
  router.dispatch({ ...base, pressed: false });
  expect(events).toHaveLength(2);

  expect(
    router
      .dispatch({ ...base, pressed: false, motion: true })
      .map((event) => event.type),
  ).toContain("enter");
  expect(
    router
      .dispatch({
        ...base,
        x: 19,
        pressed: false,
        motion: true,
      })
      .map((event) => event.type),
  ).toContain("leave");
  expect(
    router.dispatch({
      ...base,
      button: "wheel",
      pressed: false,
      wheelY: 1,
    })[0]?.type,
  ).toBe("wheel");
  router.capture("button");
  router.releaseCapture("button");
  router.releaseCapture();
  expect(() => router.capture("missing")).toThrow("unknown");

  expect(parseSgrPointer("\u001b[<192;2;2M")?.wheelX).toBe(-1);
  expect(parseSgrPointer("\u001b[<2;2;2m")?.button).toBe("secondary");
  expect(parseSgrPointer("\u001b[<0;0;0M")).toBeUndefined();
});
