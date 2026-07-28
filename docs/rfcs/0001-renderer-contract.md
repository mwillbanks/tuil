# RFC 0001: Renderer contract

Status: accepted

Renderer backends own mount, update, frame output, terminal mode cleanup, and
static output. Shared layout projection and conformance tests are backend
independent. Application components must not access backend internals. New
backends register by stable ID and pass the same lifecycle scenarios.

## Contract

`RendererBackend<Tree>` receives a context and an application-owned tree, then
returns immutable frames and optional diffs. The runtime owns registration,
selection, invalidation, and terminal output; a backend never writes directly.
Output must be deterministic for a fixed tree, viewport, capabilities, and
theme. Mount and dispose are paired, disposal is idempotent, and terminal modes
are restored after rendering or shutdown failures.

## Compatibility and verification

Ink remains the React compatibility adapter and cell is the Bun-native backend.
Both run the same mount, update, resize, static output, diff, and cleanup
scenarios. Backend-specific features are capability-gated.
