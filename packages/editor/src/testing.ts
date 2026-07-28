import type {
  EditorProvider,
  EditorSession,
  EditorSnapshot,
  EditorTransaction,
} from "./index";

export function applyEditorTransactions(
  session: EditorSession,
  transactions: readonly EditorTransaction[],
): EditorSnapshot {
  let snapshot = session.snapshot();
  for (const transaction of transactions) {
    snapshot = session.dispatch(transaction);
  }
  return snapshot;
}

export function assertEditorInvariant(session: EditorSession): void {
  const snapshot = session.snapshot();
  if (snapshot.selections.length === 0) {
    throw new Error("Editor requires at least one selection");
  }
  if (snapshot.selections.filter((item) => item.primary).length > 1) {
    throw new Error("Editor cannot have more than one primary selection");
  }
  for (const item of snapshot.selections) {
    for (const cursor of [item.anchor, item.head]) {
      if (cursor.line < 0 || cursor.column < 0) {
        throw new Error("Editor positions cannot be negative");
      }
    }
  }
}

export async function runEditorProviderConformance(
  provider: EditorProvider,
): Promise<{
  readonly providerId: string;
  readonly capabilities: readonly string[];
}> {
  const session = provider.create({ value: "alpha beta" });
  try {
    assertEditorInvariant(session);
    if (!session.search("beta").length)
      throw new Error(`${provider.id} failed search conformance`);
    session.replace("beta", "gamma");
    if (!session.serialize().includes("gamma"))
      throw new Error(`${provider.id} failed replace conformance`);
    await session.execute("select-all");
    const copied = await session.copy();
    if (!copied.includes("gamma"))
      throw new Error(`${provider.id} failed clipboard conformance`);
    if (!session.undo() || !session.redo())
      throw new Error(`${provider.id} failed history conformance`);
    return Object.freeze({
      providerId: provider.id,
      capabilities: Object.freeze([...provider.capabilities]),
    });
  } finally {
    session.dispose();
  }
}
