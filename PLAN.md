# TUIL Platform Expansion Plan

Status: proposed implementation roadmap
Scope: renderer, interaction, editors, rich content, logging, devtools, registry, and production readiness
Runtime direction: Bun-native by default, with optional native acceleration
Primary comparison: OpenTUI
Last architecture review: July 27, 2026

## 1. Product direction

TUIL should become the strongest Bun-native platform for building serious terminal products. It should combine:

- A complete application runtime.
- React and Ink compatibility.
- A first-class terminal interaction model.
- A high-performance Bun-native cell renderer.
- Real Vim-compatible editing options.
- Rich Markdown, code, diff, and structured-content rendering.
- OpenTelemetry and syslog-aware observability interfaces.
- Pluggable, inspectable developer tools.
- Source-owned and package-owned component distribution.
- Deterministic interactive, static, JSON, silent, and embedded output.

TUIL should not become an OpenTUI clone. OpenTUI is primarily a renderer and component platform. TUIL should own the full application lifecycle while matching or exceeding OpenTUI at the renderer, interaction, and rich-content layers.

## 2. Strategic principles

1. Bun-native is the default. Node compatibility may be supported, but it must not dictate the architecture.
2. The renderer is replaceable. Application, layout, focus, input, semantics, commands, and components must not depend on Ink internals.
3. Terminal behavior is a first-class platform contract, not an implementation detail of individual components.
4. Public APIs expose TUIL concepts, never vendor-specific editor, renderer, or parser types.
5. Keyboard support is always complete. Mouse support is additive.
6. Source ownership and centrally maintained components are both supported.
7. Every interactive component has a semantic contract, a keyboard contract, a pointer contract, a static contract, and a test story.
8. Streaming interfaces must be correct under backpressure, resize, cancellation, and partial input.
9. Performance must be measured at the renderer and application layers.
10. A feature is not complete until it is documented, story-backed, tested, themed, and usable in a real example application.

## 3. Current strengths to preserve

TUIL already has a strong application layer that should remain the foundation:

- Lifecycle and disposable resource management.
- Services and typed events.
- Commands, hotkeys, and focus scopes.
- Forms and validation.
- Routing, guards, loaders, and navigation surfaces.
- Operations, cancellation, and progress.
- Persistent workflows.
- Themes, variants, tokens, and slots.
- Plugins with dependency ordering and lifecycle management.
- Registry-installed source-owned components.
- Virtualization utilities.
- Semantic testing.
- Portable stories for terminal, browser, documentation, Storybook, and snapshots.
- Interactive, static, JSON, and silent rendering modes.
- Bun-first CLI, workspace, build, test, documentation, and release workflows.

The implementation must extend these contracts instead of creating parallel application systems.

## 4. Target architecture

```text
TUIL application runtime
  ├── lifecycle, services, events, commands, operations, workflows
  ├── routing, focus, semantics, themes, plugins, registry
  └── stories, testing, docs, devtools
          │
          ▼
  Shared terminal platform contracts
  ├── layout tree and measured bounds
  ├── focus and semantic tree
  ├── pointer and keyboard events
  ├── scroll and viewport model
  ├── editor sessions and transactions
  ├── terminal capabilities and screen ownership
  └── frame and output protocol
          │
          ├── Ink/React backend
          └── Bun-native cell backend
                    ├── TypeScript fallback
                    └── optional Zig/FFI acceleration
```

The Ink backend remains the compatibility and migration path. The cell backend becomes the performance path. Both must pass the same behavior and semantic contract suite.

## 5. Package roadmap

Proposed new or expanded packages:

| Package | Responsibility |
| --- | --- |
| `@mwillbanks/tuil-renderer` | Renderer contracts, frames, scheduling, capabilities, and backend registration |
| `@mwillbanks/tuil-cell` | Bun-native cell buffer, layout projection, composition, and output |
| `@mwillbanks/tuil-pointer` | Mouse parsing, hit testing, pointer events, capture, hover, drag, and drop |
| `@mwillbanks/tuil-scroll` | Scroll areas, scrollbars, culling, sticky scroll, and viewport state |
| `@mwillbanks/tuil-editor` | Editor contracts, optional built-in buffer/Vim/rich modules, provider registration, and editor testing |
| `@mwillbanks/tuil-code` | Tree-sitter code parsing, highlighting, folds, and diagnostics |
| `@mwillbanks/tuil-streaming` | Extensible streaming parse, transform, and render pipeline |
| `@mwillbanks/tuil-content` | Shared code, Markdown, diff, JSON, and selectable-content primitives |
| `@mwillbanks/tuil-logging` | Normalized log records, parsers, enrichment, and pipelines |
| `@mwillbanks/tuil-log-viewer` | Virtualized log search, filtering, detail, tailing, and theming |
| `@mwillbanks/tuil-devtools` | Pluggable runtime inspection, actions, panels, and diagnostics |
| `@mwillbanks/tuil-protocol` | Optional remote/embedded transport and devtools protocol |

Some packages may begin as modules within existing packages. They should be split only when the public boundary and test surface are stable.

## 6. Phase 0: architecture, compatibility, and benchmark baseline

### Objectives

- Freeze the cross-backend contracts before implementation spreads renderer assumptions.
- Establish performance and behavior baselines against the current Ink implementation and OpenTUI.
- Identify the exact component and package migration boundaries.

### Work

1. Write RFCs for:
   - Renderer contract.
   - Cell model.
   - Layout and bounds model.
   - Pointer event model.
   - Scroll and viewport model.
   - Editor session model.
   - Log record and query model.
   - Devtools extension protocol.
2. Inventory all current generated registry components and classify their ownership of input, focus, layout, scrolling, editing, and rendering.
3. Add benchmarks for:
   - 1,000 and 100,000 row lists.
   - Streaming logs.
   - Markdown updates.
   - Diff rendering.
   - Resize storms.
   - Animated frames.
   - Large tables.
4. Establish reference terminal fixtures for ANSI, color depth, mouse protocols, bracketed paste, clipboard, alternate screen, and resize behavior.
5. Define public compatibility guarantees for the Ink backend and the future cell backend.

### Exit criteria

- All contracts have owners and test fixtures.
- No new feature is allowed to depend directly on Ink internals without an adapter boundary.
- Baseline performance results are checked into the repository as machine-readable benchmark artifacts.

## 7. Phase 1: terminal platform foundations

### 7.1 Layout and measured bounds

Create a shared layout projection that records:

- Component identity.
- Parent and child relationships.
- X/Y position.
- Width and height.
- Clipping rectangle.
- Z-order.
- Focusability.
- Pointer participation.
- Scroll container ownership.
- Semantic metadata.

The layout projection must be available to both renderers, the pointer system, focus manager, testing, and devtools.

### 7.2 Pointer system

Implement `@mwillbanks/tuil-pointer` with:

- SGR mouse parsing.
- Button, modifier, and click-count state.
- Pointer movement.
- Hover enter/leave.
- Click and release.
- Wheel and horizontal wheel.
- Drag start/move/end.
- Pointer capture.
- Coordinate-to-component hit testing.
- Bubbling, cancellation, and propagation control.
- Mouse-to-focus behavior.
- Capability detection and fallback.
- Semantic pointer test helpers.

Components that must support pointer interaction:

- Buttons.
- Tabs and tab selects.
- Menus and command palettes.
- Tables and trees.
- Sliders.
- Splitters and resizable panes.
- Dialogs and overlays.
- Scroll areas.
- Text editors.

### 7.3 Clipboard and terminal integration

Add:

- Bracketed paste.
- OSC 52 clipboard read/write where supported.
- Platform clipboard adapters.
- Terminal title management.
- Notifications.
- Suspend/resume.
- Focus reporting.
- Kitty keyboard detection.
- Capability diagnostics.

### 7.4 Scroll and viewport model

Implement `@mwillbanks/tuil-scroll` with:

- Vertical and horizontal scrolling.
- Sticky top/bottom/left/right behavior.
- Scrollbars.
- Wheel handling.
- Line, page, viewport, and absolute movement.
- `scrollIntoView`.
- Nested scroll containers.
- Viewport culling.
- Variable-height measurement.
- Anchored scrolling during streaming insertion.
- Focus-follow behavior.
- Scroll position restoration.
- Static-output and interactive-output projections.

## 8. Phase 2: full Bun-native cell backend

This is a required part of the plan, not a future placeholder.

### 8.1 Cell model

Implement a Bun/TypeScript cell buffer first:

```ts
interface Cell {
  readonly grapheme: string;
  readonly foreground: Color;
  readonly background: Color;
  readonly attributes: CellAttributes;
  readonly link?: string;
}

interface CellFrame {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly Cell[];
  readonly cursor?: CursorState;
}
```

The cell model must handle:

- Wide characters.
- Combining marks.
- Grapheme clusters.
- Zero-width characters.
- ANSI styles.
- Hyperlinks.
- Cursor visibility and shape.
- Clear and erase behavior.
- Background fills.
- Clipping.
- Layer composition.

### 8.2 Frame lifecycle

Implement:

- Previous/current frame comparison.
- Dirty-cell tracking.
- Dirty-row tracking.
- Dirty-rectangle tracking.
- Cursor optimization.
- Output batching.
- Resize invalidation.
- Frame pacing.
- Render cancellation.
- Atomic flush.
- Idle detection.
- Frame statistics.

The frame scheduler must support:

- Render-on-demand mode.
- Target FPS.
- Maximum FPS.
- Live rendering requests.
- Animation ownership.
- Backpressure.
- Test clocks.
- Deterministic frame stepping.

### 8.3 Layout and composition

The cell backend must render:

- Text.
- Boxes.
- Borders.
- Padding and margins.
- Flex-like row/column layout.
- Absolute positioning.
- Overlays.
- Portals.
- Clipping.
- Scroll surfaces.
- Fixed headers and footers.
- Split panes.
- Resizable panes.
- Z-index ordering.

### 8.4 Output modes

Support:

- Alternate screen.
- Main screen.
- Inline output.
- Split footer.
- Scrollback snapshots.
- Captured stdout.
- Passthrough stdout.
- Static output.
- JSON output.
- Silent output.
- Embedded custom streams.

The output protocol must make interactive rendering and scrollback commits coexist without corrupting terminal state.

### 8.5 Optional native acceleration

After the TypeScript cell backend is behaviorally complete:

- Isolate hot loops behind a narrow interface.
- Prototype a Zig implementation of cell diffing and output encoding.
- Load it optionally through Bun FFI.
- Provide prebuilt platform packages only when justified by benchmarks.
- Preserve a pure Bun fallback.
- Never make native installation mandatory for the base TUIL experience.

### 8.6 Renderer conformance

Ink and cell backends must pass the same suites for:

- Layout.
- Focus.
- Semantics.
- Pointer events.
- Keyboard events.
- Scroll behavior.
- Static output.
- Resizing.
- Overlays.
- Forms.
- Editors.
- Streaming.
- Cleanup.

## 9. Phase 3: editor architecture

### 9.1 Decision

Do not use CodeMirror as a new strategic dependency. Its packages continued to publish in 2026, but the upstream repositories were archived on April 15, 2026. It is not an acceptable foundation for TUIL’s long-term editor platform.

Do not use Puck, Slate, or Lexical as the terminal editor core:

- Puck is a browser visual page builder.
- Slate is React/contenteditable-oriented and remains beta in its documentation.
- Lexical is a strong active rich-document framework, but its primary editor model is browser/contenteditable-oriented.

Use:

1. A TUIL-owned terminal buffer and transaction model.
2. A native TUIL Vim adapter.
3. Tiptap/ProseMirror concepts selectively for rich structured documents.
4. Tree-sitter directly for code parsing and highlighting.

### 9.2 Editor contracts

Create `@mwillbanks/tuil-editor` as the editor platform package. Its root export contains only contracts and registration APIs; built-in implementations are explicit tree-shakeable subpath exports:

```text
@mwillbanks/tuil-editor
@mwillbanks/tuil-editor/buffer
@mwillbanks/tuil-editor/vim
@mwillbanks/tuil-editor/rich
@mwillbanks/tuil-editor/testing
```

The root package must not eagerly import every built-in editor. Applications that only need a text field should not pay for Vim, rich-document, syntax, or optional parser code.

The core editor contracts include:

- `EditorDocument`.
- `EditorPosition`.
- `EditorRange`.
- `EditorSelection`.
- `EditorTransaction`.
- `EditorSnapshot`.
- `EditorCommand`.
- `EditorDecoration`.
- `EditorDiagnostic`.
- `EditorMode`.
- `EditorCapability`.
- `EditorBackend`.
- `EditorSession`.
- `EditorProvider`.
- `EditorProviderFactory`.
- `EditorRegistration`.

The contract must support:

- Single and multiline text.
- Grapheme-safe positions.
- Multiple selections.
- Transactional changes.
- Undo/redo.
- Search and replace.
- Decorations.
- Diagnostics.
- Read-only state.
- Masked input.
- Clipboard operations.
- Serialization.
- Mode indicators.
- Viewport anchoring.

No public TUIL API may expose ProseMirror, Tiptap, Lexical, Slate, or other vendor-specific state types.

### Third-party editor providers

Third parties must be able to implement an editor without modifying TUIL or depending on a private built-in implementation. Define a provider contract such as:

```ts
interface EditorProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities: ReadonlySet<EditorCapability>;
  create(options: EditorProviderOptions): EditorSession;
}
```

Providers may contribute:

- A complete editor engine.
- A specialized code editor.
- A database/query editor.
- A structured document editor.
- A domain-specific editor.
- A Vim-compatible mode.
- A remote or process-backed editor.

Registration must support explicit application configuration and plugin-based discovery, while preventing accidental replacement of the default editor. Providers should declare compatibility with document types, renderer capabilities, input capabilities, and static-output modes.

### 9.3 Built-in buffer module

Build the first backend directly in TUIL:

- Text storage.
- Line index.
- Grapheme segmentation.
- Cursor movement.
- Word movement.
- Visual-line movement.
- Selection.
- Delete/change/yank primitives.
- Undo/redo history.
- Search ranges.
- Replace transactions.
- Decorations.
- Diagnostics.
- Paste handling.
- Read-only and password modes.

Use property-based tests for edits, selections, Unicode, history, and transaction composition.

### 9.4 Vim integration

Implement the built-in Vim module exported from `@mwillbanks/tuil-editor/vim` with:

- Normal mode.
- Insert mode.
- Visual mode.
- Visual-line mode.
- Operator-pending mode.
- Counts.
- Motions.
- Registers.
- Yank/delete/change.
- Search.
- Marks.
- Repeat.
- Leader keys.
- Command-line mode.
- Mode-aware status UI.
- Configurable keymaps.

The native Vim adapter is the only planned Vim integration. It must work without an external editor process or runtime.

### 9.5 Editor components

Build all text controls on the shared editor layer:

- `TextInput`.
- `TextArea`.
- `PasswordInput`.
- `SearchInput`.
- `CommandLine`.
- `CodeEditor`.
- `InlineEditor`.
- `EditableTableCell`.
- `EditableTreeNode`.
- `FormFieldEditor`.

Migrate duplicated registry editing logic into these primitives.

### 9.6 Rich documents

Implement the built-in rich-document module exported from `@mwillbanks/tuil-editor/rich` using Tiptap/ProseMirror concepts selectively:

- Schema.
- Nodes.
- Marks.
- Transactions.
- Commands.
- Decorations.
- Markdown serialization.
- JSON serialization.
- Tables.
- Lists.
- Headings.
- Links.
- Code blocks.

Render the model through a TUIL terminal projection. Do not use a browser DOM view in the terminal.

## 10. Phase 4: streaming formats, rich terminal content, and transformations

### 10.1 Code

Create `@mwillbanks/tuil-code`:

- Tree-sitter parsing.
- Incremental highlighting.
- Language detection.
- Line numbers.
- Folding.
- Search matches.
- Diagnostics.
- Selection.
- Horizontal scrolling.
- Soft wrapping.
- Copyable code blocks.
- Theme-aware syntax styles.

Parsing must not block the render loop.

### 10.2 Extensible streaming parse and render pipeline

Create `@mwillbanks/tuil-streaming`. Markdown is the first adapter, not the package boundary.

Separate four concerns:

```text
byte/text chunks
  → framing and decoding
  → incremental format parser
  → normalized document/events
  → optional transformer pipeline
  → terminal/browser/static renderer
```

Define public extension contracts for:

- `StreamDecoder`.
- `FormatParser`.
- `PartialDocument`.
- `StreamEvent`.
- `DocumentTransformer`.
- `RenderProjection`.
- `StreamRenderer`.
- `ParserDiagnostic`.
- `BackpressureController`.

The contracts must support:

- Arbitrary chunk boundaries.
- Partial documents.
- Incremental parsing.
- Parser recovery.
- Syntax and semantic diagnostics.
- Cancellation.
- Backpressure.
- Bounded memory.
- Replayable events.
- Format detection.
- User-defined adapters.
- User-defined transformers.
- Multiple simultaneous projections.

### 10.3 Built-in format adapters

Start with adapters for:

- Markdown.
- JSON.
- JSON Lines.
- JSON-LD.
- XML.
- TOML.
- YAML.
- RFC 5424 syslog.
- RFC 3164 syslog.
- OpenTelemetry log records.
- Unified and split diffs.
- Plain text.

Adapters should preserve source spans and raw values where possible, allowing users to switch between rendered and raw views.

Markdown includes streaming blocks, tables, links, code fences, syntax-highlighted code, concealed markers, selectable content, custom block renderers, and incomplete-block recovery.

### 10.4 Transformer pipeline

Transformers must be composable and independently testable. Examples include:

- JSON-LD graph to table.
- JSON-LD graph to expandable tree.
- JSON-LD graph to relationship view.
- XML elements to table rows.
- XML attributes to key/value panels.
- TOML configuration to a settings table.
- JSON arrays to sortable tables.
- JSON objects to detail panels.
- Logs to grouped service views.
- Logs to severity timelines.
- Markdown headings to navigation outlines.
- Diff hunks to change summaries.
- Arbitrary records to user-defined projections.

Transformers may emit incremental output as the source becomes parseable. A transformer may request more context, report incomplete state, or downgrade to a raw fallback.

### 10.5 Render projections

Built-in projections should include:

- Raw text.
- Syntax-highlighted text.
- Markdown blocks.
- Expandable tree.
- Key/value detail.
- Table.
- Virtualized table.
- Timeline.
- Log rows.
- Graph/relationship list.
- Diff view.
- JSON path view.
- Custom user projection.

The same parsed stream should support multiple projections at once, such as raw content beside a table or log rows beside structured details.

### 10.6 Diff

Upgrade `diff-viewer` with:

- Unified mode.
- Split mode.
- Syntax highlighting.
- Line numbers.
- Hunk navigation.
- Inline selection.
- Search.
- Collapsed unchanged regions.
- Copy patch.
- Apply/reject hunk commands.

### 10.7 Structured content

Expand JSON and tree viewers with:

- Expand/collapse all.
- Path copying.
- Search.
- Type-aware formatting.
- Large-value virtualization.
- Structured selection.
- Custom renderers.
- Copy as JSON, path, or text.

## 11. Phase 5: logging and observability

### 11.1 Normalized log model

Create `@mwillbanks/tuil-logging` around an OpenTelemetry-compatible record:

```ts
interface LogRecord {
  timestamp?: bigint;
  observedTimestamp?: bigint;
  severityNumber?: number;
  severityText?: string;
  body: unknown;
  attributes: Record<string, unknown>;
  resource: Record<string, unknown>;
  scope?: { name?: string; version?: string };
  traceId?: string;
  spanId?: string;
  flags?: number;
  eventName?: string;
  source: "otel" | "syslog" | "jsonl" | "journald" | "text";
}
```

Preserve the original payload and parser diagnostics so malformed or partially understood records remain visible.

### 11.2 Input adapters

Support:

- OTLP/HTTP logs.
- OTLP JSON.
- OpenTelemetry JSON exports.
- JSONL.
- Bun process output.
- RFC 5424 syslog.
- RFC 3164 syslog.
- Journald export format.
- Docker/container logs.
- Kubernetes JSON logs.
- Common application log formats.
- Plain text fallback.
- Custom parser plugins.

### 11.3 Log pipeline

```text
source
  → parser
  → normalizer
  → enrichment
  → redaction
  → index
  → query/filter
  → viewport
  → renderer
```

Implement:

- Severity normalization.
- Timestamp normalization.
- Source labels.
- Service/resource grouping.
- Trace/span correlation.
- Attribute extraction.
- JSON expansion.
- Deduplication indicators.
- Rate-limit indicators.
- Sampling indicators.
- Ring-buffer retention.
- Backpressure.
- Live follow.
- Pause/resume.
- Historical replay.
- Export and copy.

### 11.4 Search and query

Support a typed query language:

```text
severity >= warn
service = api
resource.namespace = production
trace_id = abc123
body contains "timeout"
attributes.user_id = 42
timestamp > now-15m
```

Also support:

- Regex.
- Fuzzy search.
- Field filters.
- Severity filters.
- Time ranges.
- Source filters.
- Trace/span filters.
- Saved searches.
- Search history.
- Match highlighting.
- Incremental search.
- Query validation and explanation.

The log query editor should use the TUIL editor platform and optionally the built-in Vim search behavior.

### 11.5 Log components

Add:

- `LogViewer`.
- `LogRow`.
- `LogSearchBar`.
- `LogFilterBar`.
- `LogFacetPanel`.
- `LogDetail`.
- `LogTimeline`.
- `TraceContext`.
- `StructuredValue`.
- `LogSourceBadge`.
- `LiveIndicator`.
- `ParseErrorRow`.
- `LogExportDialog`.

All log views must use the shared scroll, virtualization, theme, editor, and devtools contracts.

### 11.6 Log theming

Add semantic tokens for:

- Trace.
- Debug.
- Info.
- Notice.
- Warn.
- Error.
- Fatal.
- Timestamp.
- Source.
- Service.
- Attribute.
- Trace ID.
- Selected row.
- Match highlight.
- Parse error.
- Live indicator.

Provide dense, comfortable, monochrome, high-contrast, and color-blind-safe defaults.

## 12. Phase 6: functional, pluggable devtools

The current devtools should evolve from inspection panels into an extensible runtime operations surface.

### 12.1 Devtools protocol

Create a versioned protocol for:

- Runtime snapshots.
- Event streams.
- Commands/actions.
- Panel registration.
- Query registration.
- State inspection.
- Trace recording.
- Frame recording.
- Export/import.

The protocol must work in-process first and support a future separate devtools process or browser client.

### 12.2 Devtools extension API

Plugins should be able to register:

- Panels.
- Inspectors.
- Commands.
- Queries.
- Event subscribers.
- Frame overlays.
- Semantic tree views.
- Focus views.
- Pointer-event monitors.
- Editor state inspectors.
- Log parser inspectors.
- Theme previews.
- Performance collectors.

Each contribution should declare:

- Stable ID.
- Title and icon.
- Required capabilities.
- Activation condition.
- Read/write permissions.
- Serialization format.
- Disposal behavior.

### 12.3 Required built-in panels

- Application lifecycle.
- Services.
- Commands and keymaps.
- Focus tree.
- Semantic tree.
- Layout and measured bounds.
- Pointer events and hit testing.
- Render frames.
- Dirty regions.
- Render timings.
- Scroll containers.
- Active operations.
- Workflow state.
- Routes and navigation history.
- Plugin graph.
- Theme tokens and computed styles.
- Editor buffer, mode, selection, and history.
- Log sources, parsers, queries, and dropped-record counts.
- Error and teardown reports.

### 12.4 Devtools actions

Provide safe runtime actions:

- Focus a component.
- Open a route.
- Execute a command.
- Toggle a theme.
- Pause/resume live rendering.
- Force a resize.
- Dump a frame.
- Dump semantics.
- Dump layout.
- Clear log buffers.
- Replay a log fixture.
- Reset an editor session.
- Inspect workflow snapshots.
- Enable verbose parser diagnostics.

Mutating actions must require explicit development mode and be visible in the action history.

### 12.5 Devtools usability

Add:

- Command palette.
- Search across panels.
- Keyboard navigation.
- Mouse navigation.
- Panel pinning.
- Panel layout persistence.
- Exportable diagnostics bundles.
- Shareable snapshots.
- Time-travel event replay.
- “Why is this focused?” explanations.
- “Why did this render?” explanations.
- “Why is this command active?” explanations.
- Performance warnings.
- Capability warnings.

## 13. Phase 7: component library expansion

Promote common primitives from the registry into shared, tested component families:

### Inputs and editing

- Text input.
- Text area.
- Password input.
- Number input.
- Date/time input where practical.
- Search input.
- Autocomplete.
- Command palette.
- Code editor.

### Navigation

- Tabs.
- Tab select.
- Menus.
- Menubar.
- Breadcrumbs.
- Tree.
- Outline.
- Pagination.
- Stepper.

### Data display

- Table.
- Data table.
- Virtual list.
- Scroll area.
- Log viewer.
- JSON viewer.
- Diff viewer.
- Markdown viewer.
- Code viewer.
- Timeline.
- Chart primitives.

### Feedback and overlays

- Dialog.
- Confirm dialog.
- Drawer.
- Popover.
- Tooltip.
- Toast.
- Alert.
- Progress.
- Spinner.
- Skeleton.
- Error boundary.

### Layout

- App shell.
- Split pane.
- Resizable pane.
- Pane tabs.
- Header.
- Footer.
- Status bar.
- Sidebar.
- Stack.
- Container.

Every component receives stories, semantic tests, keyboard tests, pointer tests, static snapshots, theme coverage, and docs.

## 14. Phase 8: registry and plugin ecosystem

The registry must support both source-owned and package-owned components.

Add:

- Component versions.
- Provenance comments.
- Upgrade diffs.
- Codemods.
- Integrity hashes.
- Registry lockfiles.
- Compatibility metadata.
- Deprecation metadata.
- Automated registry conformance.
- Package-owned opt-in components.
- Plugin-provided components.
- Plugin-provided editor commands.
- Plugin-provided log parsers.
- Plugin-provided themes.
- Plugin-provided format adapters and render projections.
- Plugin-provided devtools panels.

Registry-installed components must remain inspectable while still receiving upstream security and compatibility diagnostics.

## 15. Phase 9: documentation, stories, and support

Expand the documentation with:

- Renderer selection guide.
- Ink-to-cell migration guide.
- Editor backend selection guide.
- Vim mode guide.
- Rich document guide.
- Streaming formats and transformations guide.
- Markdown, code, and structured rendering guide.
- Log ingestion guide.
- OpenTelemetry guide.
- Syslog guide.
- Query language reference.
- Devtools extension guide.
- Registry upgrade guide.
- Plugin security guide.
- Terminal capability matrix.
- Performance tuning guide.
- Troubleshooting guide.

Every major feature must have:

- Interactive story.
- Static story.
- Snapshot.
- Test fixture.
- Documentation page.
- Example usage.
- Accessibility/semantics notes.
- Keyboard and pointer behavior documentation.

## 16. Production examples

Build complete applications rather than only isolated component demos:

1. TUIL Git client.
2. TUIL log explorer.
3. TUIL OpenTelemetry console.
4. TUIL AI coding assistant.
5. TUIL deployment dashboard.
6. TUIL file manager.
7. TUIL workflow runner.
8. TUIL terminal documentation browser.

The flagship application should be the observability console because it exercises:

- Streaming input.
- Virtualized scrolling.
- Search.
- Structured data.
- Mouse interaction.
- Keyboard navigation.
- Themes.
- Split panes.
- Detail overlays.
- Trace correlation.
- Long-running operations.
- Static export.
- Plugin parsers and streaming transformers.
- Devtools inspection.

## 17. Validation and release gates

### Editor gates

- Unicode grapheme tests pass.
- Transaction and history properties pass.
- 10,000-line buffers remain responsive.
- Vim commands are deterministic.
- Native editor state does not leak vendor-specific types into public APIs.
- Selection and clipboard behavior are tested across capabilities.
- Editor snapshots are stable across widths.

### Interaction gates

- Every pointer event has a semantic or coordinate test.
- Keyboard behavior remains complete without mouse support.
- Nested focus scopes and pointer capture are tested.
- Resize during editing, scrolling, and dragging is safe.
- Dragging cannot escape its owner unexpectedly.

### Logging gates

- RFC 5424 and RFC 3164 fixtures parse correctly.
- OTEL severity, trace, span, resource, and scope fields are preserved.
- Malformed records remain visible.
- Search is responsive with 100,000 records.
- Live mode does not silently drop records under backpressure.
- Redaction occurs before rendering and export.
- Logs can be filtered, copied, exported, and themed.

### Renderer gates

- Ink and cell backends pass the same behavior suite.
- Cell diffing has benchmark coverage.
- Frame timing and render counts are inspectable.
- Resize and shutdown restore terminal state.
- Native acceleration is optional.
- Pure Bun execution works without Node-specific assumptions.

### Devtools gates

- Built-in panels are pluggable implementations of the public extension API.
- Panels clean up correctly.
- Runtime actions are audited.
- Diagnostics bundles are reproducible.
- Devtools can inspect both renderer backends.
- Devtools can inspect editor, log, focus, layout, and plugin state.

### Repository gates

Continue using the repository-defined gates:

```npm
bun run format:check
bun run registry:check
bun run typecheck
bun run test
bun run build
bun run fallow
bun run fallow:health
bun run security
```

Add targeted gates for:

```npm
bun run test:renderer
bun run test:editors
bun run test:pointer
bun run test:logging
bun run test:devtools
bun run benchmark:terminal
```

## 18. Sequencing

Implement in this order:

1. Architecture RFCs and benchmark baseline.
2. Layout projection and terminal capability contracts.
3. Pointer, clipboard, and scroll foundations.
4. Bun-native TypeScript cell backend.
5. Renderer conformance suite.
6. TUIL editor platform and built-in buffer module.
7. Native Vim mode.
8. Streaming format adapters, transformers, and projections.
9. Code, Markdown, and diff rendering.
10. Logging model, parsers, indexing, and query language.
11. Virtualized LogViewer and observability showcase.
12. Functional, pluggable devtools.
13. Optional Zig/FFI cell acceleration.
14. Registry and plugin ecosystem expansion.
15. Production applications and release hardening.

This order creates value before native acceleration is complete, while preventing the application layer from becoming permanently coupled to Ink.

## 19. Definition of success

TUIL is a credible OpenTUI contender when:

- A Bun application can use the cell backend without Node or mandatory native installation.
- Ink and cell renderers behave equivalently for supported components.
- Mouse-driven interfaces feel natural.
- Text fields provide reliable editing and Vim users have a real path.
- Markdown, code, diffs, JSON, XML, JSON-LD, TOML, YAML, and logs are first-class streamable content.
- Users can add format adapters, transformers, and render projections without modifying TUIL core.
- A 100,000-row log stream remains searchable and usable.
- Devtools can explain application state and diagnose rendering problems.
- Plugins can add panels, parsers, commands, themes, renderers, and components.
- Registry components can be customized without losing upgrade visibility.
- Complete production examples demonstrate the platform.
- Performance, semantics, keyboard behavior, pointer behavior, and cleanup are all covered by executable tests.

The final product position should be:

> OpenTUI is a powerful terminal renderer. TUIL is the Bun-native platform for building complete, interactive, observable, maintainable terminal products.

## References

- [OpenTUI renderer](https://opentui.com/docs/core-concepts/renderer/)
- [OpenTUI renderables](https://opentui.com/docs/core-concepts/renderables/)
- [OpenTUI ScrollBox](https://opentui.com/docs/components/scrollbox/)
- [OpenTUI Markdown](https://opentui.com/docs/components/markdown/)
- [OpenTUI FrameBuffer](https://opentui.com/docs/components/frame-buffer/)
- [Lexical releases](https://github.com/facebook/lexical/releases)
- [Tiptap concepts](https://tiptap.dev/docs/editor/core-concepts/introduction)
- [Slate documentation](https://docs.slatejs.org/)
- [Puck API](https://puckeditor.com/docs/api-reference/components/puck)
- [CodeMirror repository status](https://github.com/codemirror/dev/releases)
