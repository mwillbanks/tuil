# Baseline restoration

The starting commit was `3760190cf10e334a15d10b2980b82b8c39bd8811`. The main ruleset requires `Workspace validation` and `Dependency security / osv-scan` on a branch current with main.

Planning recorded 46 OSV alerts against `bun.lock`, zero open Dependabot alerts, and zero secret-scanning alerts. Refreshing GitHub during implementation showed 46 open OSV alerts and no open issues. Dependabot pull requests [#34](https://github.com/mwillbanks/tuil/pull/34) and [#38](https://github.com/mwillbanks/tuil/pull/38) cover changes in this migration. Reconcile each with the final diff after merge. Verify the clean SARIF analysis resolves the remaining alerts on main before merging the release candidate.

## Security evidence

OSV Scanner 2.7.1 found the following affected resolutions in the starting lockfile. The package relationships come from that lockfile. The refreshed lockfile scans clean.

| Affected package       | Parent or workspace                      | Current resolution |
| ---------------------- | ---------------------------------------- | ------------------ |
| brace-expansion 5.0.9  | minimatch                                | 5.0.13             |
| fallow 3.17.0          | root tooling                             | 3.43.2             |
| fast-uri 3.1.5         | ajv                                      | 3.1.9              |
| fast-xml-parser 5.11.0 | streaming                                | 5.12.1             |
| glob 13.0.6            | Vite React docgen plugin                 | Removed            |
| js-yaml 4.3.1          | cosmiconfig                              | 4.3.2              |
| minimatch 10.2.5       | ts-morph and glob                        | 11.0.9             |
| next 16.3.1            | docs and Fumadocs integrations           | Removed            |
| sharp 0.35.3           | Next.js and full-screen example          | 0.35.5             |
| shell-quote 1.10.0     | react-devtools-core                      | Removed            |
| smol-toml 1.8.0        | streaming                                | 1.9.1              |
| source-map-js 1.2.1    | Tailwind and PostCSS                     | 1.2.2              |
| storybook 10.5.9       | showcase and Storybook adapter           | 10.6.7             |
| vite 8.2.1             | showcase, Storybook and Fumadocs tooling | Removed            |
| zod 4.4.3              | Fumadocs                                 | 4.6.7              |

## Remediation ledger

| Finding                                                                       | Owner                   | Disposition and acceptance                                                                                                                                       |
| ----------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projection accepted disconnected child metadata and invalid geometry.         | Renderer                | Derive children from parent IDs. Exercise reparenting, removal, hit testing, and atomic rejection in the layout regression suite.                                |
| Ink 8 filtered raw SGR events and waited for output write callbacks.          | Terminal runtime        | Read mouse reports at the stream boundary and acknowledge capture writes. Exercise split prefixes, click, drag, resize, and backend shutdown.                    |
| Ghostty loading and reset could retain readiness from a replaced terminal.    | Browser and docs        | Track readiness with the current terminal configuration. Exercise reset, semantic companions, mobile controls, and failure recovery under both deployment paths. |
| React render-time state changes could survive a discarded render.             | Component runtime       | Commit form registrations and virtualizer measurements in layout effects. Exercise lazy table projection and run React Doctor.                                   |
| Showcase acceptance identifiers diverged from portable fixtures.              | Registry and acceptance | Use registry export names in story variant keys. Verify every public item has an executable acceptance surface.                                                  |
| The packed consumer relied on a handwritten list of third-party dependencies. | Publication             | Install local archives with dependency overrides. Check each declaration export, the Storybook adapter, templates, and the CLI.                                  |
| Unit clocks and obsolete framework assumptions made acceptance unreliable.    | Test harness            | Use controlled clocks, detect timing APIs in unit helpers, and run browser and cross-package suites through the root harness.                                    |

Additional acceptance found eight related groups.

- Validate finite geometry, frame rates, and document offsets before applying changes. Regression tests verify atomic rejection.
- Preserve wide glyphs, wrap boundaries, and pending write callbacks. Regression tests exercise terminal playback and disposal.
- Preserve rich-editor history and block identity on rejected edits. Regression tests exercise invalid paths and first insertion.
- Retain streamed prefixes, nullable JSON-LD fields, and nanosecond query precision. Regression tests exercise these public contracts.
- Expand shared content references at each path and preserve diff hunk headers when folding unchanged lines. Unit tests assert the resulting trees and views.
- Route each wheel report once and decode standard horizontal SGR input. The scroll-area regression asserts callback, focus, and rendered offset.
- Finish static Ink lifecycles after the first frame. Packed starter projects run the documented start command with redirected output.
- Preserve native process identity and installed CLI help behavior. Package and browser harnesses check downstream callers.

The workspace build audit found filesystem-dependent discovery, a release environment leak in the scope fixture, and quoted Git paths that skipped files with Unicode names. Workspace discovery now sorts each root, preserves full Git paths, and accepts an explicit environment for isolated tests. The scope fixtures exercise release mode and tracked and untracked filenames. [Baseline CI run](https://github.com/mwillbanks/tuil/actions/runs/44404065981)

TanStack Form starts a reconnect timer in terminal processes with no browser devtools. The workspace and generated form starters resolve the compatible event client 0.5.1. The client keeps development connections and skips production retries. The packed starters must finish a redirected run after rendering the form. [TanStack Form dependency fix](https://github.com/TanStack/form/pull/2410)

React Doctor flagged two possible HTML sinks. Ghostty builds accessibility controls with DOM methods and text attributes. The published story generator escapes terminal text before producing ANSI markup for the preview. Browser qualification exercises both paths. The visual composer reports both catalog and TSX generation failures through the status UI.

The first finite unit run after the split passed 293 tests in 1.065 seconds. Restoring coverage-tool discovery increased the suite to 44 files. The first complete regression run passed 19 tests in 10.15 seconds. The shared runner records later unit cycles with their input generation and test inventory. Full qualification requires 95% aggregate line, function, and statement coverage and validates source-file completeness. On Bun 1.4.4, the starting commit passed 541 tests and measured 94.55% lines and 94.17% functions by weighted LCOV. Its singular threshold keys had no effect and LCOV did not provide statement counts. The acceptance gate uses independently instrumented statements and combines runtime and browser results.
