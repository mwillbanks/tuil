# Documentation qualification

Run `bun run docs:check` before the functional example harness. Reference generation replaces its output tree. Do not run generation concurrently with example discovery or browser acceptance.

The static exporter uses the Fumadocs Bun MDX loader, React server rendering, Bun browser bundles, and the Tailwind CLI. `TUIL_DOCS_BASE_PATH` controls every route and asset prefix. Qualify both an empty prefix and `/tuil`.

`tests/functional/docs-examples.test.ts` inventories every fenced example in the root README and documentation content. It bundles complete JavaScript and TypeScript examples and checks them with native `bun check`. Source excerpts must identify an existing source file or an explicit import context. Declaration excerpts receive ambient declaration context before syntax validation. Unknown languages and snippets without context fail qualification.

The baseline inventory contains 171 complete examples, 820 contextual source excerpts, 59 command blocks, 58 diagrams, and two data blocks. Counts are measured at execution and can change with authored content. The harness executes the theming, rich-document, and semantic testing guides. It asserts theme identity, replaced document content, and button activation. Browser acceptance exercises interactive stories and the composer. The CLI functional harness qualifies registry initialization and installation.

Counterexamples reject an unqualified JSX fragment and an unknown fence language. Native checking rejects unavailable imports and obsolete API contracts. CLI help runs in an isolated temporary directory and must leave that directory empty. All temporary projects are removed in `finally` blocks.

Source fragments are not standalone programs. Their linked modules remain covered by native checking and the owning suites. Interactive programs that wait for terminal input are qualified through the browser and process harnesses rather than executed without input.
