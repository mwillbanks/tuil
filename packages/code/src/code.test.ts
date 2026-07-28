import { expect, test } from "bun:test";
import {
  CodeDocument,
  createBundledCodeParsers,
  detectCodeLanguage,
  RegexCodeParser,
  TreeSitterCodeParser,
} from "./index.ts";

test("code language detection uses filename and source hints", () => {
  expect(detectCodeLanguage("anything", "file.tsx")).toBe("tsx");
  expect(detectCodeLanguage("#!/bin/bash\necho ok")).toBe("shell");
  expect(detectCodeLanguage("interface User {}")).toBe("typescript");
  expect(detectCodeLanguage("const value = 1")).toBe("javascript");
  expect(detectCodeLanguage('{"value":1}')).toBe("json");
  expect(detectCodeLanguage("plain")).toBe("text");
});

test("code documents parse incrementally, highlight, fold, search, and diagnose", async () => {
  const document = new CodeDocument(
    "export function demo() {\n  return 42;\n}",
    { language: "typescript" },
  );
  const first = await document.parse();
  expect(first.spans.some((span) => span.kind === "keyword")).toBe(true);
  expect(first.folds).toEqual([{ startLine: 0, endLine: 2 }]);
  const start = document.source.indexOf("42");
  document.update(start, start + 2, "43");
  const second = await document.parse();
  expect(second.version).toBeGreaterThan(first.version);
  expect(document.search("43")).toHaveLength(1);
});

test("code views support line numbers, folding, wrapping, and horizontal scroll", async () => {
  const document = new CodeDocument("function demo() {\nveryLongIdentifier\n}");
  await document.parse();
  expect(
    document.render({
      width: 12,
      lineNumbers: true,
      foldedLines: new Set([0]),
    }),
  ).toHaveLength(1);
  expect(document.render({ width: 8, wrap: true }).length).toBeGreaterThan(3);
  expect(document.render({ horizontalOffset: 4 })[1]).toStartWith("Long");
});

test("code views preserve terminal columns and graphemes", async () => {
  const document = new CodeDocument("界界\n🙂e\u0301x\n\u001b[31mred\u001b[0m");
  await document.parse();

  expect(document.render({ width: 3 })).toEqual([
    "界",
    "🙂e\u0301",
    "\u001b[31mred\u001b[0m",
  ]);
  expect(document.render({ width: 7, lineNumbers: true })).toEqual([
    "1 │ 界",
    "2 │ 🙂e\u0301",
    "3 │ \u001b[31mred\u001b[0m",
  ]);
  expect(document.render({ width: 2, wrap: true })).toEqual([
    "界",
    "界",
    "🙂",
    "e\u0301x",
    "\u001b[31mre",
    "d\u001b[0m",
  ]);
  expect(document.render({ horizontalOffset: 2 })[0]).toBe("界");
  expect(document.render({ horizontalOffset: 2 })[1]).toBe("e\u0301x");
});

test("parser cancellation and invalid updates are safe", () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  expect(() =>
    new RegexCodeParser().parse("x", {
      signal: controller.signal,
    }),
  ).toThrow("cancelled");
  expect(() => new CodeDocument("x").update(-1, 0, "y")).toThrow("invalid");
});

test("tree-sitter adapter keeps incremental trees behind TUIL contracts", async () => {
  const previousTrees: unknown[] = [];
  const parser = new TreeSitterCodeParser("tree-sitter-ts", ["typescript"], {
    parse(source, previous) {
      previousTrees.push(previous);
      return {
        nodes: [
          {
            start: 0,
            end: source.length,
            type: "function",
            startLine: 0,
            endLine: 2,
          },
        ],
      };
    },
  });
  const document = new CodeDocument("function run() {\nreturn 1;\n}", {
    language: "typescript",
    parsers: [parser],
  });
  await document.parse();
  document.update(9, 12, "build");
  const result = await document.parse();
  expect(previousTrees[0]).toBeUndefined();
  expect(previousTrees[1]).toBeDefined();
  expect(result.folds).toEqual([{ startLine: 0, endLine: 2 }]);
  document.select(0, 8);
  expect(document.copy()).toBe("function");
  expect(
    document.themedSpans({
      tokenStyles: { function: { foreground: "blue", bold: true } },
      diagnosticStyles: {
        info: { foreground: "blue" },
        warning: { foreground: "yellow" },
        error: { foreground: "red" },
      },
    })[0]?.style,
  ).toEqual({ foreground: "blue", bold: true });
});

test("bundled tree-sitter applies document edits incrementally", async () => {
  const parser = createBundledCodeParsers()[0];
  if (!parser) throw new Error("Missing bundled TypeScript parser");
  const signal = new AbortController().signal;
  const first = await parser.parse("const greeting = '🙂';\n", { signal });
  const second = await parser.parse("const greeting = 'hello';\n", {
    previous: first,
    signal,
  });
  expect(second.incremental).toBeTrue();
  expect(
    second.spans.some(
      (span) =>
        span.kind === "string" &&
        "const greeting = 'hello';\n".slice(span.start, span.end) === "'hello'",
    ),
  ).toBeTrue();
  parser.dispose?.();
  await expect(
    parser.parse("const disposed = true;", { previous: second, signal }),
  ).rejects.toThrow("disposed");
});

test("bundled tree-sitter cancellation rejects in-flight work", async () => {
  const parser = createBundledCodeParsers()[0];
  if (!parser) throw new Error("Missing bundled TypeScript parser");
  const controller = new AbortController();
  const parsing = parser.parse(
    Array.from(
      { length: 20_000 },
      (_, index) => `const value${index} = ${index};`,
    ).join("\n"),
    { signal: controller.signal },
  );
  controller.abort(new Error("cancelled"));
  await expect(parsing).rejects.toThrow("cancelled");
  parser.dispose?.();

  const disposable = createBundledCodeParsers()[0];
  if (!disposable) throw new Error("Missing bundled TypeScript parser");
  const pending = disposable.parse("const pending = true;".repeat(20_000), {
    signal: new AbortController().signal,
  });
  disposable.dispose?.();
  await expect(pending).rejects.toThrow("disposed");
});

test("code diagnostics, selection, parser fallback, and render options stay bounded", async () => {
  const document = new CodeDocument("const value = {\n  key: 1", {
    filename: "demo.ts",
  });
  expect(document.language).toBe("typescript");
  const result = await document.parse();
  expect(result.diagnostics[0]?.message).toBe("Unclosed block");
  document.select(0, 5);
  expect(document.copy()).toBe("const");
  expect(() => document.select(-10, 999)).toThrow("invalid");
  document.select(0, document.source.length);
  expect(document.copy()).toBe(document.source);
  expect(document.render({ width: 0 })).toHaveLength(2);
  document.update(0, 5, "let");
  expect(document.source).toStartWith("let");

  const noParser = new CodeDocument("x", {
    parsers: [],
  });
  await expect(noParser.parse()).rejects.toThrow("No code parser");

  const parser = new TreeSitterCodeParser("diagnostic", ["text"], {
    parse: () => ({
      nodes: [
        {
          start: 0,
          end: 1,
          type: "error",
          diagnostic: { severity: "error", message: "bad" },
        },
      ],
    }),
  });
  expect(
    (await parser.parse("x", { signal: new AbortController().signal }))
      .diagnostics[0]?.message,
  ).toBe("bad");
});
