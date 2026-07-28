// fallow-ignore-file unused-file -- Loaded by URL from the Tree-sitter worker client.
import {
  type Edit,
  Language,
  type Node,
  Parser,
  type Tree,
} from "@vscode/tree-sitter-wasm";

interface ParseRequest {
  readonly type: "parse";
  readonly id: number;
  readonly documentId: number;
  readonly language: string;
  readonly source: string;
  readonly reusePrevious: boolean;
  readonly previousRevision?: number;
  readonly edit?: Edit;
  readonly cancellation: SharedArrayBuffer;
}

interface DisposeRequest {
  readonly type: "dispose";
  readonly documentId: number;
}

type WorkerRequest = ParseRequest | DisposeRequest;

function syntaxNodeKind(type: string): string {
  if (
    [
      "export",
      "import",
      "const",
      "let",
      "var",
      "function",
      "return",
      "if",
      "else",
      "class",
      "interface",
      "type",
    ].includes(type)
  ) {
    return "keyword";
  }
  if (type.includes("string")) return "string";
  if (type.includes("comment")) return "comment";
  return type;
}

function byteToCodeUnitOffsets(source: string): ReadonlyMap<number, number> {
  const offsets = new Map<number, number>([[0, 0]]);
  let bytes = 0;
  let codeUnits = 0;
  for (const character of source) {
    bytes += new TextEncoder().encode(character).length;
    codeUnits += character.length;
    offsets.set(bytes, codeUnits);
  }
  return offsets;
}

interface WorkerSyntaxNode {
  readonly start: number;
  readonly end: number;
  readonly type: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly diagnostic?: {
    readonly severity: "error";
    readonly message: string;
  };
}

function workerSyntaxNode(
  node: Node,
  offsets: ReadonlyMap<number, number>,
  sourceLength: number,
): WorkerSyntaxNode {
  return {
    start: offsets.get(node.startIndex) ?? sourceLength,
    end: offsets.get(node.endIndex) ?? sourceLength,
    type: syntaxNodeKind(node.type),
    startLine: node.startPosition.row,
    endLine: node.endPosition.row,
    diagnostic: node.isError
      ? { severity: "error", message: "Unclosed block" }
      : undefined,
  };
}

function syntaxNodes(root: Node, source: string) {
  const offsets = byteToCodeUnitOffsets(source);
  const output: WorkerSyntaxNode[] = [];
  const pending = [...root.children];
  while (pending.length > 0) {
    const node = pending.pop() as Node;
    output.push(workerSyntaxNode(node, offsets, source.length));
    pending.push(...node.children);
  }
  return output;
}

const runtime = import.meta.resolve(
  "@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm",
);
let initialization: Promise<void> | undefined;
const languages = new Map<string, Promise<Language>>();
const trees = new Map<
  number,
  { readonly tree: Tree; readonly revision: number }
>();

function languageFor(id: string): Promise<Language> {
  initialization ??= Parser.init({ locateFile: () => runtime });
  let loaded = languages.get(id);
  if (!loaded) {
    loaded = initialization.then(() =>
      Language.load(
        Bun.fileURLToPath(
          import.meta.resolve(
            `@vscode/tree-sitter-wasm/wasm/tree-sitter-${id}.wasm`,
          ),
        ),
      ),
    );
    languages.set(id, loaded);
  }
  return loaded;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(value: unknown): void;
};

function disposeTree(documentId: number): void {
  trees.get(documentId)?.tree.delete();
  trees.delete(documentId);
}

function retainedTree(request: ParseRequest) {
  const retained = trees.get(request.documentId);
  if (
    !request.reusePrevious ||
    retained?.revision !== request.previousRevision
  ) {
    disposeTree(request.documentId);
    return undefined;
  }
  return retained;
}

function parseTree(
  parser: Parser,
  source: string,
  previous: Tree | undefined,
  cancelled: Int32Array,
): Tree | null {
  try {
    return parser.parse(source, previous, {
      progressCallback: () => Atomics.load(cancelled, 0) === 1,
    });
  } finally {
    parser.delete();
    previous?.delete();
  }
}

function preparePreviousTree(
  retained: ReturnType<typeof retainedTree>,
  edit: Edit | undefined,
): Tree | undefined {
  if (!retained) return undefined;
  const previous = retained.tree.copy();
  if (edit) previous.edit(edit);
  return previous;
}

function acceptParsedTree(
  tree: Tree | null,
  cancelled: Int32Array,
): Tree | undefined {
  if (Atomics.load(cancelled, 0) === 1) {
    tree?.delete();
    return undefined;
  }
  if (!tree) throw new Error("Tree-sitter parsing was cancelled");
  return tree;
}

async function parseRequest(request: ParseRequest): Promise<void> {
  const { id, documentId, language, source, edit, cancellation } = request;
  const cancelled = new Int32Array(cancellation);
  const grammar = await languageFor(language);
  if (Atomics.load(cancelled, 0) === 1) return;
  const parser = new Parser();
  parser.setLanguage(grammar);
  const retained = retainedTree(request);
  const previous = preparePreviousTree(retained, edit);
  const incremental = Boolean(previous);
  const tree = acceptParsedTree(
    parseTree(parser, source, previous, cancelled),
    cancelled,
  );
  if (!tree) return;
  const nodes = syntaxNodes(tree.rootNode, source);
  retained?.tree.delete();
  trees.set(documentId, { tree, revision: id });
  workerScope.postMessage({ id, nodes, incremental, revision: id });
}

async function handleParseRequest(request: ParseRequest): Promise<void> {
  try {
    await parseRequest(request);
  } catch (error) {
    if (Atomics.load(new Int32Array(request.cancellation), 0) === 1) return;
    workerScope.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "dispose") {
    disposeTree(event.data.documentId);
    return;
  }
  void handleParseRequest(event.data);
};
