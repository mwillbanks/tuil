import type { EditorProviderOptions, EditorSession } from "./index";

export function executeClipboardCommand(
  session: EditorSession,
  command: string,
  argument: unknown,
): boolean | Promise<boolean> | undefined {
  if (command === "copy")
    return Promise.resolve(session.copy()).then(() => true);
  if (command === "cut") return Promise.resolve(session.cut()).then(() => true);
  if (command === "paste") {
    return session.paste(typeof argument === "string" ? argument : undefined);
  }
  return undefined;
}

export function replaceSelections(
  session: EditorSession,
  content: string | undefined,
): boolean {
  const snapshot = session.snapshot();
  if (content === undefined || snapshot.readOnly) return false;
  session.dispatch({
    changes: snapshot.selections.map((range) => ({
      range,
      insert: content,
    })),
  });
  return true;
}

export function cutSelections(
  session: EditorSession,
  copied: string | Promise<string>,
): string | Promise<string> {
  const remove = (value: string) => {
    replaceSelections(session, "");
    return value;
  };
  return copied instanceof Promise ? copied.then(remove) : remove(copied);
}

export function pasteSelections(
  session: EditorSession,
  clipboard: EditorProviderOptions["clipboard"],
  value?: string,
): boolean | Promise<boolean> {
  if (value !== undefined) return replaceSelections(session, value);
  if (!clipboard) return false;
  return Promise.resolve(clipboard.read()).then((content) =>
    replaceSelections(session, content),
  );
}
