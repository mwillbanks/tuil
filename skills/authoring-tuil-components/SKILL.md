---
name: authoring-tuil-components
description: Author or revise composable tuil terminal components and registry component implementations. Use for Ink components, compound APIs, slots, controlled state, semantic metadata, focus and keyboard behavior, terminal degradation, or component stories.
---

# Author tuil components

1. Locate the correct registry tier and reuse tuil primitives before adding dependencies.
2. Design composition-first APIs. Use compound components for multi-part behavior and expose `slots`, `slotProps`, `variant`, `size`, `unstyled`, and local style overrides where applicable.
3. Support controlled and uncontrolled state for interactive values. Never switch ownership modes after mount.
4. Route all keyboard input through `useTerminalInput` or tuil hotkeys. Register focus with stable ids and support disabled, read-only, static, and narrow-terminal behavior.
5. Register semantic role, label, description, state, and value metadata. Escape terminal control characters in untrusted display content.
6. Normalize theme defaults through `resolveComponentProps` and slot overrides through `resolveSlotProps`.
7. Add a portable `defineTuilStories` happy path and semantic tests covering input, focus, resizing, and static fallback.
8. Update the registry manifest and validate generation, typecheck, tests, and build.

Do not expose renderer-specific internals as the stable component contract.
