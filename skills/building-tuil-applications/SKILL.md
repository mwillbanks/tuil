---
name: building-tuil-applications
description: Build or extend complete React and Ink terminal applications with tuil runtime, services, commands, focus, hotkeys, themes, modes, and lifecycle. Use for new tuil apps, application architecture, runtime setup, terminal capability handling, or executable tuil examples.
---

# Build tuil applications

1. Inspect the nearest repository instructions and existing package scripts.
2. Create the application with `createApp`; keep services, events, commands, and plugins in the runtime boundary.
3. Render through `@mwillbanks/tuil-ink`. Do not invoke Ink input hooks outside the shared tuil input router.
4. Detect or explicitly supply terminal capabilities. Provide useful static behavior when input, color, Unicode, mouse, or hyperlinks are unavailable.
5. Register commands, hotkeys, focus nodes, services, and plugins with disposable registrations. Release them in reverse ownership order.
6. Keep application components declarative. Put navigation in the router, long-running work in operations, and resumable multi-step behavior in workflows.
7. Add direct happy-path usage plus semantic and interaction tests with `@mwillbanks/tuil-testing-ink`.
8. Run the application package's format, typecheck, test, and build scripts.

Use `bun run playground` to inspect real terminal behavior. Use `createApp({ terminal: { mode: "static" } })` for deterministic non-interactive output.
