# RFC 0006: Editor contract

Status: accepted

Editors expose a provider-independent document, selection, history, input, and
command contract. Buffer, Vim, and rich providers register through extension
points. Controls depend on the contract rather than a concrete engine.

A session owns immutable document snapshots, selections, transactions, undo and
redo history, commands, diagnostics, decorations, and subscriptions. Positions
are UTF-16 offsets; terminal width conversion belongs to the view. Transactions
are atomic and origin-tagged. Provider selection considers document type,
renderer/input capabilities, static output, priority, and explicit application
configuration.

Conformance covers edits, multi-selection, history, resize, masked input,
diagnostics, Vim commands, deterministic snapshots, and disposal.

## Compatibility

Provider-specific state stays behind the session boundary. New providers may
add capabilities without changing controls, commands, testing helpers, or
serialized document formats.
