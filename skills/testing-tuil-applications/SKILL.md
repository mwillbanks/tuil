---
name: testing-tuil-applications
description: Test tuil applications and components with semantic queries, Ink interaction, portable stories, snapshots, and lifecycle cleanup. Use for terminal component tests, keyboard flows, focus, overlays, forms, routing, workflows, resizing, or static fallback validation.
---

# Test tuil applications

1. Render with `renderTuil` and always await `instance.ready`.
2. Query semantic roles, labels, text, and test ids before relying on terminal frame text.
3. Drive behavior with `instance.user.press` and `instance.user.type`; resize through `instance.resize`.
4. Assert visible behavior, semantic state, focus, events, routes, workflow snapshots, and operation outcomes at the public boundary.
5. Cover interactive and static modes plus Unicode/color capability degradation where relevant.
6. Normalize frames before snapshot comparison. Avoid timing-sensitive spinner frames and redact secrets.
7. Clean every instance with `instance.cleanup` or the global `cleanup` hook, including failed assertions.
8. Run the narrow test first, then package tests, root tests, typecheck, and build.

Use portable stories for documentation scenarios, but keep native terminal interaction tests authoritative.
