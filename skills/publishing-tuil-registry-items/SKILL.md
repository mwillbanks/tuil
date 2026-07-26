---
name: publishing-tuil-registry-items
description: Create, validate, generate, and publish tuil registry items safely. Use for component manifests, registry dependencies, themes, plugins, blocks, generated source, local modification protection, registry indexes, or publication verification.
---

# Publish tuil registry items

1. Place source in the correct `registry/` tier and create a manifest with stable name, type, title, description, renderer, dependencies, semantics, capabilities, slots, provenance, and target files.
2. Declare every registry dependency explicitly and keep dependency graphs acyclic.
3. Generate registry JSON with `bun run registry:build`; never hand-edit generated inline file content.
4. Verify generated targets stay inside the consumer workspace and that installs preserve locally modified files unless the user explicitly forces replacement.
5. Add direct usage, portable stories, semantic tests, and dependency/source provenance when adapting upstream work.
6. Validate index listing, qualified source lookup, offline file sources, abort handling, dependency installation order, and update conflicts.
7. Run format, typecheck, tests, build, and publication smoke before release.
8. Include the registry item in the appropriate changeset and release notes.
