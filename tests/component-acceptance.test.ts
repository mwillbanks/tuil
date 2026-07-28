import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "@mwillbanks/tuil";
import { renderStatic } from "@mwillbanks/tuil-ink";
import { renderTuil } from "@mwillbanks/tuil-testing-ink";
import { createTheme } from "@mwillbanks/tuil-theme";
import { createElement } from "react";
import registryIndex from "../apps/registry/public/registry.json";
import {
  type ComponentAcceptanceEntry,
  type ComponentInteractionContract,
  componentAcceptanceDocumentationLines,
  componentAcceptanceInventory,
  validateComponentAcceptanceInventory,
} from "../registry/stories/component-acceptance.ts";
import { ComponentAcceptancePreview } from "../registry/stories/component-fixtures.tsx";
import { platformStories } from "../registry/stories/ecosystem.tsx";
import expectedSnapshots from "./fixtures/component-acceptance.snapshots.json";

function assertCatalogContracts(
  entry: ComponentAcceptanceEntry,
  storySource: string,
  docsSource: string,
): void {
  expect(storySource).toContain(`export const ${entry.storyExport}`);
  expect(storySource).toContain(`name: "${entry.name}"`);
  for (const line of componentAcceptanceDocumentationLines(entry)) {
    expect(docsSource, `${entry.name}:truthful-docs`).toContain(line);
  }
  expect(entry.storyId).toBe(`component-acceptance--${entry.name}`);
  expect(entry.docsPath).toStartWith(
    "/docs/reference/components/acceptance-catalog#",
  );
  expect(entry.fixtureId).toStartWith("acceptance-");
  expect(entry.snapshotId).toEndWith(":static");
  expect(entry.themeContract).toBe(`${entry.name}:theme-render`);
  expect(entry.capabilities.static).toBeTrue();
  expect(entry.capabilities.theme).toBeTrue();
  expect(entry.capabilities.keyboard).toBe(Boolean(entry.interaction));
  expect(entry.capabilities.focus, `${entry.name}:focus-contract`).toBe(
    Boolean(
      entry.interaction?.focusId ??
        entry.interaction?.focusRole ??
        entry.interaction?.focusLabel,
    ),
  );
  expect(entry.capabilities.pointer).toBe(entry.interaction?.pointer ?? false);
}

async function renderComponentStatic(
  entry: ComponentAcceptanceEntry,
): Promise<string> {
  try {
    return await renderStatic(
      createApp({
        component: () =>
          createElement(ComponentAcceptancePreview, { name: entry.name }),
        terminal: {
          mode: "static",
          capabilities: { width: 80, height: 24 },
        },
      }),
      { columns: 80 },
    );
  } catch (error) {
    throw new Error(
      `${entry.name} fixture failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function assertComponentSemantics(
  entry: ComponentAcceptanceEntry,
  interactive: ReturnType<typeof renderTuil>,
): void {
  if (!entry.expectedRole) return;
  const allSemantics = interactive.screen.snapshot().nodes;
  const semantics = allSemantics.filter(
    (node) => node.role === entry.expectedRole,
  );
  const semantic =
    entry.expectedLabel === undefined
      ? semantics[0]
      : semantics.find((node) => node.label === entry.expectedLabel);
  expect(
    semantic,
    `${entry.name}:actual-semantics; available=${JSON.stringify(
      allSemantics.map((node) => ({
        id: node.id,
        role: node.role,
        label: node.label,
      })),
    )}`,
  ).toBeDefined();
  if (entry.expectedLabel) {
    expect(semantic?.label, `${entry.name}:actual-label`).toBe(
      entry.expectedLabel,
    );
  }
}

async function exerciseComponentInteraction(
  entry: ComponentAcceptanceEntry,
  interactive: ReturnType<typeof renderTuil>,
): Promise<void> {
  const interaction = entry.interaction;
  if (!interaction) return;
  if (entry.name === "code-viewer" || entry.name === "markdown-viewer") {
    await Bun.sleep(5);
  }
  ensureComponentFocus(entry.name, interaction, interactive);
  await Bun.sleep(0);
  for (const key of interaction.keys) {
    await interactive.user.press(key === "ctrl+c" ? "\u0003" : key);
  }
  await Bun.sleep(0);
  const frame = interactive.screen.frame();
  for (const expectedEvent of interaction.expectedEvents) {
    expect(
      frame,
      `${entry.name}:actual-state-callback:${expectedEvent}`,
    ).toContain(expectedEvent);
  }
}

function ensureComponentFocus(
  name: string,
  interaction: ComponentInteractionContract,
  interactive: ReturnType<typeof renderTuil>,
): string | undefined {
  const semanticFocusId =
    interaction.focusRole || interaction.focusLabel
      ? interactive.screen
          .snapshot()
          .nodes.find(
            (node) =>
              (!interaction.focusRole || node.role === interaction.focusRole) &&
              (!interaction.focusLabel ||
                node.label === interaction.focusLabel),
          )?.id
      : undefined;
  const focusId = interaction.focusId ?? semanticFocusId;
  if (!focusId) return undefined;
  if (
    interactive.app.focus.focusedId !== focusId &&
    !interactive.app.focus.focus(focusId)
  ) {
    throw new Error(
      `${name}:actual-focus target "${focusId}" is not registered`,
    );
  }
  expect(interactive.app.focus.focusedId, `${name}:actual-focus`).toBe(focusId);
  return focusId;
}

async function exerciseComponentPointer(
  name: string,
  interaction: ComponentInteractionContract,
  focusId: string | undefined,
  interactive: ReturnType<typeof renderTuil>,
): Promise<void> {
  const targetId = interaction.pointerTargetId ?? focusId;
  if (!targetId) {
    throw new Error(`${name}:actual-pointer has no declared target`);
  }
  const bounds = interactive.app.layout.get(targetId)?.bounds;
  expect(bounds, `${name}:actual-pointer-bounds`).toBeDefined();
  if (!bounds || bounds.width < 1 || bounds.height < 1) {
    throw new Error(
      `${name}:actual-pointer-bounds did not project measured bounds`,
    );
  }
  const column = bounds.x + Math.max(1, Math.floor(bounds.width / 2));
  const row = bounds.y + 1;
  const eventCountBefore = acceptanceEventCount(interactive.screen.frame());
  await interactive.user.press(`\u001b[<0;${column};${row}M`);
  await interactive.user.press(`\u001b[<0;${column};${row}m`);
  if (interaction.pointerCallback) {
    expect(
      acceptanceEventCount(interactive.screen.frame()),
      `${name}:actual-pointer-callback`,
    ).toBeGreaterThan(eventCountBefore);
  }
  if (focusId) {
    expect(
      interactive.app.focus.focusedId,
      `${name}:actual-pointer-focus`,
    ).toBe(focusId);
  }
}

function acceptanceEventCount(frame: string): number {
  const events = frame.match(/events:([^·\n]+)/)?.[1]?.trim();
  return !events || events === "none" ? 0 : events.split("|").length;
}

async function exerciseComponentInteractive(
  entry: ComponentAcceptanceEntry,
): Promise<void> {
  const interactive = renderTuil(
    createElement(ComponentAcceptancePreview, { name: entry.name }),
  );
  try {
    await interactive.ready;
    expect(interactive.screen.frame(), `${entry.name}:actual-render`).toContain(
      "acceptance-state:",
    );
    assertComponentSemantics(entry, interactive);
    await exerciseComponentInteraction(entry, interactive);
    if (entry.interaction?.pointer) {
      await exerciseComponentPointerContract(entry);
    }
    const nextThemeId = `acceptance-${entry.name}`;
    interactive.app.themeController.set((current) =>
      createTheme(current, { id: nextThemeId }),
    );
    await Bun.sleep(0);
    expect(interactive.screen.frame(), entry.themeContract).toContain(
      `theme:${nextThemeId}`,
    );
  } finally {
    await interactive.cleanup();
  }
}

async function exerciseComponentPointerContract(
  entry: ComponentAcceptanceEntry,
): Promise<void> {
  const interaction = entry.interaction;
  if (!interaction?.pointer) return;
  const pointerView = renderTuil(
    createElement(ComponentAcceptancePreview, { name: entry.name }),
  );
  try {
    await pointerView.ready;
    const focusId = ensureComponentFocus(entry.name, interaction, pointerView);
    await Bun.sleep(0);
    for (const key of interaction.pointerPreparationKeys) {
      await pointerView.user.press(key === "ctrl+c" ? "\u0003" : key);
    }
    await Bun.sleep(0);
    await exerciseComponentPointer(
      entry.name,
      interaction,
      focusId,
      pointerView,
    );
  } finally {
    await pointerView.cleanup();
  }
}

test("every public registry item owns a unique executable acceptance surface", async () => {
  validateComponentAcceptanceInventory();
  expect(
    componentAcceptanceInventory.map((entry) => entry.name).sort(),
  ).toEqual(registryIndex.items.map((item) => item.name).sort());

  const storySource = await Bun.file(
    resolve(
      import.meta.dir,
      "..",
      "apps/showcase/src/component-acceptance.stories.tsx",
    ),
  ).text();
  const docsSource = await Bun.file(
    resolve(
      import.meta.dir,
      "..",
      "apps/docs/content/docs/reference/components/acceptance-catalog.mdx",
    ),
  ).text();

  const renderedSnapshots: Record<string, string> = {};
  const requestedName = process.env["COMPONENT_ACCEPTANCE_NAME"];
  const entries = requestedName
    ? componentAcceptanceInventory.filter(
        (entry) => entry.name === requestedName,
      )
    : componentAcceptanceInventory;
  for (const entry of entries) {
    assertCatalogContracts(entry, storySource, docsSource);
    const first = await renderComponentStatic(entry);
    const second = await renderComponentStatic(entry);
    if (!first) throw new Error(`${entry.name} rendered an empty fixture`);
    expect(second, entry.snapshotId).toBe(first);
    renderedSnapshots[entry.name] = first;
    if (!process.env["UPDATE_COMPONENT_ACCEPTANCE_SNAPSHOTS"]) {
      const expected = (expectedSnapshots as Readonly<Record<string, string>>)[
        entry.name
      ];
      if (expected === undefined) {
        throw new Error(
          `${entry.snapshotId} is missing its committed snapshot`,
        );
      }
      expect(first, entry.snapshotId).toBe(expected);
    }
    if (process.env["UPDATE_COMPONENT_ACCEPTANCE_SNAPSHOTS"]) continue;
    await exerciseComponentInteractive(entry);
  }

  if (process.env["UPDATE_COMPONENT_ACCEPTANCE_SNAPSHOTS"] && !requestedName) {
    await writeFile(
      resolve(import.meta.dir, "fixtures/component-acceptance.snapshots.json"),
      `${JSON.stringify(renderedSnapshots, null, 2)}\n`,
    );
  }
}, 60_000);

test("major platform stories render their production APIs", async () => {
  const cases = [
    ["Renderer", "LayoutProjection v1"],
    ["Streaming content", "json parser"],
    ["Devtools", "inspectRuntime"],
    ["Registry and plugins", "acceptance-plugin@0.2.0"],
  ] as const;
  for (const [area, evidence] of cases) {
    const frame = await renderStatic(
      createApp({
        component: () =>
          createElement(platformStories.component, {
            area,
            detail: "API-backed acceptance",
          }),
        terminal: {
          mode: "static",
          capabilities: { width: 80, height: 24 },
        },
      }),
      { columns: 80 },
    );
    expect(frame, `${area}:production-api`).toContain(evidence);
  }
});
