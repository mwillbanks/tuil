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

  test("covers hierarchical, paged, updated, and disposable focus behavior", () => {
    const focus = new FocusManager();
    const changes: string[] = [];
    const stopObserving = focus.observe((change) =>
      changes.push(
        `${change.previousId ?? "none"}:${change.currentId ?? "none"}`,
      ),
    );
    expect(focus.next()).toBeFalse();
    expect(focus.previous()).toBeFalse();
    expect(focus.enter()).toBeFalse();
    expect(focus.exit()).toBeFalse();
    expect(focus.restore()).toBeFalse();
    expect(focus.activeScopeId).toBeUndefined();

    const unregisterScope = focus.registerScope({
      id: "hierarchy",
      loop: false,
      orientation: "vertical",
    });
    expect(() => focus.registerScope({ id: "hierarchy" })).toThrow(
      "already registered",
    );
    expect(() => focus.activateScope("missing")).toThrow("not registered");
    focus.activateScope("hierarchy");
    const unregisterParent = focus.registerNode({
      id: "parent",
      scopeId: "hierarchy",
      disabled: false,
      hidden: false,
    });
    const unregisterChild = focus.registerNode({
      id: "child",
      parentId: "parent",
      scopeId: "hierarchy",
      disabled: false,
      hidden: false,
    });
    focus.registerNode({
      id: "last",
      scopeId: "hierarchy",
      disabled: false,
      hidden: false,
    });
    expect(() =>
      focus.registerNode({
        id: "last",
        disabled: false,
        hidden: false,
      }),
    ).toThrow("already registered");
    expect(focus.nodes()).toHaveLength(3);
    expect(focus.first()).toBeTrue();
    expect(focus.enter()).toBeTrue();
    expect(focus.focusedId).toBe("child");
    expect(focus.exit()).toBeTrue();
    expect(focus.focusedId).toBe("parent");
    expect(focus.move("pageDown", 10)).toBeTrue();
    expect(focus.focusedId).toBe("last");
    expect(focus.move("pageUp", 10)).toBeTrue();
    expect(focus.focusedId).toBe("parent");
    expect(focus.move("down")).toBeTrue();
    expect(focus.move("up")).toBeTrue();
    expect(focus.move("home")).toBeTrue();
    expect(focus.move("end")).toBeTrue();
    expect(focus.move("previous")).toBeTrue();
    expect(focus.move("next")).toBeTrue();
    expect(focus.move("child")).toBeFalse();
    expect(focus.move("parent")).toBeFalse();
    expect(focus.next()).toBeFalse();

    focus.updateNode("last", { disabled: true });
    expect(focus.focusedId).not.toBe("last");
    expect(() => focus.updateNode("missing", { hidden: true })).toThrow(
      "not registered",
    );
    unregisterChild();
    unregisterParent();
    focus.deactivateScope("missing");
    unregisterScope();
    stopObserving();
    expect(changes.length).toBeGreaterThan(0);
  });
});
