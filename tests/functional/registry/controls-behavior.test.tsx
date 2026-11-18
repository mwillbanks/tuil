import { afterEach, expect, test } from "bun:test";
import { TextBufferSession } from "@mwillbanks/tuil-editor/buffer";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import {
  Autocomplete,
  MultiSelect,
  RadioGroup,
  Select,
  Slider,
  TextArea,
} from "../../../registry/forms/controls";

afterEach(cleanup);
const options = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
  { value: "blocked", label: "Blocked", disabled: true },
] as const;

test("provided text editors preserve cross-line cursor movement and remove separators", async () => {
  const session = new TextBufferSession({ value: "a\nb" });
  const view = renderTuil(
    <TextArea
      id="area"
      label="Area"
      autoFocus
      defaultValue={"a\nb"}
      session={session}
    />,
  );
  try {
    await view.ready;
    session.execute("cursor-end");
    await view.user.press("arrowLeft");
    expect(session.snapshot().selections[0]?.head).toEqual({
      line: 1,
      column: 0,
    });
    await view.user.press("arrowLeft");
    expect(session.snapshot().selections[0]?.head).toEqual({
      line: 0,
      column: 1,
    });
    await view.user.press("arrowRight");
    expect(session.snapshot().selections[0]?.head).toEqual({
      line: 1,
      column: 0,
    });
    await view.user.press("backspace");
    expect(session.serialize()).toBe("ab");
    expect(view.screen.getByRole("textbox", { name: "Area" }).valueText).toBe(
      "ab",
    );
  } finally {
    await view.cleanup();
    session.dispose();
  }
});

test("selection controls tolerate empty and disabled options without emitting invalid values", async () => {
  const selected: string[] = [];
  for (const entries of [
    [],
    [{ value: "blocked", label: "Blocked", disabled: true }],
  ] as const) {
    const view = renderTuil(
      <RadioGroup
        id="radio"
        label="Choice"
        autoFocus
        options={entries}
        onValueChange={(value) => {
          selected.push(value);
        }}
      />,
    );
    await view.ready;
    await view.user.press("arrowDown");
    await view.user.press("arrowUp");
    await view.user.press("enter");
    expect(selected).toEqual([]);
    await view.cleanup();
  }
  const changes: string[][] = [];
  const list = renderTuil(
    <MultiSelect
      id="multi"
      label="Multiple"
      autoFocus
      options={options}
      maxSelected={1}
      onValueChange={(value) => {
        changes.push([...value]);
      }}
    />,
  );
  await list.ready;
  await list.user.press("space");
  await list.user.press("arrowDown");
  await list.user.press("space");
  expect(changes).toEqual([["alpha"]]);
  await list.user.press("arrowDown");
  await list.user.press("enter");
  expect(changes).toEqual([["alpha"]]);
  await list.user.press("arrowUp");
  await list.user.press("arrowUp");
  await list.user.press("space");
  expect(changes).toEqual([["alpha"], []]);
});

test("searchable selections recover from no matches and reset filtering when closed", async () => {
  const changes: string[] = [];
  const open: boolean[] = [];
  const view = renderTuil(
    <Select
      id="select"
      label="Select"
      autoFocus
      searchable
      options={options}
      onValueChange={(value) => {
        changes.push(value);
      }}
      onOpenChange={(value) => {
        open.push(value);
      }}
    />,
  );
  await view.ready;
  await view.user.press("enter");
  await view.user.type("z");
  await view.user.press("arrowUp");
  await view.user.press("enter");
  expect(changes).toEqual([]);
  await view.user.press("backspace");
  await view.user.press("arrowDown");
  await view.user.press("enter");
  expect(changes).toEqual(["beta"]);
  expect(open).toEqual([true, false]);
  await view.user.press("enter");
  await view.user.press("escape");
  expect(open).toEqual([true, false, true, false]);
});

test("slider keyboard boundaries clamp values and preserve read-only state", async () => {
  const changes: number[] = [];
  const view = renderTuil(
    <Slider
      id="slider"
      label="Slider"
      autoFocus
      min={10}
      max={20}
      step={5}
      defaultValue={15}
      width={1}
      onValueChange={(value) => {
        changes.push(value);
      }}
    />,
  );
  await view.ready;
  for (const key of [
    "home",
    "arrowDown",
    "end",
    "arrowRight",
    "arrowLeft",
    "arrowUp",
    "x",
  ])
    await view.user.press(key);
  expect(changes).toEqual([10, 10, 20, 20, 15, 20]);
  expect(view.screen.getByRole("slider").valueText).toBe("20");
  await view.cleanup();
  const readonly = renderTuil(
    <Slider
      id="readonly"
      label="Read only"
      autoFocus
      readOnly
      min={5}
      max={5}
      defaultValue={5}
      width={1}
      onValueChange={(value) => {
        changes.push(value);
      }}
    />,
  );
  await readonly.ready;
  await readonly.user.press("home");
  await readonly.user.press("end");
  expect(changes).toHaveLength(6);
  expect(readonly.screen.getByRole("slider").valueText).toBe("5");
});

test("autocomplete navigation ignores disabled results and selects a valid label", async () => {
  const selected: string[] = [];
  const values: string[] = [];
  const view = renderTuil(
    <Autocomplete
      id="autocomplete"
      label="Search"
      autoFocus
      defaultValue="l"
      options={options}
      onValueChange={(value) => {
        values.push(value);
      }}
      onOptionSelect={(option) => {
        selected.push(option.value);
      }}
    />,
  );
  await view.ready;
  await view.user.press("arrowDown");
  await view.user.press("enter");
  expect(selected).toEqual([]);
  await view.user.press("arrowUp");
  await view.user.press("enter");
  expect(selected).toEqual(["alpha"]);
  expect(values.at(-1)).toBe("Alpha");
});
