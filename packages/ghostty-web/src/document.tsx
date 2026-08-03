import { createApp, type TuilRuntime } from "@mwillbanks/tuil";
import {
  Alert,
  AppBar,
  AppShell,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Heading,
  HStack,
  Progress,
  ResponsiveStack,
  Spinner,
  Stack,
  StatusBar,
  Text,
  VStack,
} from "@mwillbanks/tuil-ink";
import { createDefaultThemeRegistry } from "@mwillbanks/tuil-theme";
import {
  type ComponentType,
  createElement,
  type ReactNode,
  useSyncExternalStore,
} from "react";
import { browserTerminalProbe } from "./browser-terminal";

export interface PlaygroundNodeV1 {
  readonly id: string;
  readonly component: keyof typeof browserComponents;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children?: readonly PlaygroundNodeV1[];
  readonly slots?: Readonly<Record<string, readonly PlaygroundNodeV1[]>>;
}

export interface PlaygroundDocumentV1 {
  readonly version: 1;
  readonly root: PlaygroundNodeV1;
  readonly terminal: {
    readonly width: number;
    readonly height: number;
    readonly theme: string;
    readonly colorDepth?: 1 | 4 | 8 | 24;
    readonly unicode?: boolean;
    readonly reducedMotion?: boolean;
  };
}

const browserComponents = Object.freeze({
  Alert,
  AppBar,
  AppShell,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Heading,
  HStack,
  Progress,
  ResponsiveStack,
  Spinner,
  Stack,
  StatusBar,
  Text,
  VStack,
});
const allowedProps: Readonly<
  Record<keyof typeof browserComponents, ReadonlySet<string>>
> = {
  Alert: new Set(["label", "children", "title", "tone"]),
  AppBar: new Set(["borderStyle", "gap", "padding", "paddingX", "paddingY"]),
  AppShell: new Set(["borderStyle", "gap", "padding", "paddingX", "paddingY"]),
  Badge: new Set(["label", "children", "tone", "color"]),
  Box: new Set([
    "borderStyle",
    "flexDirection",
    "gap",
    "padding",
    "paddingX",
    "paddingY",
  ]),
  Button: new Set(["label", "children", "disabled", "variant", "autoFocus"]),
  Container: new Set([
    "borderStyle",
    "maxWidth",
    "padding",
    "paddingX",
    "paddingY",
  ]),
  Divider: new Set(["label", "orientation", "character", "color"]),
  Heading: new Set(["children", "level", "color"]),
  HStack: new Set(["borderStyle", "gap", "padding", "paddingX", "paddingY"]),
  Progress: new Set(["label", "value", "max"]),
  ResponsiveStack: new Set([
    "borderStyle",
    "gap",
    "padding",
    "paddingX",
    "paddingY",
    "directions",
  ]),
  Spinner: new Set(["label"]),
  Stack: new Set([
    "borderStyle",
    "direction",
    "gap",
    "padding",
    "paddingX",
    "paddingY",
  ]),
  StatusBar: new Set(["borderStyle", "gap", "padding", "paddingX", "paddingY"]),
  Text: new Set([
    "children",
    "color",
    "bold",
    "dimColor",
    "italic",
    "underline",
  ]),
  VStack: new Set(["borderStyle", "gap", "padding", "paddingX", "paddingY"]),
};
const mutableAllowedSlots = Object.fromEntries(
  Object.keys(browserComponents).map((name) => [name, new Set<string>()]),
) as unknown as Record<keyof typeof browserComponents, ReadonlySet<string>>;
mutableAllowedSlots.AppShell = new Set(["appBar", "main", "statusBar"]);
const allowedSlots: Readonly<
  Record<keyof typeof browserComponents, ReadonlySet<string>>
> = mutableAllowedSlots;

export const playgroundComponentCatalog = Object.freeze(
  Object.keys(browserComponents).map((component) => ({
    component: component as keyof typeof browserComponents,
    props: Object.freeze([
      ...allowedProps[component as keyof typeof browserComponents],
    ]),
    slots: Object.freeze([
      ...allowedSlots[component as keyof typeof browserComponents],
    ]),
  })),
);

function validateNodeId(node: PlaygroundNodeV1, ids: Set<string>): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(node.id) || ids.has(node.id)) {
    throw new TypeError(`Invalid or duplicate node id: ${node.id}`);
  }
  ids.add(node.id);
}

function validateNodeProps(node: PlaygroundNodeV1): void {
  for (const key of Object.keys(node.props)) {
    if (!allowedProps[node.component].has(key)) {
      throw new TypeError(`Unsupported ${node.component} prop: ${key}`);
    }
  }
  assertJsonValue(node.props, `${node.id}.props`, new Set());
}

function validateNodeSlots(
  node: PlaygroundNodeV1,
  visit: (child: PlaygroundNodeV1, depth: number) => void,
  depth: number,
): void {
  for (const [slot, children] of Object.entries(node.slots ?? {})) {
    if (!/^[a-z][a-zA-Z0-9]*$/u.test(slot)) {
      throw new TypeError(`Invalid slot: ${slot}`);
    }
    if (!allowedSlots[node.component].has(slot)) {
      throw new TypeError(`Unsupported ${node.component} slot: ${slot}`);
    }
    for (const child of children) visit(child, depth + 1);
  }
}

function validatePlaygroundNode(
  node: PlaygroundNodeV1,
  depth: number,
  ids: Set<string>,
  state: { count: number },
): void {
  state.count += 1;
  if (state.count > 200) {
    throw new RangeError(
      "A playground document can contain at most 200 nodes.",
    );
  }
  if (depth > 32) {
    throw new RangeError("A playground document can be at most 32 nodes deep.");
  }
  validateNodeId(node, ids);
  if (!(node.component in browserComponents)) {
    throw new TypeError(`Unknown browser component: ${node.component}`);
  }
  validateNodeProps(node);
  for (const child of node.children ?? []) {
    validatePlaygroundNode(child, depth + 1, ids, state);
  }
  validateNodeSlots(
    node,
    (child, childDepth) => {
      validatePlaygroundNode(child, childDepth, ids, state);
    },
    depth,
  );
}

function assertJsonValue(
  value: unknown,
  path: string,
  seen: Set<object>,
  depth = 0,
): void {
  if (depth > 32) throw new TypeError(`${path} exceeds the maximum depth.`);
  if (value === null || ["string", "boolean", "number"].includes(typeof value))
    return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      assertJsonValue(item, `${path}[${index}]`, seen, depth + 1);
    return;
  }
  if (typeof value !== "object")
    throw new TypeError(`${path} must be JSON-safe.`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
  seen.add(value);
  for (const [key, item] of Object.entries(value))
    assertJsonValue(item, `${path}.${key}`, seen, depth + 1);
  seen.delete(value);
}

export function validatePlaygroundDocument(
  document: PlaygroundDocumentV1,
): PlaygroundDocumentV1 {
  if (document.version !== 1)
    throw new TypeError("Unsupported playground document version.");
  if (
    !Number.isInteger(document.terminal.width) ||
    document.terminal.width < 20 ||
    document.terminal.width > 240
  )
    throw new RangeError("Terminal width must be between 20 and 240.");
  if (
    !Number.isInteger(document.terminal.height) ||
    document.terminal.height < 8 ||
    document.terminal.height > 100
  )
    throw new RangeError("Terminal height must be between 8 and 100.");
  const ids = new Set<string>();
  validatePlaygroundNode(document.root, 0, ids, { count: 0 });
  return document;
}

function renderNode(node: PlaygroundNodeV1): ReactNode {
  const Component = browserComponents[node.component] as ComponentType<
    Record<string, unknown>
  >;
  const children = (node.children ?? []).map(renderNode);
  const slots = Object.fromEntries(
    Object.entries(node.slots ?? {}).map(([name, nodes]) => [
      name,
      nodes.map(renderNode),
    ]),
  );
  if (node.component === "AppShell") {
    const shell = AppShell as typeof AppShell & {
      readonly AppBar: ComponentType<Record<string, unknown>>;
      readonly Main: ComponentType<Record<string, unknown>>;
      readonly StatusBar: ComponentType<Record<string, unknown>>;
    };
    const regions = [
      ...(slots["appBar"]
        ? [createElement(shell.AppBar, { key: "appBar" }, slots["appBar"])]
        : []),
      ...(slots["main"]
        ? [createElement(shell.Main, { key: "main" }, slots["main"])]
        : []),
      ...children,
      ...(slots["statusBar"]
        ? [
            createElement(
              shell.StatusBar,
              { key: "statusBar" },
              slots["statusBar"],
            ),
          ]
        : []),
    ];
    return createElement(
      shell,
      { ...node.props, id: node.id, key: node.id },
      regions,
    );
  }
  const content = (node.props["children"] ??
    (typeof node.props["label"] === "string" && children.length === 0
      ? node.props["label"]
      : children)) as ReactNode;
  return createElement(
    Component,
    { ...node.props, ...slots, id: node.id, key: node.id },
    content,
  );
}

export function createTuilGhosttyDocumentApp(
  document: PlaygroundDocumentV1,
): TuilRuntime {
  validatePlaygroundDocument(document);
  return createApp({
    id: "tuil-ghostty-document",
    component: () => renderNode(document.root),
    theme: createDefaultThemeRegistry().resolve(document.terminal.theme),
    terminal: {
      ...browserTerminalProbe(
        document.terminal.width,
        document.terminal.height,
      ),
      mode: "interactive",
      capabilities: {
        width: document.terminal.width,
        height: document.terminal.height,
        colorDepth: document.terminal.colorDepth ?? 24,
        unicode: document.terminal.unicode ?? true,
        hyperlinks: true,
        interactive: true,
        tty: true,
        alternateScreen: true,
        mouse: true,
        reducedMotion: document.terminal.reducedMotion ?? false,
        platform: "linux",
      },
    },
  });
}

export interface TuilGhosttyDocumentSession {
  readonly app: TuilRuntime;
  getDocument(): PlaygroundDocumentV1;
  update(document: PlaygroundDocumentV1): void;
}

export function createTuilGhosttyDocumentSession(
  initialDocument: PlaygroundDocumentV1,
): TuilGhosttyDocumentSession {
  let current = validatePlaygroundDocument(initialDocument);
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => current;
  const Surface = () => {
    const document = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return renderNode(document.root);
  };
  const app = createApp({
    id: "tuil-ghostty-document-session",
    component: Surface,
    theme: createDefaultThemeRegistry().resolve(current.terminal.theme),
    terminal: {
      ...browserTerminalProbe(current.terminal.width, current.terminal.height),
      mode: "interactive",
      capabilities: {
        width: current.terminal.width,
        height: current.terminal.height,
        colorDepth: current.terminal.colorDepth ?? 24,
        unicode: current.terminal.unicode ?? true,
        hyperlinks: true,
        interactive: true,
        tty: true,
        alternateScreen: true,
        mouse: true,
        reducedMotion: current.terminal.reducedMotion ?? false,
        platform: "linux",
      },
    },
  });
  return Object.freeze({
    app,
    getDocument: getSnapshot,
    update(document: PlaygroundDocumentV1) {
      current = validatePlaygroundDocument(document);
      for (const listener of listeners) listener();
    },
  });
}

export function generatePlaygroundTsx(document: PlaygroundDocumentV1): string {
  validatePlaygroundDocument(document);
  const imports = [...new Set<string>([])] as string[];
  const emit = (node: PlaygroundNodeV1, depth: number): string => {
    imports.push(node.component);
    const indent = "  ".repeat(depth);
    const props = Object.entries(node.props)
      .map(([key, value]) => ` ${key}={${JSON.stringify(value)}}`)
      .join("");
    const slots = Object.entries(node.slots ?? {}).map(([name, nodes]) => {
      const region = `${node.component}.${name === "appBar" ? "AppBar" : name === "statusBar" ? "StatusBar" : "Main"}`;
      return `${indent}  <${region}>\n${nodes.map((child) => emit(child, depth + 2)).join("\n")}\n${indent}  </${region}>`;
    });
    const children = node.children ?? [];
    if (children.length === 0)
      if (slots.length === 0)
        return `${indent}<${node.component} id=${JSON.stringify(node.id)}${props} />`;
    return `${indent}<${node.component} id=${JSON.stringify(node.id)}${props}>\n${[...slots, ...children.map((child) => emit(child, depth + 1))].join("\n")}\n${indent}</${node.component}>`;
  };
  const body = emit(document.root, 2);
  return `import { ${[...new Set(imports)].sort().join(", ")} } from "@mwillbanks/tuil-ink";\n\nexport function PlaygroundApplication() {\n  return (\n${body}\n  );\n}\n`;
}
