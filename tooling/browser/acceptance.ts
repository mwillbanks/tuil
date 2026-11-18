import { mkdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { buildBrowserShowcase } from "../../apps/showcase/src/build-browser.ts";
import { coverageVariable } from "../../tests/helpers/coverage-instrument.ts";
import { chromium, type Page } from "playwright";
import { normalizeBasePath } from "../../apps/docs/src/lib/base-path.ts";

const workspace = resolve(import.meta.dir, "../..");
const coverageArgumentIndex = process.argv.indexOf("--coverage");
const coverageOutputPath =
  coverageArgumentIndex === -1
    ? undefined
    : process.argv[coverageArgumentIndex + 1];
if (
  coverageArgumentIndex !== -1 &&
  (!coverageOutputPath ||
    !isAbsolute(coverageOutputPath) ||
    extname(coverageOutputPath).toLowerCase() !== ".json")
)
  throw new TypeError("--coverage requires an absolute .json output path");
const coverageEnabled = coverageOutputPath !== undefined;
if (coverageEnabled) await buildBrowserShowcase({ coverage: true });

interface BrowserFileCoverage {
  readonly path: string;
  readonly statementMap: Record<string, unknown>;
  readonly fnMap: Record<string, unknown>;
  readonly branchMap: Record<string, unknown>;
  readonly s: Record<string, number>;
  readonly f: Record<string, number>;
  readonly b: Record<string, number[]>;
  [key: string]: unknown;
}

const browserCoverage: Record<string, BrowserFileCoverage> = {};

function mergeCounters(
  target: Record<string, number>,
  incoming: Record<string, number>,
): void {
  for (const [key, count] of Object.entries(incoming))
    target[key] = (target[key] ?? 0) + count;
}

function mergeBrowserFileCoverage(
  filename: string,
  incoming: BrowserFileCoverage,
): void {
  const current = browserCoverage[filename];
  if (!current) {
    browserCoverage[filename] = incoming;
    return;
  }
  for (const key of ["statementMap", "fnMap", "branchMap"] as const) {
    if (JSON.stringify(current[key]) !== JSON.stringify(incoming[key])) {
      throw new Error(
        "Coverage map changed between browser contexts: " + filename,
      );
    }
  }
  mergeCounters(current.s, incoming.s);
  mergeCounters(current.f, incoming.f);
  for (const [branch, counts] of Object.entries(incoming.b)) {
    current.b[branch] = (current.b[branch] ?? counts.map(() => 0)).map(
      (count, index) => count + (counts[index] ?? 0),
    );
  }
}

async function captureBrowserCoverage(page: Page): Promise<void> {
  if (!coverageEnabled) return;
  for (const frame of page.frames()) {
    const report = await frame.evaluate((variable) => {
      const value = (globalThis as unknown as Record<string, unknown>)[
        variable
      ];
      return value && typeof value === "object"
        ? (value as Record<string, BrowserFileCoverage>)
        : null;
    }, coverageVariable);
    for (const [id, incoming] of Object.entries(report ?? {})) {
      mergeBrowserFileCoverage(incoming.path || id, incoming);
    }
  }
}

async function writeBrowserCoverage(): Promise<void> {
  if (!coverageOutputPath) return;
  if (Object.keys(browserCoverage).length === 0)
    throw new Error("Browser coverage instrumentation produced no report");
  await mkdir(dirname(coverageOutputPath), { recursive: true });
  await Bun.write(
    coverageOutputPath,
    JSON.stringify(browserCoverage, null, 2) + "\n",
  );
}

const artifactDirectory =
  process.env["TUIL_BROWSER_ARTIFACTS"] ??
  resolve(workspace, ".browser-acceptance");
await mkdir(artifactDirectory, { recursive: true });

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function staticServer(directory: string, basePath = "") {
  return Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (basePath) {
        if (!pathname.startsWith(basePath))
          return new Response("Not found", { status: 404 });
        pathname = pathname.slice(basePath.length) || "/";
      }
      if (pathname.includes(".."))
        return new Response("Invalid path", { status: 400 });
      const candidates = pathname.endsWith("/")
        ? [`${pathname}index.html`]
        : [pathname, `${pathname}.html`, `${pathname}/index.html`];
      for (const candidate of candidates) {
        const file = Bun.file(resolve(directory, `.${candidate}`));
        if (await file.exists()) {
          const headers = new Headers();
          if (extname(candidate) === ".wasm")
            headers.set("content-type", "application/wasm");
          return new Response(file, { headers });
        }
      }
      return new Response("Not found", { status: 404 });
    },
  });
}

async function healthyPage(page: Page, url: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(response.status() + " " + response.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  assert(response?.ok(), `${url} returned ${response?.status()}.`);
  await page.waitForLoadState("networkidle");
  assert(
    errors.length === 0,
    `${url} reported browser errors: ${errors.join(" | ")}`,
  );
}

async function waitForTerminal(page: Page): Promise<void> {
  await Promise.race([
    page
      .getByText("Interactive terminal ready.")
      .first()
      .waitFor({ timeout: 20_000 }),
    page
      .getByText(
        /(?:Browser terminal failed:|Terminal failed:|Interactive terminal unavailable:)/u,
      )
      .first()
      .waitFor({ timeout: 20_000 })
      .then(async () => {
        const failure = await page
          .getByText(
            /(?:Browser terminal failed:|Terminal failed:|Interactive terminal unavailable:)/u,
          )
          .first()
          .textContent();
        throw new Error(failure ?? "Browser terminal failed.");
      }),
  ]);
}

async function waitForShowcasePreview(page: Page): Promise<void> {
  await waitForTerminal(page);
  try {
    await page.waitForFunction(() => {
      const preview = document.querySelector(".showcase-preview:focus");
      if (!preview) return false;
      const visibleTop =
        preview.getBoundingClientRect().top - (visualViewport?.offsetTop ?? 0);
      return visibleTop >= 0 && visibleTop < 140;
    });
  } catch (cause) {
    const state = await page
      .evaluate(() => ({
        previewTop: document
          .querySelector(".showcase-preview")
          ?.getBoundingClientRect().top,
        activeClass: document.activeElement?.className,
        visualOffset: visualViewport?.offsetTop,
        scrollY,
      }))
      .catch(() => undefined);
    throw new Error(
      "Showcase preview did not receive focus at the top of the viewport: " +
        JSON.stringify({ viewport: page.viewportSize(), state }),
      { cause },
    );
  }
}

const docsBasePath = normalizeBasePath(
  Bun.env["TUIL_DOCS_BASE_PATH"] ?? "/tuil",
);
let docs: ReturnType<typeof staticServer> | undefined;
let showcase: ReturnType<typeof staticServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let acceptanceFailure: { readonly error: unknown } | undefined;
try {
  docs = staticServer(resolve(workspace, "apps/docs/out"), docsBasePath);
  showcase = staticServer(
    resolve(
      workspace,
      coverageEnabled
        ? "apps/showcase/dist/browser-coverage"
        : "apps/showcase/dist/browser",
    ),
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) =>
    runtimeErrors.push(error.stack ?? error.message),
  );
  const docsOrigin = `http://127.0.0.1:${docs.port}${docsBasePath}`;
  await healthyPage(page, `${docsOrigin}/playground/`);
  await waitForTerminal(page);
  assert(
    (await page.locator(".visual-preview .ghostty-terminal canvas").count()) ===
      1,
    "The playground must mount exactly one live terminal canvas.",
  );
  assert(
    (await page.getByLabel("Portable story controls").count()) === 0,
    "The legacy Story selector is still rendered on the playground.",
  );
  const desktopLayout = await page.evaluate(() => {
    const pageDocument = (
      globalThis as unknown as {
        readonly document: {
          querySelector(selector: string):
            | {
                getBoundingClientRect(): {
                  readonly width: number;
                };
              }
            | undefined;
        };
      }
    ).document;
    const workspace = pageDocument.querySelector(".composer-workspace");
    const sidebar = pageDocument.querySelector(".composer-sidebar");
    const preview = pageDocument.querySelector(".visual-preview");
    return {
      workspace: workspace?.getBoundingClientRect().width ?? 0,
      sidebar: sidebar?.getBoundingClientRect().width ?? 0,
      preview: preview?.getBoundingClientRect().width ?? 0,
    };
  });
  assert(
    desktopLayout.sidebar <= desktopLayout.workspace * 0.35 &&
      desktopLayout.preview > desktopLayout.sidebar,
    `The desktop composer is not a sidebar and terminal split: ${JSON.stringify(desktopLayout)}`,
  );
  assert(
    await page.getByRole("button", { name: "Add Alert" }).isVisible(),
    "The browser-safe palette did not load.",
  );
  await page.getByRole("button", { name: "Add AppShell" }).click();
  const insertionTarget = page.getByLabel("Insert into");
  assert(
    (await insertionTarget.count()) === 1,
    `Composer disappeared after insertion: ${runtimeErrors.join(" | ")} ${(await page.locator("body").innerText()).slice(-1_000)}`,
  );
  await insertionTarget.selectOption("main");
  await page.getByRole("button", { name: "Add Alert" }).click();
  await page.getByRole("button", { name: "Duplicate" }).click();
  assert(
    (await page.getByText("Alert ·", { exact: false }).count()) >= 2,
    "Duplication did not create a second node.",
  );
  assert(
    (await page.locator("pre").filter({ hasText: "<AppShell.Main>" }).count()) >
      0,
    "Named slots were not emitted into TSX.",
  );
  await page.getByRole("button", { name: "Move up" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Saved document restored.").waitFor();
  await page
    .locator(".visual-preview")
    .getByRole("button", { name: "Reset session" })
    .click();
  await waitForTerminal(page);
  assert(
    (await page.locator(".visual-preview .ghostty-terminal canvas").count()) ===
      1,
    "Reset leaked a terminal canvas.",
  );
  const semanticCompanions = await page
    .locator(".visual-preview [data-tuil-semantic-companion]")
    .count();
  assert(
    semanticCompanions === 1,
    `Reset left ${semanticCompanions} semantic companions.`,
  );
  await page.keyboard.press("Tab");
  assert(
    (await page.locator(":focus").count()) === 1,
    "Keyboard focus did not enter the composer.",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  assert(
    (await download).suggestedFilename() === "tuil-playground.json",
    "JSON export used the wrong filename.",
  );
  await page.screenshot({
    path: resolve(artifactDirectory, "playground-desktop.png"),
    fullPage: true,
  });

  await healthyPage(page, `${docsOrigin}/showcase/`);
  await page.getByRole("button", { name: "component-acceptance" }).click();
  await page.getByLabel("Search components").fill("Field");
  await page.locator(".showcase-card").first().click();
  await waitForShowcasePreview(page);
  assert(
    (await page.locator(".ghostty-terminal canvas").count()) === 1,
    "Showcase mounted more than the selected live terminal.",
  );
  await page.getByLabel("Capability").selectOption("keyboard");
  assert(
    new URL(page.url()).searchParams.get("capability") === "keyboard",
    "Showcase filters were not stored in the URL.",
  );
  await page.screenshot({
    path: resolve(artifactDirectory, "showcase-selected.png"),
    fullPage: false,
  });
  const selectedStory = new URL(page.url()).searchParams.get("story");
  assert(selectedStory, "Showcase selection did not write its direct link.");
  const resetShowcase = page
    .locator(".showcase-preview")
    .getByRole("button", { name: "Reset session" });
  const showcaseTerminal = page.locator(".showcase-preview .ghostty-terminal");
  await page.keyboard.press("Tab");
  assert(
    await resetShowcase.evaluate(
      (control) => control === document.activeElement,
    ),
    "Keyboard focus did not enter the selected showcase controls.",
  );
  await page.keyboard.press("Tab");
  assert(
    await showcaseTerminal.evaluate(
      (terminal) => terminal === document.activeElement,
    ),
    "Keyboard focus did not reach the selected showcase terminal.",
  );
  const originalCanvas = await page
    .locator(".showcase-preview canvas")
    .elementHandle();
  assert(originalCanvas, "The selected showcase terminal did not mount.");
  await resetShowcase.click();
  await originalCanvas.waitForElementState("hidden");
  await waitForTerminal(page);
  assert(
    await resetShowcase.evaluate((button) => button === document.activeElement),
    "Resetting the selected showcase terminal moved focus away from its control.",
  );
  await captureBrowserCoverage(page);
  await page.reload({ waitUntil: "networkidle" });
  await waitForShowcasePreview(page);
  assert(
    new URL(page.url()).searchParams.get("story") === selectedStory,
    "Reload lost the selected showcase story.",
  );

  const storyPage = await context.newPage();
  const requests: string[] = [];
  storyPage.on("request", (request) => requests.push(request.url()));
  await healthyPage(
    storyPage,
    `http://127.0.0.1:${showcase.port}/?story=foundation&variant=Running`,
  );
  await waitForTerminal(storyPage);
  assert(
    (await storyPage.locator("canvas").count()) === 1,
    "Bun showcase did not mount Ghostty.",
  );
  assert(
    !requests.some(
      (url) => url.includes("4317") || url.includes("/api/tuil-story"),
    ),
    "Bun showcase contacted the legacy HTTP bridge.",
  );

  const storySelection = storyPage.getByRole("navigation", {
    name: "Story selection",
  });
  const alternateStory = storySelection
    .locator("button[aria-pressed=false]")
    .first();
  await alternateStory.click();
  await waitForTerminal(storyPage);
  assert(
    (await storySelection.locator("button[aria-pressed=true]").count()) === 1 &&
      new URL(storyPage.url()).searchParams.has("variant"),
    "Showcase selection did not update the preview and URL.",
  );
  const interactive = storyPage.getByRole("checkbox", { name: "interactive" });
  await interactive.uncheck();
  await storyPage
    .getByText("Static terminal ready.", { exact: true })
    .waitFor();
  assert(
    await storyPage.getByText("Static playback", { exact: true }).isVisible(),
    "Showcase did not switch to static playback.",
  );
  await interactive.check();
  await storyPage
    .getByText("Interactive terminal ready.", { exact: true })
    .waitFor();
  const input = storyPage
    .locator("form")
    .getByRole("textbox", { name: "Terminal input" });
  await input.fill("demo");
  await storyPage.getByRole("button", { name: "Send input" }).click();
  assert(
    (await input.inputValue()) === "",
    "Showcase did not submit terminal input.",
  );
  await storyPage.getByRole("button", { name: "Reset session" }).click();
  await waitForTerminal(storyPage);
  assert(
    (await storyPage.locator("canvas").count()) === 1,
    "Showcase reset leaked a terminal canvas.",
  );
  await captureBrowserCoverage(storyPage);

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobile.newPage();
  await healthyPage(mobilePage, `${docsOrigin}/playground/`);
  const fit = await mobilePage.evaluate(() => {
    const pageDocument = (
      globalThis as unknown as {
        readonly document: {
          readonly documentElement: {
            readonly scrollWidth: number;
            readonly clientWidth: number;
          };
          querySelector(
            selector: string,
          ):
            { getBoundingClientRect(): { readonly width: number } } | undefined;
        };
      }
    ).document;
    return {
      width: pageDocument.documentElement.scrollWidth,
      viewport: pageDocument.documentElement.clientWidth,
      composer:
        pageDocument.querySelector(".visual-composer")?.getBoundingClientRect()
          .width ?? 0,
    };
  });
  assert(
    fit.width <= fit.viewport + 1 && fit.composer <= fit.viewport + 1,
    `The composer overflows the mobile viewport: ${JSON.stringify(fit)}.`,
  );
  assert(
    (await mobilePage.locator(".ghostty-terminal canvas").count()) === 1,
    "The mobile playground must mount exactly one live terminal canvas.",
  );
  const treeTrigger = mobilePage.getByRole("button", {
    name: "Component tree",
  });
  await treeTrigger.click();
  const treeDialog = mobilePage.getByRole("dialog", {
    name: "Component tree",
  });
  assert(
    await treeDialog.isVisible(),
    "The mobile component tree did not open.",
  );
  const closeButton = treeDialog.getByRole("button", { name: "Close" });
  assert(
    await closeButton.evaluate(
      (element) =>
        element ===
        (
          globalThis as unknown as {
            readonly document: { readonly activeElement: unknown };
          }
        ).document.activeElement,
    ),
    "The mobile component tree did not receive initial focus.",
  );
  await mobilePage.screenshot({
    path: resolve(artifactDirectory, "playground-mobile-tree.png"),
    fullPage: false,
  });
  await mobilePage.keyboard.press("Escape");
  assert(
    !(await treeDialog.isVisible()),
    "Escape did not close the mobile component tree.",
  );
  await treeTrigger.click();
  await closeButton.click();
  assert(
    !(await treeDialog.isVisible()),
    "The mobile component tree did not close.",
  );
  assert(
    await treeTrigger.evaluate(
      (element) =>
        element ===
        (
          globalThis as unknown as {
            readonly document: { readonly activeElement: unknown };
          }
        ).document.activeElement,
    ),
    "Focus was not restored to the mobile tree trigger.",
  );
  await mobilePage.screenshot({
    path: resolve(artifactDirectory, "playground-mobile.png"),
    fullPage: false,
  });
  await healthyPage(mobilePage, `${docsOrigin}/showcase/`);
  await mobilePage
    .getByRole("button", { name: "component-acceptance" })
    .click();
  await mobilePage.getByLabel("Search components").fill("Field");
  await mobilePage.locator(".showcase-card").first().click();
  await waitForShowcasePreview(mobilePage);
  const mobileShowcasePreview = mobilePage.locator(".showcase-preview");
  assert(
    ((await mobileShowcasePreview.boundingBox())?.width ?? 0) <= fit.viewport,
    "The showcase preview overflows the mobile viewport.",
  );
  await captureBrowserCoverage(mobilePage);
  await mobile.close();

  const failureContext = await browser.newContext({
    viewport: { width: 1000, height: 800 },
  });
  await failureContext.addInitScript(() => {
    Object.defineProperty(WebAssembly, "compile", {
      configurable: true,
      value: async () => {
        throw new Error("Simulated Ghostty WASM compilation failure");
      },
    });
  });
  const failurePage = await failureContext.newPage();
  await failurePage.goto(`${docsOrigin}/playground/`, {
    waitUntil: "domcontentloaded",
  });
  await failurePage
    .getByText(/Browser terminal failed:/u)
    .first()
    .waitFor({ timeout: 20_000 });
  await captureBrowserCoverage(failurePage);
  await healthyPage(failurePage, docsOrigin + "/showcase/");
  await failurePage.getByLabel("Search components").fill("Field");
  await failurePage.locator(".showcase-card").first().click();
  await failurePage.getByText(/Interactive terminal unavailable:/u).waitFor();
  await failurePage.locator(".showcase-preview:focus").waitFor();
  await failureContext.close();
  await context.close();
  await writeBrowserCoverage();
} catch (error) {
  acceptanceFailure = { error };
}

const cleanupErrors: unknown[] = [];
for (const cleanup of [
  () => browser?.close(),
  () => docs?.stop(true),
  () => showcase?.stop(true),
]) {
  try {
    await cleanup();
  } catch (error) {
    cleanupErrors.push(error);
  }
}
if (acceptanceFailure) throw acceptanceFailure.error;
if (cleanupErrors.length > 0)
  throw new AggregateError(cleanupErrors, "Browser acceptance cleanup failed");

console.log(`Browser acceptance passed. Artifacts: ${artifactDirectory}`);
