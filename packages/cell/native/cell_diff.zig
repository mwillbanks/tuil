const std = @import("std");

/// Optional acceleration boundary. The TypeScript implementation remains the
/// required fallback; this symbol is intentionally narrow and ABI-stable.
export fn count_changed_cells(
    previous: [*]const u64,
    current: [*]const u64,
    length: usize,
) usize {
    var changed: usize = 0;
    for (0..length) |index| {
        if (previous[index] != current[index]) changed += 1;
    }
    return changed;
}
