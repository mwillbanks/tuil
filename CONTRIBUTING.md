# Contributing to tuil

Thanks for helping improve tuil. Changes should preserve its central contract:
one application model must behave predictably in an interactive terminal,
redirected output, tests, stories, and documentation.

## Prerequisites

- Bun 1.3.14 or newer
- OSV-Scanner 2.x
- a checkout without unrelated edits in the files you plan to change

Install dependencies from the repository root:

```npm
bun install --frozen-lockfile
```

## Development workflow

1. Start from an issue or a clearly scoped change.
2. Add or update tests with the behavior.
3. Use public package exports rather than reaching across workspace internals.
4. Keep interactive behavior paired with a deterministic static fallback.
5. Update the documentation when public behavior, packages, or commands change.
6. Dispose event, extension, plugin, and theme observers in every teardown path.
7. Run the focused package test while iterating.
8. Run the complete quality gate before opening a pull request.

Useful commands:

```npm
bun run typecheck
bun run test
bun run build
bun run docs
```

The native playground is authoritative for keyboard input, focus, terminal
resizing, color capability, theme behavior, and cleanup:

```npm
bun run playground
```

## Quality gates

Before submitting a pull request, run:

```npm
bun run check
bun run security
```

Together the gates run Biome, TypeScript, coverage-gated Bun tests, all package
builds, Fallow code-quality analysis, and OSV dependency scanning. Do not
suppress a finding merely to make a gate green. Every suppression must
document why the reported path is intentional and safe.

Validate the statically exported documentation separately:

```npm
bun run docs:check
```

## Tests

Tests should assert semantic behavior rather than ANSI coordinates whenever
possible. Cover the interaction paths affected by the change, including:

- keyboard navigation and focus restoration;
- terminal capability and resize behavior;
- static or redirected output;
- cancellation, cleanup, and failure paths;
- typed route, form, and workflow contracts; and
- public package and registry boundaries.

Generated registry mirrors are verified against their source owners. Edit the
source registry item and regenerate the mirror instead of editing generated
files independently.

## Documentation

Documentation lives in `apps/docs`. Package-manager commands in MDX must use
the `npm` code-fence language so Fumadocs can translate them for npm, Bun,
pnpm, and Yarn.

The site is exported with the `/tuil/` base path used by GitHub Pages. Keep
links base-path-safe and verify both the home page and representative docs
routes after a production build.

## Commits and pull requests

Use Conventional Commits:

```text
feat: add terminal table filtering
fix(router): restore focus after cancellation
docs: explain static output modes
```

Keep a pull request focused. Complete the repository pull request template,
describe compatibility impact, link the relevant issue, and include the exact
validation performed. Visual changes should include desktop and mobile
evidence.

Release Please turns conventional commits on `main` into one coordinated
release pull request for the public package suite. Merging that pull request
creates GitHub releases and publishes unpublished package versions to npm with
provenance.

Repository automation requires a `RELEASE_PLEASE_TOKEN` Actions secret. The
release token must belong to a dedicated maintainer or automation account and
have repository contents, issues, and pull-request write access so Release
Please pull requests trigger the normal CI checks. npm publishing uses trusted
publishing through the `ci.yml` GitHub Actions workflow and does not accept a
long-lived npm token. If publication is interrupted after GitHub releases are
created, manually dispatch the **CI** workflow with the full release commit
SHA. Recovery checks out that immutable commit and verifies every expected
component release tag before publishing. The publisher is idempotent and skips
versions already present on npm.

## Security

Never include vulnerability details, credentials, tokens, private keys, or
other secrets in a public issue or pull request. Follow [SECURITY.md](SECURITY.md)
for private reporting.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
General usage questions belong in the channel described by
[SUPPORT.md](SUPPORT.md), not in vulnerability reports.
