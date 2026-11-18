import { expect, test } from "bun:test";
import { classifyTest, isExcludedTest } from "./suites.ts";

test("suite ownership assigns each test to one explicit lane", () => {
  expect(classifyTest("packages/core/src/core.test.ts")).toBe("unit");
  expect(classifyTest("tooling/checks/test-policy.test.ts")).toBe("unit");
  expect(classifyTest("tests/functional/cli.test.ts")).toBe("functional");
  expect(classifyTest("tests/regression/layout.test.ts")).toBe("regression");
  expect(() => classifyTest("tests/unknown.test.ts")).toThrow("owning unit");
  expect(() => classifyTest("registry/unknown.test.ts")).toThrow("owning unit");
});

test("coverage implementation and harness tests are not generated reports", () => {
  expect(isExcludedTest("coverage/generated.test.ts")).toBeTrue();
  expect(
    isExcludedTest("tooling/coverage/lcov-to-istanbul.test.ts"),
  ).toBeFalse();
  expect(
    isExcludedTest("tests/functional/coverage/lcov-write.test.ts"),
  ).toBeFalse();
});
