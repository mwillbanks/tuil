import { expect, test } from "bun:test";
import {
  compileUtilities,
  createTheme,
  normalizeTheme,
  resolveComponentProps,
  resolveSlotProps,
} from "./index.ts";

test("themes merge tokens and degrade terminal capabilities", () => {
  const theme = createTheme({
    id: "custom",
    colors: { muted: "blue" },
    spacing: { md: 4 },
  });
  expect(theme.colors.muted).toBe("blue");
  expect(theme.colors.foreground).toBe("white");
  const normalized = normalizeTheme(theme, {
    width: 80,
    height: 24,
    colorDepth: 1,
    unicode: false,
    hyperlinks: false,
    interactive: false,
    tty: false,
    alternateScreen: false,
    mouse: false,
    images: false,
    reducedMotion: true,
    platform: "linux",
  });
  expect(normalized.colors.primary.foreground).toBe("white");
  expect(normalized.motion.enabled).toBeFalse();
  expect(normalized.borders.round[2]).toBe("+");
});

test("slot factories and utilities resolve from state and theme", () => {
  const theme = createTheme({ id: "slots" });
  expect(
    resolveSlotProps(
      ({ selected }: { selected: boolean }) => ({ bold: selected }),
      { selected: true },
      theme,
    ),
  ).toEqual({ bold: true });
  expect(
    compileUtilities("row p-md focus:bold text-muted", theme, { focus: true }),
  ).toMatchObject({
    flexDirection: "row",
    padding: 2,
    bold: true,
    color: "gray",
  });
});

test("utility caches are isolated by theme identity and themes are immutable", () => {
  const red = createTheme({ id: "shared", colors: { muted: "red" } });
  const blue = createTheme({ id: "shared", colors: { muted: "blue" } });
  expect(compileUtilities("text-muted", red)["color"]).toBe("red");
  expect(compileUtilities("text-muted", blue)["color"]).toBe("blue");
  expect(Object.isFrozen(blue.colors)).toBeTrue();
  expect(Object.isFrozen(blue.colors.primary)).toBeTrue();
});

test("component defaults, variants, sizes, utilities, and unstyled mode resolve", () => {
  const theme = createTheme({
    id: "components",
    components: {
      Button: {
        defaultProps: { flexDirection: "row", gap: 1 },
        variants: { danger: { borderStyle: "round" } },
        sizes: { lg: { padding: 2 } },
      },
    },
  });
  expect(
    resolveComponentProps(
      "Button",
      {
        variant: "danger",
        size: "lg",
        className: "grow",
      },
      {},
      theme,
    ),
  ).toEqual({
    flexDirection: "row",
    gap: 1,
    borderStyle: "round",
    padding: 2,
    flexGrow: 1,
  });
  expect(
    resolveComponentProps(
      "Button",
      {
        variant: "danger",
        size: "lg",
        unstyled: true,
        className: "grow",
      },
      {},
      theme,
    ),
  ).toEqual({ flexGrow: 1 });
});
