import { expect, test } from "bun:test";
import { ScrollAreaState, ScrollManager, scrollbar } from "./index.ts";

test("scroll state clamps movement, handles sticky insertion, and restores position", () => {
  const area = new ScrollAreaState({
    id: "logs",
    viewport: { width: 20, height: 10 },
    extent: { width: 50, height: 100 },
    sticky: { bottom: true },
  });
  area.move("bottom");
  area.setExtent({ width: 50, height: 120 });
  expect(area.snapshot().position.y).toBe(110);
  area.scrollTo({ x: 999, y: -1 });
  expect(area.snapshot().position).toEqual({ x: 30, y: 0 });
  area.setExtent({ width: 50, height: 130 }, { insertedBefore: 5 });
  expect(area.snapshot().position.y).toBe(5);
});

test("variable measurements, focus following, nested wheel routing, and static projections work", () => {
  const manager = new ScrollManager();
  const parent = new ScrollAreaState({
    id: "parent",
    viewport: { width: 10, height: 3 },
    extent: { width: 10, height: 10 },
  });
  const child = new ScrollAreaState({
    id: "child",
    parentId: "parent",
    viewport: { width: 10, height: 2 },
    extent: { width: 10, height: 2 },
  });
  manager.register(parent);
  manager.register(child);
  manager.routeWheel("child", 0, 2);
  expect(parent.snapshot().position.y).toBe(2);
  expect(parent.visibleRange("vertical", [1, 2, 3, 4], 1)).toEqual({
    start: 0,
    end: 3,
    before: 0,
    after: 0,
  });
  expect(parent.staticProjection(["0", "1", "2", "3"], "viewport")).toEqual([
    "2",
    "3",
  ]);
  expect(
    parent.scrollIntoView({ x: 0, y: 7, width: 1, height: 1 }, "center")
      .position.y,
  ).toBe(6);
  expect(
    parent.scrollIntoView({ x: 0, y: 0, width: 1, height: 1 }, "start").position
      .y,
  ).toBe(0);
  expect(
    parent.scrollIntoView({ x: 0, y: 9, width: 1, height: 1 }, "end").position
      .y,
  ).toBe(7);
  expect(parent.visibleRange("vertical", [1, 1, 1, 1, 1, 1, 1, 1])).toEqual({
    start: 7,
    end: 7,
    before: 7,
    after: 0,
  });
});

test("scrollbar produces bounded terminal thumb geometry", () => {
  expect(scrollbar(10, 100, 45)).toEqual({ start: 4, size: 1 });
  expect(scrollbar(10, 5, 0)).toEqual({ start: 0, size: 10 });
});

test("scroll lifecycle covers resize, movement, observers, focus, and restoration", () => {
  const area = new ScrollAreaState({
    id: "area",
    viewport: { width: 4, height: 4 },
    extent: { width: 12, height: 12 },
    sticky: { bottom: true, right: true },
  });
  let notifications = 0;
  const unsubscribe = area.subscribe(() => {
    notifications += 1;
  });
  for (const direction of [
    "lineDown",
    "lineRight",
    "pageDown",
    "pageRight",
    "lineUp",
    "lineLeft",
    "pageUp",
    "pageLeft",
    "bottom",
    "right",
    "top",
    "left",
  ] as const) {
    area.move(direction);
  }
  area.move("bottom");
  area.move("right");
  area.resize({ width: 5, height: 5 }, { width: 15, height: 15 });
  expect(area.snapshot().position).toEqual({ x: 10, y: 10 });
  unsubscribe();
  expect(notifications).toBeGreaterThan(0);

  const manager = new ScrollManager();
  const dispose = manager.register(area);
  expect(manager.get("area")).toBe(area);
  expect(
    manager.focus("area", { x: 0, y: 0, width: 1, height: 1 }),
  ).toBeDefined();
  expect(manager.snapshots()).toHaveLength(1);
  expect(() => manager.register(area)).toThrow("already registered");
  expect(() =>
    manager.register(
      new ScrollAreaState({
        id: "orphan",
        parentId: "missing",
        viewport: { width: 1, height: 1 },
        extent: { width: 1, height: 1 },
      }),
    ),
  ).toThrow("not registered");
  dispose();
  manager.register(area);
  expect(area.snapshot().position).toEqual({ x: 0, y: 0 });
  expect(
    () =>
      new ScrollAreaState({
        id: "",
        viewport: { width: 1, height: 1 },
        extent: { width: 1, height: 1 },
      }),
  ).toThrow("cannot be empty");
});
