---
name: building-tuil-workflows
description: Design, implement, persist, and test versioned tuil workflows and operations. Use for wizards, resumable tasks, transitions, parallel work, rollback, cancellation, operation progress, or workflow UI.
---

# Build tuil workflows

1. Model a versioned workflow with `defineWorkflow`, stable step ids, explicit transitions, and serializable state.
2. Use ordinary steps for decisions and `defineOperationStep` for cancellable work. Every async operation must honor its `AbortSignal`.
3. Keep route transitions observable and synchronized with the active workflow step; do not duplicate workflow truth in component state.
4. Define persistence migrations before changing a persisted schema. Reject incompatible or in-flight snapshots that cannot be resumed safely.
5. Implement retry, back, skip, cancellation, rollback, nested, and parallel behavior only where the product contract requires it.
6. Render progress, errors, blocked state, and recovery actions through workflow and operation components with semantic status metadata.
7. Test the success path plus failure, cancellation, restore, migration, rollback, invalid transition, and non-interactive execution.
8. Dispose workflow runners, operations, subscriptions, and router instances.
