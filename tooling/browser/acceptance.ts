import { mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const workspace = resolve(import.meta.dir, "../..");
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
      .getByText(/(?:Browser terminal|Terminal) failed:/u)
      .first()
      .waitFor({ timeout: 20_000 })
      .then(async () => {
        const failure = await page
          .getByText(/(?:Browser terminal|Terminal) failed:/u)
          .first()
          .textContent();
        throw new Error(failure ?? "Browser terminal failed.");
      }),
  ]);
}

const docs = staticServer(resolve(workspace, "apps/docs/out"), "/tuil");
const storybook = staticServer(
  resolve(workspace, "apps/showcase/dist-storybook"),
);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) =>
    runtimeErrors.push(error.stack ?? error.message),
  );
  const docsOrigin = `http://127.0.0.1:${docs.port}/tuil`;
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
  await waitForTerminal(page);
  const showcasePreview = page.locator(".showcase-preview");
  assert(
    await showcasePreview.isVisible(),
    "Selecting a showcase card did not render the selected preview.",
  );
  await page.waitForTimeout(1_000);
  const showcasePreviewBox = await showcasePreview.boundingBox();
  assert(
    showcasePreviewBox !== null && showcasePreviewBox.y < 140,
    `Selecting a showcase card did not scroll to its preview: ${JSON.stringify(showcasePreviewBox)}`,
  );
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

  const storyPage = await context.newPage();
  const requests: string[] = [];
  storyPage.on("request", (request) => requests.push(request.url()));
  await healthyPage(
    storyPage,
    `http://127.0.0.1:${storybook.port}/iframe.html?id=components-ecosystem--foundation-running&viewMode=story`,
  );
  await waitForTerminal(storyPage);
  assert(
    (await storyPage.locator("canvas").count()) === 1,
    "Storybook did not mount Ghostty.",
  );
  assert(
    !requests.some(
      (url) => url.includes("4317") || url.includes("/api/tuil-story"),
    ),
    "Storybook contacted the legacy HTTP bridge.",
  );

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
            | { getBoundingClientRect(): { readonly width: number } }
            | undefined;
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
  await waitForTerminal(mobilePage);
  const mobileShowcasePreview = mobilePage.locator(".showcase-preview");
  assert(
    await mobileShowcasePreview.isVisible(),
    "The mobile showcase did not render its selected preview.",
  );
  assert(
    ((await mobileShowcasePreview.boundingBox())?.width ?? 0) <= fit.viewport,
    "The showcase preview overflows the mobile viewport.",
  );
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
  await failureContext.close();
  await context.close();
} finally {
  await browser.close();
  docs.stop(true);
  storybook.stop(true);
}

console.log(`Browser acceptance passed. Artifacts: ${artifactDirectory}`);
