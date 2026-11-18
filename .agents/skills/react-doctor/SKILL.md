---
name: react-doctor
description: Diagnose correctness, lifecycle, performance, and accessibility problems in TUIL React code.
---

# React Doctor

Run `bun run doctor:full` for a workspace audit. Run `bun run doctor:changed` before publishing React changes.

Read the [React Doctor triage playbook](https://www.react.doctor/prompts/react-doctor-agent.md) for a full audit. Use the installed scanner and the repository validation commands.

Trace diagnostics to their source owners. For generated registry copies, fix the canonical registry source and regenerate the mirror. Check sibling implementations and callers before selecting a fix. Record why any diagnostic is inapplicable to a terminal renderer. Add behavior checks for confirmed bugs.

Share the affected paths with the Gate Runner owner. The orchestrator runs the final acceptance suites and verifies the scan on the frozen revision.
