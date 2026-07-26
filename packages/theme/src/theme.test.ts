import { expect, test } from "bun:test";
import {
  compileUtilities,
  createDefaultThemeRegistry,
  createTheme,
  defaultLightTheme,
  defaultTheme,
  normalizeTheme,
  resolveComponentProps,
  resolveSlotProps,
  ThemeRegistry,
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

test("ships resolvable dark and light defaults", () => {
  const registry = createDefaultThemeRegistry();
  expect(registry.resolve().id).toBe("default-dark");
  expect(registry.resolve("default-light")).toBe(defaultLightTheme);
  expect(defaultLightTheme.colorScheme).toBe("light");
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

test("theme registry resolves defaults, filters, and disposes registrations", () => {
  const registry = new ThemeRegistry();
  const dark = registry.register({
    theme: defaultTheme,
    tags: ["dark", "official"],
  });
  const light = createTheme({
    id: "default-light",
    colorScheme: "light",
  });
  registry.register(
    { theme: light, tags: ["light", "official"] },
    { default: true },
  );
  expect(registry.resolve()).toBe(light);
  expect(registry.list({ tag: "dark" })[0]?.theme).toBe(defaultTheme);
  dark.dispose();
  expect(registry.get(defaultTheme.id)).toBeUndefined();
  expect(() => registry.register({ theme: light })).toThrow(
    "already registered",
  );
});
