## Summary

<!-- What changed, and what user or maintainer outcome does it deliver? -->

## Scope

<!-- List the packages, runtime surfaces, registry items, or docs sections affected. -->

## Behavior and compatibility

- [ ] Public API compatibility was preserved, or the breaking change and migration path are documented.
- [ ] Interactive behavior has a deterministic static or redirected-output path where applicable.
- [ ] Focus, keyboard input, cleanup, cancellation, and terminal resizing were considered.
- [ ] Documentation and examples were updated for user-visible behavior.

## Validation

<!-- List exact focused tests and repository gates you ran. -->

- [ ] `bun run check`
- [ ] `bun run docs:check` when documentation or public behavior changed
- [ ] Visual changes include desktop and mobile evidence

## Security

- [ ] No credentials, secrets, private data, or unsanitized terminal content were added.
- [ ] Dependency, file-write, registry, and command-execution changes were reviewed for trust-boundary impact.

## Related issue

<!-- Use "Closes #123" when this pull request fully resolves an issue. -->
