---
name: building-tuil-forms
description: Build and test tuil terminal forms using TerminalFormController and optional TanStack Form adapters. Use for fields, validation, submission, controlled inputs, focus-on-error, arrays, conditional sections, or form workflows.
---

# Build tuil forms

1. Create one `TerminalFormController` per form or adapt an existing TanStack Form field.
2. Wrap fields in `Form` and use stable field ids. Compose `Field`, labels, descriptions, errors, hints, and controls instead of hiding structure in configuration.
3. Keep value ownership controlled or uncontrolled for the component lifetime. Run synchronous and asynchronous validators through the field/controller APIs with `AbortSignal`.
4. Validate on the intended change, blur, submit, or command boundary. Focus the first invalid enabled field and render `ValidationSummary`.
5. Prevent secret values from appearing in semantic snapshots, logs, or output; use masked inputs.
6. Make submit and validation available as commands, and provide a static representation when input is unavailable.
7. Test typing, navigation, validation ordering, cancellation, submission, disabled/read-only states, and terminal resize.
8. Run format, typecheck, focused tests, and the package build.
