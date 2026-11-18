import { afterEach, expect, test } from "bun:test";
import {
  getBasePath,
  prefixMarkdownDeploymentPaths,
  withBasePath,
} from "./base-path";

const initialBasePath = process.env["TUIL_DOCS_BASE_PATH"];
const initialLegacyPath = process.env["NEXT_PUBLIC_BASE_PATH"];
afterEach(() => {
  if (initialBasePath === undefined) delete process.env["TUIL_DOCS_BASE_PATH"];
  else process.env["TUIL_DOCS_BASE_PATH"] = initialBasePath;
  if (initialLegacyPath === undefined)
    delete process.env["NEXT_PUBLIC_BASE_PATH"];
  else process.env["NEXT_PUBLIC_BASE_PATH"] = initialLegacyPath;
});

test("deployment paths normalize once and preserve external destinations", () => {
  process.env["TUIL_DOCS_BASE_PATH"] = "tuil///";
  expect(getBasePath()).toBe("/tuil");
  expect(withBasePath("/docs/guide#example")).toBe("/tuil/docs/guide#example");
  expect(withBasePath("/tuil/docs/guide")).toBe("/tuil/docs/guide");
  expect(withBasePath("https://example.test/docs")).toBe(
    "https://example.test/docs",
  );
  expect(withBasePath("//example.test/docs")).toBe("//example.test/docs");
  expect(withBasePath("#example")).toBe("#example");
  expect(prefixMarkdownDeploymentPaths("[Guide](/docs/guide)")).toBe(
    "[Guide](/tuil/docs/guide)",
  );
});

test("root deployment and explicit configuration take precedence", () => {
  process.env["NEXT_PUBLIC_BASE_PATH"] = "/legacy";
  process.env["TUIL_DOCS_BASE_PATH"] = "/";
  expect(getBasePath()).toBe("");
  expect(withBasePath("/docs")).toBe("/docs");
  delete process.env["TUIL_DOCS_BASE_PATH"];
  expect(getBasePath()).toBe("/legacy");
});
