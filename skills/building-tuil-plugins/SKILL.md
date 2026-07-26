---
name: building-tuil-plugins
description: Create, register, validate, and test tuil plugins and extension points. Use for plugin lifecycle, capabilities, dependencies, services, commands, routes, themes, adapters, devtools panels, or plugin catalogs.
---

# Build tuil plugins

1. Define plugins with a stable id, version, explicit dependencies, and the minimum required capabilities.
2. Put all registration in `setup(context)` and return one disposer that releases owned resources in reverse order.
3. Register only through provided extension registries. Do not mutate application globals or assume denied capabilities are available.
4. Add discoverable plugins to `PluginRegistry`; validate the entire dependency graph before passing resolved plugins to `PluginManager`.
5. Treat setup as transactional. On failure, release partial resources and surface the original error.
6. Make command, event, route, workflow, component, theme, keybinding, adapter, and devtools registrations disposable.
7. Test dependency ordering, cycles, missing dependencies, capability denial, setup failure, reverse disposal, duplicate ids, and catalog filtering.
8. Keep plugins runtime-portable and exclude development-only dependencies from application production bundles.
