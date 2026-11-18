import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanup,
  clickPointerTarget,
  renderTuil,
} from "@mwillbanks/tuil-testing-ink";
import { createElement } from "react";
import type { ProductionRecordSource } from "../../examples/_shared.tsx";
import { Playground } from "../../apps/playground/src/index.tsx";
import { FileManagerApplication } from "../../examples/file-manager/src/index.tsx";
import { DocsBrowserApplication } from "../../examples/docs-browser/src/index.tsx";

afterEach(cleanup);
test("playground toolbar selects stories and variants, toggles themes, and bounds scrolling", async () => {
  const stories: string[] = [];
  const themes: string[] = [];
  const instance = renderTuil(
    createElement(Playground, {
      onStoryChange: (id, variant) => stories.push(id + ":" + variant),
      onThemeChange: (theme) => themes.push(theme),
    }),
    { terminal: { capabilities: { width: 140, height: 40, mouse: true } } },
  );
  await instance.ready;
  for (
    let n = 0;
    n < 100 && !instance.screen.frame().includes("Component browser");
    n++
  )
    await Bun.sleep(5);
  expect(instance.screen.frame()).toContain("Component browser");
  await clickPointerTarget(instance, "playground-scroll-down");
  expect(instance.screen.frame()).toContain("Preview scroll offset: 27");
  await clickPointerTarget(instance, "playground-scroll-up");
  expect(instance.screen.frame()).toContain("Preview scroll offset: 0");
  await instance.user.press("pageDown");
  expect(instance.screen.frame()).toContain("Preview scroll offset: 27");
  await instance.user.press("pageUp");
  expect(instance.screen.frame()).toContain("Preview scroll offset: 0");
  await clickPointerTarget(instance, "playground-next-variant");
  await clickPointerTarget(instance, "playground-next-story");
  await clickPointerTarget(instance, "playground-previous-story");
  await clickPointerTarget(instance, "playground-theme");
  expect(stories).toHaveLength(3);
  expect(stories[1]).toStartWith("forms:");
  expect(stories[2]).toStartWith("foundation:");
  expect(themes).toEqual(["default-light"]);
  await instance.cleanup();
});
test("documented default sources enumerate multiple filesystem batches and read real previews", async () => {
  const root = await mkdtemp(join(tmpdir(), "tuil-example-source-"));
  try {
    await mkdir(join(root, "apps/docs/content/docs"), { recursive: true });
    await writeFile(join(root, "README.md"), "FILE_PREVIEW_READY");
    await Promise.all(
      Array.from({ length: 105 }, async (_, index) => {
        const name = String(index).padStart(3, "0");
        await writeFile(join(root, "file-" + name + ".txt"), "file " + name);
        await writeFile(
          join(root, "apps/docs/content/docs/" + name + ".mdx"),
          "# Document" + name + "\n\nDOC_PREVIEW_READY",
        );
      }),
    );

    const originalDirectory = process.cwd();
    try {
      process.chdir(root);
      for (const [component, expected] of [
        [FileManagerApplication, "FILE_PREVIEW_READY"],
        [DocsBrowserApplication, "DOC_PREVIEW_READY"],
      ] as const) {
        const instance = renderTuil(createElement(component), {
          terminal: { capabilities: { width: 120, height: 40 } },
        });
        try {
          await instance.ready;
          for (
            let n = 0;
            n < 200 && !instance.screen.frame().includes(expected);
            n++
          )
            await Bun.sleep(5);
          expect(instance.screen.frame()).toContain(expected);
        } finally {
          await instance.cleanup();
        }
      }
    } finally {
      process.chdir(originalDirectory);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file manager selects a file and presents its read failure", async () => {
  const reads: string[] = [];
  const source: ProductionRecordSource = {
    async *stream() {
      yield ["unavailable.txt"];
    },
    async read(path: string) {
      reads.push(path);
      if (path === "README.md") return "Initial preview";
      throw new Error("File read unavailable");
    },
  };
  const instance = renderTuil(<FileManagerApplication source={source} />, {
    terminal: { capabilities: { width: 120, height: 40 } },
  });
  await instance.ready;
  for (
    let n = 0;
    n < 100 && !instance.screen.frame().includes("unavailable.txt");
    n++
  )
    await Bun.sleep(5);
  expect(instance.app.focus.focus("file-tree")).toBe(true);
  await instance.user.press("end");
  await instance.user.press("enter");
  expect(reads).toContain("unavailable.txt");
  expect(instance.screen.frame()).toContain("Preview:");
  expect(instance.screen.frame()).toContain("File read");
  await instance.cleanup();
});
