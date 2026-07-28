# RFC 0003: Layout and bounds

Status: accepted

Renderers project stable nodes with absolute bounds, clipping, order, and
optional hit regions. Pointer routing, scrolling, devtools, and static output
consume this projection instead of renderer-private trees. Bounds are
half-open, integer cell coordinates.

Each projection entry records parentage, bounds, clipping, z-order,
focusability, pointer participation, scroll ownership, and semantic metadata.
Hit testing selects the deepest visible participant after z-order and tree
order. Updates replace one coherent projection so consumers never see a
partially measured tree. Ink measures rendered elements; cell projects bounds
during composition.

Fixtures cover nesting, overlap, clipping, resize, removal, portals, scrolling,
and equivalent Ink/cell hit results. Projection snapshots are the stable public
diagnostic representation.

## Ownership

The renderer package owns the projection. Renderer adapters publish it; focus,
pointer, scroll, testing, and devtools consume it read-only.
