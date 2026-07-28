# RFC 0008: Devtools protocol

Status: accepted

Devtools communicates through versioned request, response, event, and error
messages. Panels, actions, and queries are contributions with stable IDs and
disposers. Recordings are portable, redacted, and deterministically replayable.

Inspectors expose immutable snapshots and subscriptions for events, commands,
routes, focus, layout, pointer, hotkeys, plugins, workflows, operations,
services, theme, terminal, renderer frames, editors, logs, and performance.
Built-in panels use the same public extension point as plugin panels.

Runtime actions are validated commands with authorization policy, audit records,
and structured results; panels cannot mutate runtime objects directly. Tests
cover negotiation, missing capabilities, plugins, cleanup, auditing, redaction,
deterministic bundles, and both renderer backends.

## Compatibility

Consumers negotiate protocol version and capabilities before subscribing.
Unknown message fields are ignored; unknown message kinds produce structured
errors rather than terminating the transport.
