# RFC 0004: Pointer routing

Status: accepted

Pointer input is decoded into normalized events, hit-tested against projected
bounds, then routed through capture and bubble phases. Click, hover, drag,
wheel, and focus are derived consistently. Keyboard operation remains complete
when pointer tracking is unavailable.

Normalized events contain cell coordinates, button, modifiers, click count,
wheel delta, and lifecycle phase. Capture pins move and release to its owner;
removal or disposal releases capture and emits cancellation. Hover enter/leave
derive from successive targets. Mouse tracking is enabled only for interactive,
capable terminals and is always disabled during cleanup.

Semantic and coordinate fixtures cover press/release, double click, both wheel
axes, drag lifecycle, capture, clipping, focus transfer, resize, and removal.

## Ownership

The pointer package owns parsing, routing, capture, and hover state. Renderer
adapters only enable terminal tracking and publish measured bounds.
