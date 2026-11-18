import { afterEach, expect, test } from "bun:test";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { ScrollArea } from "../../registry/layout/panes";

afterEach(cleanup);
const lines = Array.from({ length: 10 }, (_, index) => "Row " + index);

test("wheel input focuses its target and horizontal movement preserves vertical offset", async () => {
  const offsets: number[] = [];
  const view = renderTuil(
    <ScrollArea
      id="wheel"
      lines={lines}
      height={3}
      onOffsetChange={(value) => {
        offsets.push(value);
      }}
    />,
    { terminal: { capabilities: { width: 50, height: 10, mouse: true } } },
  );
  await view.ready;
  const bounds = view.app.layout.get("wheel")?.bounds;
  expect(bounds).toBeDefined();
  const column = bounds!.x + 1;
  const row = bounds!.y + 1;
  await view.user.press(`\u001b[<65;${column};${row}M`);
  expect(offsets).toEqual([1]);
  await view.user.press("arrowDown");
  expect(offsets).toEqual([1, 2]);
  await view.user.press(`\u001b[<66;${column};${row}M`);
  expect(offsets).toEqual([1, 2]);
  await view.user.press(`\u001b[<64;${column};${row}M`);
  expect(offsets.at(-1)).toBe(1);
  expect(view.screen.frame()).toContain("Row 1");
  expect(view.screen.frame()).not.toContain("Row 0");
});
