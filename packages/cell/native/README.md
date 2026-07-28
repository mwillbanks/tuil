# Optional cell diff accelerator

`cell_diff.zig` exports the narrow `count_changed_cells` C ABI used by
`loadNativeCellAccelerator`. Published packages include stripped Zig 0.15.2
prebuilds for macOS arm64/x64, Linux arm64/x64, and Windows x64. Their source,
toolchain version, and SHA-256 digests are recorded in
`prebuilds/manifest.json`.

The native boundary is an explicit conformance and profiling prototype. It
validates changed-cell counts but JavaScript still owns cell fingerprinting,
ANSI encoding, and dirty-region metadata, so it does not replace the complete
TypeScript diff workload. `CellRendererBackend` therefore selects the
TypeScript implementation unless an application explicitly supplies a loaded
prototype. This preserves a truthful performance default until profiling
justifies moving an entire hot path across FFI.

Build a local artifact with a Zig toolchain:

```sh
zig build-lib -dynamic -O ReleaseFast \
  -femit-bin=packages/cell/native/libtuil_cell.dylib \
  packages/cell/native/cell_diff.zig
```

Use `libtuil_cell.so` on Linux or `tuil_cell.dll` on Windows. Distribution
prebuilds belong under `packages/cell/prebuilds/<platform>-<architecture>/`
and are copied into the published package by the repository build. Update the
manifest whenever an artifact changes. Set `TUIL_CELL_NATIVE_LIBRARY` to test
an artifact at another path.

Conformance tests require the Zig count to match the TypeScript diff while
preserving byte-for-byte output.
