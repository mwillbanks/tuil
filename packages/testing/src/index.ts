import type { SemanticRole } from "@mwillbanks/tuil-core";

export interface QueryableSemanticNode {
  readonly key: string;
  readonly id?: string;
  readonly testId?: string;
  readonly role?: SemanticRole;
  readonly label?: string;
  readonly description?: string;
  readonly text?: string;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly checked?: boolean;
  readonly expanded?: boolean;
  readonly valueText?: string;
}

export interface SemanticSnapshot {
  readonly nodes: readonly QueryableSemanticNode[];
  readonly frame: string;
}

export interface SemanticQuery {
  readonly name?: string | RegExp;
  readonly selected?: boolean;
  readonly checked?: boolean;
  readonly disabled?: boolean;
}

function matchesText(
  actual: string | undefined,
  expected: string | RegExp | undefined,
): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  return typeof expected === "string"
    ? actual === expected
    : expected.test(actual);
}

function describe(query: string, value: unknown): string {
  return `${query} ${JSON.stringify(value)}`;
}

export class SemanticScreen {
  constructor(readonly snapshot: () => SemanticSnapshot) {}

  frame(): string {
    return this.snapshot().frame;
  }

  getByRole(
    role: SemanticRole,
    query: SemanticQuery = {},
  ): QueryableSemanticNode {
    return this.#one(
      this.snapshot().nodes.filter(
        (node) =>
          node.role === role &&
          matchesText(node.label, query.name) &&
          (query.selected === undefined || node.selected === query.selected) &&
          (query.checked === undefined || node.checked === query.checked) &&
          (query.disabled === undefined || node.disabled === query.disabled),
      ),
      describe("role", { role, ...query }),
    );
  }

  getAllByRole(
    role: SemanticRole,
    query: SemanticQuery = {},
  ): readonly QueryableSemanticNode[] {
    const matches = this.snapshot().nodes.filter(
      (node) =>
        node.role === role &&
        matchesText(node.label, query.name) &&
        (query.selected === undefined || node.selected === query.selected) &&
        (query.checked === undefined || node.checked === query.checked) &&
        (query.disabled === undefined || node.disabled === query.disabled),
    );
    if (matches.length === 0) {
      throw new Error(
        `Unable to find any semantic nodes by ${describe("role", role)}`,
      );
    }
    return matches;
  }

  getByLabelText(label: string | RegExp): QueryableSemanticNode {
    return this.#one(
      this.snapshot().nodes.filter((node) => matchesText(node.label, label)),
      describe("label", label),
    );
  }

  getByText(text: string | RegExp): QueryableSemanticNode {
    return this.#one(
      this.snapshot().nodes.filter(
        (node) => matchesText(node.text, text) || matchesText(node.label, text),
      ),
      describe("text", text),
    );
  }

  getByTestId(testId: string): QueryableSemanticNode {
    return this.#one(
      this.snapshot().nodes.filter((node) => node.testId === testId),
      describe("test id", testId),
    );
  }

  #one(
    matches: readonly QueryableSemanticNode[],
    description: string,
  ): QueryableSemanticNode {
    if (matches.length === 0) {
      throw new Error(`Unable to find a semantic node by ${description}`);
    }
    if (matches.length > 1) {
      throw new Error(`Found multiple semantic nodes by ${description}`);
    }
    return matches[0] as QueryableSemanticNode;
  }
}

const ansiPattern =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI normalization requires ESC.
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function normalizeTerminalFrame(frame: string): string {
  return frame
    .replace(ansiPattern, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(
      /\u280b|\u2819|\u2839|\u2838|\u283c|\u2834|\u2826|\u2827|\u2807|\u280f/g,
      "⠋",
    )
    .trimEnd();
}
