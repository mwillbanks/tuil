import { resolve, dirname } from "node:path";
import {
  Project,
  Node,
  SyntaxKind,
  type CallExpression,
  type Expression,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";

export interface TimingViolation {
  readonly file: string;
  readonly line: number;
  readonly api: string;
}
const namespaces = new Set([
  "globalThis",
  "global",
  "window",
  "Bun",
  "Date",
  "performance",
  "process",
]);
const timerNames = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
]);
const clockReads = new Set([
  "Date.now",
  "performance.now",
  "process.hrtime",
  "process.hrtime.bigint",
]);
const importNamespaces: Readonly<Record<string, string>> = {
  bun: "Bun",
  "node:util": "util",
  util: "util",
  "node:timers": "timers",
  timers: "timers",
  "node:timers/promises": "timerPromises",
  "timers/promises": "timerPromises",
  "node:perf_hooks": "perfHooks",
  perf_hooks: "perfHooks",
};
function canonicalCall(
  expression: CallExpression,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  const callee = expression.getExpression();
  const argument = expression.getArguments()[0];
  const name = canonical(callee, aliases);
  if (name === "require" && argument && Node.isStringLiteral(argument)) {
    return importNamespaces[argument.getLiteralText()];
  }
  if (
    (name === "promisify" || name === "util.promisify") &&
    argument &&
    Node.isExpression(argument)
  ) {
    return canonical(argument, aliases);
  }
  if (Node.isPropertyAccessExpression(callee) && callee.getName() === "bind") {
    return canonical(callee.getExpression(), aliases);
  }
  return undefined;
}

function canonical(
  expression: Expression,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return canonical(expression.getExpression(), aliases);
  }
  if (Node.isCallExpression(expression))
    return canonicalCall(expression, aliases);
  if (Node.isIdentifier(expression))
    return aliases.get(expression.getText()) ?? expression.getText();

  if (Node.isPropertyAccessExpression(expression)) {
    const object = canonical(expression.getExpression(), aliases);
    return object ? object + "." + expression.getName() : undefined;
  }
  if (Node.isElementAccessExpression(expression)) {
    const object = canonical(expression.getExpression(), aliases);
    const key = expression.getArgumentExpression();
    if (object && key && Node.isStringLiteral(key))
      return object + "." + key.getLiteralText();
  }
  return undefined;
}

function importAliases(file: SourceFile): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const name of namespaces) aliases.set(name, name);
  for (const declaration of file.getImportDeclarations()) {
    const namespace = importNamespaces[declaration.getModuleSpecifierValue()];
    if (!namespace) continue;
    const namedNamespace =
      declaration.getNamespaceImport() ?? declaration.getDefaultImport();
    if (namedNamespace) aliases.set(namedNamespace.getText(), namespace);
    for (const binding of declaration.getNamedImports()) {
      const imported = binding.getName();
      aliases.set(
        binding.getAliasNode()?.getText() ?? imported,
        namespace + "." + imported,
      );
    }
  }
  return aliases;
}

function recordAlias(
  declaration: VariableDeclaration,
  aliases: Map<string, string>,
): void {
  const initializer = declaration.getInitializer();
  if (!initializer || !Node.isExpression(initializer)) return;
  const value = canonical(initializer, aliases);
  if (!value) return;
  const name = declaration.getNameNode();
  if (Node.isIdentifier(name)) aliases.set(name.getText(), value);
  if (!Node.isObjectBindingPattern(name)) return;
  for (const binding of name.getElements()) {
    aliases.set(
      binding.getName(),
      value +
        "." +
        (binding.getPropertyNameNode()?.getText() ?? binding.getName()),
    );
  }
}

function aliasBindings(file: SourceFile): Map<string, string> {
  const aliases = importAliases(file);
  const declarations = file.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  );
  for (let pass = 0; pass <= declarations.length; pass += 1) {
    for (const declaration of declarations) recordAlias(declaration, aliases);
  }
  return aliases;
}
function hasControlledClock(file: SourceFile): boolean {
  const helperNames = new Set<string>();
  for (const declaration of file.getImportDeclarations()) {
    if (!declaration.getModuleSpecifierValue().endsWith("/helpers/clock.ts"))
      continue;
    for (const binding of declaration.getNamedImports()) {
      if (binding.getName() === "useTestClock")
        helperNames.add(binding.getAliasNode()?.getText() ?? binding.getName());
    }
  }
  return file
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some(
      (call) =>
        helperNames.has(call.getExpression().getText()) ||
        (call.getExpression().getText() === "jest.useFakeTimers" &&
          call
            .getAncestors()
            .some(
              (ancestor) =>
                Node.isCallExpression(ancestor) &&
                ancestor.getExpression().getText() === "beforeEach",
            )),
    );
}
export function timingViolations(
  source: string,
  filePath = "unit.test.ts",
): readonly TimingViolation[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile(filePath, source);
  const aliases = aliasBindings(file);
  const controlled = hasControlledClock(file);
  const results: TimingViolation[] = [];
  const record = (line: number, api: string) =>
    results.push({ file: filePath, line, api });
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const api = canonical(call.getExpression(), aliases) ?? "";
    const plain = api
      .replace(/^(?:globalThis|global|window)\./, "")
      .replace(/\.(?:call|apply)$/, "");
    const timer =
      timerNames.has(plain) ||
      /^(?:timers|timerPromises)\.(?:setTimeout|setInterval|setImmediate|scheduler\.wait)$/.test(
        plain,
      );
    const sleep = [
      "Bun.sleep",
      "Bun.sleepSync",
      "AbortSignal.timeout",
      "Atomics.wait",
      "Atomics.waitAsync",
    ].includes(plain);
    const current =
      clockReads.has(plain) ||
      plain === "perfHooks.performance.now" ||
      plain === "Date";
    const inFunction = call
      .getAncestors()
      .some(
        (ancestor) =>
          Node.isArrowFunction(ancestor) ||
          Node.isFunctionDeclaration(ancestor) ||
          Node.isFunctionExpression(ancestor) ||
          Node.isMethodDeclaration(ancestor),
      );
    const nativeTime =
      /^(?:timers|timerPromises|perfHooks)\./.test(plain) ||
      plain.startsWith("process.hrtime") ||
      plain === "performance.now";
    const directGlobal =
      /^(?:(?:globalThis|global|window)\.)?(?:setTimeout|setInterval|setImmediate|requestAnimationFrame|Date(?:\.now)?)$/.test(
        call.getExpression().getText(),
      );
    if (
      sleep ||
      nativeTime ||
      (!(controlled && inFunction && directGlobal) && (timer || current))
    )
      record(call.getStartLineNumber(), api);
  }
  for (const expression of file.getDescendantsOfKind(
    SyntaxKind.NewExpression,
  )) {
    if (
      canonical(expression.getExpression(), aliases) === "Date" &&
      expression.getArguments().length === 0 &&
      !(
        controlled &&
        expression
          .getAncestors()
          .some(
            (ancestor) =>
              Node.isArrowFunction(ancestor) ||
              Node.isFunctionDeclaration(ancestor) ||
              Node.isFunctionExpression(ancestor) ||
              Node.isMethodDeclaration(ancestor),
          )
      )
    ) {
      record(expression.getStartLineNumber(), "new Date");
    }
  }
  return results;
}
function isHelper(path: string): boolean {
  return (
    /(?:^|\/)(?:helpers?|fixtures?|test-support|__tests__|__fixtures__)(?:\/|\.|-)/.test(
      path,
    ) || /(?:test|spec|helper|fixture)\.[cm]?[jt]sx?$/.test(path)
  );
}
function relatedImports(path: string, source: string): string[] {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  const file = project.createSourceFile(path, source);
  return [
    ...file
      .getImportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue()),
    ...file
      .getExportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue())
      .filter((value): value is string => Boolean(value)),
    ...file.getDescendantsOfKind(SyntaxKind.CallExpression).flatMap((call) => {
      const expression = call.getExpression();
      const argument = call.getArguments()[0];
      return (expression.getKind() === SyntaxKind.ImportKeyword ||
        expression.getText() === "require") &&
        argument &&
        Node.isStringLiteral(argument)
        ? [argument.getLiteralText()]
        : [];
    }),
  ];
}

async function findHelper(
  target: string,
  readSource: (path: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  const candidates = [
    target,
    ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"].map(
      (suffix) => target + suffix,
    ),
  ];
  for (const candidate of candidates) {
    if (isHelper(candidate) && (await readSource(candidate)) !== undefined)
      return candidate;
  }
  return undefined;
}

async function collectRelatedHelpers(
  path: string,
  absolute: string,
  imports: readonly string[],
  readSource: (path: string) => Promise<string | undefined>,
  pending: string[],
  violations: TimingViolation[],
): Promise<void> {
  for (const imported of imports) {
    if (!imported.startsWith(".")) continue;
    const target = resolve(dirname(absolute), imported);
    if (/[\\/]tests[\\/](?:functional|regression)[\\/]/.test(target)) {
      violations.push({
        file: path,
        line: 1,
        api: "Root harness fixtures cannot be imported by units: " + imported,
      });
      continue;
    }
    const helper = await findHelper(target, readSource);
    if (helper) pending.push(helper);
  }
}

export async function checkUnitTiming(
  paths: readonly string[],
  root = resolve(import.meta.dir, "../.."),
  readSource: (path: string) => Promise<string | undefined> = async (path) => {
    const file = Bun.file(path);
    return (await file.exists()) ? file.text() : undefined;
  },
): Promise<void> {
  const pending = [...paths];
  const visited = new Set<string>();
  const violations: TimingViolation[] = [];
  while (pending.length > 0) {
    const path = pending.pop()!;
    const absolute = resolve(root, path);
    if (visited.has(absolute)) continue;
    visited.add(absolute);
    const source = await readSource(absolute);
    if (source === undefined)
      throw new Error("Unit timing source is missing: " + absolute);
    violations.push(...timingViolations(source, path));
    await collectRelatedHelpers(
      path,
      absolute,
      relatedImports(path, source),
      readSource,
      pending,
      violations,
    );
  }
  if (violations.length > 0) {
    throw new Error(
      "Unit tests require a controlled clock or deferred event:\n" +
        violations
          .map((entry) => entry.file + ":" + entry.line + " " + entry.api)
          .join("\n"),
    );
  }
}
