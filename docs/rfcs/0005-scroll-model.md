# RFC 0005: Scroll model

Status: accepted

Scroll state is shared infrastructure with clamped offsets, measured content,
sticky regions, anchoring, restoration, culling, and nested wheel routing.
Components own presentation; the scroll package owns geometry and state
transitions.

Line, page, viewport, absolute, wheel, and `scrollIntoView` operations use the
same transition. Sticky edges survive extent growth only while already
attached. Anchored insertion preserves the visible record. Nested areas consume
only the delta they can apply and bubble the remainder. Variable-height ranges
use measured prefix offsets.

Tests cover both axes, all sticky edges, nested bubbling, resize, variable
height, focus following, streaming insertion, culling, and restoration.

## Compatibility

Offsets and snapshots are backend-independent. Components may customize
presentation, but saved positions and movement semantics remain stable across
Ink, cell, interactive, and static output.
