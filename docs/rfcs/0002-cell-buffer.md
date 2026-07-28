# RFC 0002: Cell buffer

Status: accepted

A frame is a rectangular grapheme-aware cell buffer. Composition is
deterministic; wide graphemes reserve continuation cells. Diffing emits changed
spans only. TypeScript is authoritative. Optional native acceleration is a
narrow profiling prototype with identical output; applications must opt in
until an entire measured hot path can cross the FFI boundary.

## Contract

Cells contain one grapheme, colors, attributes, and an optional hyperlink.
Frames additionally own dimensions and cursor state. Continuation cells are
explicit; composition clips without producing partial wide graphemes. Diffing
emits ordered, non-overlapping changed spans. ANSI encoding owns cursor
movement, style transitions, hyperlink termination, and the final reset.

## Ownership and verification

The cell package owns storage, composition, diffing, and encoding; the renderer
package owns lifecycle and output. Fixtures cover graphemes, combining marks,
wide characters, links, clipping, cursor state, and minimal diffs. Native
prototypes must remain byte-for-byte conformant and cannot become the default
without equivalent-workload benchmark evidence.
