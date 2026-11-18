import { expect, test } from "bun:test";
import { scanPublicExports } from "../../tooling/docs/generate-reference";

const hiddenExports = `
export const HiddenValue = "comment only";
export interface HiddenType { missing: true }
export * from "./hidden";
`;

for (const opener of ["/*", "/**"]) {
  test(`reference scanning resumes after ${opener} block comments`, async () => {
    const result = await scanPublicExports(
      `export const Before = 1;
${opener}
${hiddenExports}
* stray asterisks ** do not close a comment
*/
export interface AfterType { autoFocus?: boolean }
export function afterFunction(): boolean { return true; }
const internalValue = 2;
export { internalValue as AfterAlias };
export * from "./visible";
`,
      "fixture.ts",
    );
    expect(result.symbols.map((symbol) => symbol.name)).toEqual([
      "Before",
      "AfterType",
      "afterFunction",
      "AfterAlias",
    ]);
    expect(result.symbols.every((symbol) => symbol.file === "fixture.ts")).toBe(
      true,
    );
    expect(
      result.symbols.find((symbol) => symbol.name === "AfterType")?.signature,
    ).toBe("export interface AfterType { autoFocus?: boolean }");
    expect(result.starExports).toEqual(["./visible"]);
  });
}

test("reference scanning preserves exports after consecutive and empty comments", async () => {
  const result = await scanPublicExports(
    `/**//* ordinary */ /** JSDoc */
export const First = 1;
/**
 * Allow consumers to disable automatic focus.
 */
export interface TerminalOptions { autoFocus?: boolean }
/* ${hiddenExports} */
export const Terminal = () => <div>Ready</div>;
/**/
export * from "./after-comments";
`,
    "fixture.tsx",
  );
  expect(result.symbols.map((symbol) => symbol.name)).toEqual([
    "First",
    "TerminalOptions",
    "Terminal",
  ]);
  expect(result.starExports).toEqual(["./after-comments"]);
});
