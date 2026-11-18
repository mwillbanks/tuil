import { afterEach, expect, test } from "bun:test";
import {
  cleanup,
  clickPointerTarget,
  renderTuil,
} from "@mwillbanks/tuil-testing-ink";
import { ScrollArea } from "../../../registry/layout/panes";

afterEach(cleanup);
const lines = Array.from({ length: 10 }, (_, index) => "Row " + index);

test("focused scroll areas handle line and page keys and clamp boundaries", async () => {
  const offsets: number[] = [];
  const view = renderTuil(
    <ScrollArea
      id="scroll"
      lines={lines}
      height={3}
      onOffsetChange={(value) => {
        offsets.push(value);
      }}
    />,
  );
  await view.ready;
  await clickPointerTarget(view, "scroll");
  for (const key of [
    "arrowDown",
    "pageDown",
    "arrowUp",
    "pageUp",
    "arrowUp",
    "x",
    "arrowLeft",
    "arrowRight",
  ])
    await view.user.press(key);
  expect(offsets).toEqual([1, 4, 3, 0, 0]);
  expect(view.screen.frame()).toContain("Row 0");
  expect(view.screen.frame()).not.toContain("Row 3");
  for (const key of ["pageDown", "pageDown", "pageDown", "arrowDown"])
    await view.user.press(key);
  expect(offsets.slice(-4)).toEqual([3, 6, 7, 7]);
  expect(view.screen.frame()).toContain("Row 9");
});

test("updated offsets and fractional viewport dimensions project a bounded visible slice", async () => {
  const view = renderTuil(
    <ScrollArea
      id="controlled"
      lines={lines}
      height={2.9}
      offset={4}
      sticky="top"
    />,
  );
  await view.ready;
  await view.user.press("x");
  expect(view.screen.frame()).toContain("Row 4");
  expect(view.screen.frame()).toContain("Row 5");
  expect(view.screen.frame()).not.toContain("Row 6");
  view.rerender(
    <ScrollArea
      id="controlled"
      lines={lines}
      height={0}
      offset={99}
      sticky="bottom"
    />,
  );
  await view.user.press("x");
  expect(view.screen.frame()).toContain("Row 9");
  expect(view.screen.frame()).not.toContain("Row 8");
});
