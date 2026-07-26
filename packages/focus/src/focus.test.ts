import { describe, expect, test } from "bun:test";
import { FocusManager } from "./index.ts";

describe("focus manager", () => {
  test("supports ordered, looping, and directional movement", () => {
    const focus = new FocusManager();
    focus.registerScope({ id: "main", loop: true, orientation: "grid" });
    focus.registerNode({
      id: "a",
      scopeId: "main",
      disabled: false,
      hidden: false,
      order: 0,
      bounds: { x: 0, y: 0, width: 5, height: 1 },
    });
    focus.registerNode({
      id: "b",
      scopeId: "main",
      disabled: false,
      hidden: false,
      order: 1,
      bounds: { x: 10, y: 0, width: 5, height: 1 },
    });
    focus.registerNode({
      id: "c",
      scopeId: "main",
      disabled: false,
      hidden: false,
      order: 2,
      bounds: { x: 0, y: 3, width: 5, height: 1 },
    });
    focus.activateScope("main");
    expect(focus.focusedId).toBe("a");
    expect(focus.move("right")).toBeTrue();
    expect(focus.focusedId).toBe("b");
    expect(focus.last()).toBeTrue();
    expect(focus.next()).toBeTrue();
    expect(focus.focusedId).toBe("a");
    expect(focus.move("down")).toBeTrue();
    expect(focus.focusedId).toBe("c");
  });

  test("traps focus and restores the previous node", () => {
    const focus = new FocusManager();
    focus.registerScope({ id: "main", restoreFocus: true });
    focus.registerScope({
      id: "dialog",
      parentId: "main",
      trapped: true,
      loop: true,
      restoreFocus: true,
    });
    focus.registerNode({
      id: "outside",
      scopeId: "main",
      disabled: false,
      hidden: false,
      order: 0,
    });
    focus.registerNode({
      id: "inside",
      scopeId: "dialog",
      disabled: false,
      hidden: false,
      order: 0,
    });
    focus.activateScope("main");
    focus.activateScope("dialog");
    expect(focus.focusedId).toBe("inside");
    expect(focus.focus("outside")).toBeFalse();
    focus.deactivateScope("dialog");
    expect(focus.focusedId).toBe("outside");
  });

  test("restores an outer trap after a nested trap closes", () => {
    const focus = new FocusManager();
    focus.registerScope({ id: "outer", trapped: true, restoreFocus: true });
    focus.registerScope({
      id: "inner",
      parentId: "outer",
      trapped: true,
      restoreFocus: true,
    });
    focus.registerNode({
      id: "outer-button",
      scopeId: "outer",
      disabled: false,
      hidden: false,
      order: 0,
    });
    focus.registerNode({
      id: "inner-button",
      scopeId: "inner",
      disabled: false,
      hidden: false,
      order: 0,
    });
    focus.registerNode({
      id: "unrelated",
      disabled: false,
      hidden: false,
      order: 0,
    });
    focus.activateScope("outer");
    focus.activateScope("inner");
    expect(focus.focusedId).toBe("inner-button");
    focus.deactivateScope("inner");
    expect(focus.focusedId).toBe("outer-button");
    expect(focus.focus("unrelated")).toBeFalse();
  });
});
