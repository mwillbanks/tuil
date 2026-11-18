# Test harness

Run fast module tests with `bun tooling/checks/suites.ts unit`. Unit tests live beside their owning source module.

Run process, filesystem, React interaction, and consumer contracts with `bun tooling/checks/suites.ts functional`.

Run acceptance baselines, renderer parity, confirmed defect regressions, and bounded performance contracts with `bun tooling/checks/suites.ts regression`.

Run final acceptance with `bun run test:acceptance`. This finite command runs all three suites with test-only instrumentation. It merges actual statement and function counters from the Bun process and browser acceptance at both deployment paths. It checks source-file completeness and enforces 95% aggregate line, function, and statement coverage. Scope restrictions are rejected for this command.

Use `bun tooling/checks/suites.ts inventory` to list every discovered test exactly once. Unknown test locations fail discovery. Generated output and dependencies are excluded. Supply owning paths after a suite name to restrict a development run. Such runs do not apply full-qualification coverage thresholds.

Unit tests must use deferred promises, injected schedulers, or `useTestClock` from [helpers/clock.ts](helpers/clock.ts). Register the clock at module scope. Start asynchronous work, advance virtual time explicitly, then await its result. Use exact deadline assertions and cancel owned timers. The helper restores real timers after each test.

The timing policy rejects direct and aliased real-time calls. It follows local imports, dynamic imports, CommonJS imports, and reexports through `helpers`, `fixtures`, and test-support modules. Keep shared test utilities in those named locations. Unit tests cannot import functional or regression fixtures. Fake clocks control production global timers during each unit test.

Functional and regression contracts may use bounded real time for operating-system, process, browser, or performance behavior. Prefer readiness events over sleeps. Always dispose owned resources. Browser acceptance and package publication checks also run through their dedicated qualification commands.
