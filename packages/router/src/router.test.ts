import { expect, test } from "bun:test";
import { createRouter, defineRoutes, route } from "./index.ts";

test("router loads routes, guards navigation, restores history, and emits lifecycle events", async () => {
  const restored: string[] = [];
  const router = createRouter(
    defineRoutes({
      root: route({
        children: {
          home: route({ component: "home" }),
          project: route({
            parseParams(value) {
              const projectId = (value as { projectId?: unknown })?.projectId;
              if (typeof projectId !== "string") throw new Error("projectId");
              return { projectId };
            },
            loader: async ({ params }) => ({
              name: `Project ${params["projectId"]}`,
            }),
          }),
          denied: route({ beforeEnter: () => false }),
        },
      }),
    }),
    {
      captureFocus: () => ({ focusedId: "project-link" }),
      restoreFocus: (snapshot) => {
        if (snapshot.focusedId) restored.push(snapshot.focusedId);
      },
    },
  );
  const events: string[] = [];
  router.observe((event) => events.push(event.type));
  await router.navigate({ to: "root.home" });
  const project = await router.navigate({
    to: "root.project",
    params: { projectId: "tuil" },
  });
  expect(project.data).toEqual({ name: "Project tuil" });
  expect(router.state.history).toHaveLength(2);
  await router.back();
  expect(router.state.location?.route).toBe("root.home");
  expect(restored).toEqual(["project-link"]);
  await expect(router.navigate({ to: "root.denied" })).rejects.toThrow(
    "denied",
  );
  expect(events).toContain("route:load");
  expect(events).toContain("route:restore-focus");
  expect(events).toContain("route:error");
});

test("router replaces, truncates forward history, opens surfaces, and cancels loaders", async () => {
  const router = createRouter(
    defineRoutes({
      home: route({}),
      settings: route({}),
      details: route({}),
      slow: route({
        loader: ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      }),
    }),
  );
  await router.navigate({ to: "home" });
  await router.navigate({ to: "settings" });
  await router.navigate({ to: "details", replace: true });
  expect(router.state.history.map((entry) => entry.route)).toEqual([
    "home",
    "details",
  ]);
  await router.back();
  await router.navigate({ to: "settings" });
  expect(await router.forward()).toBeUndefined();
  const dialog = await router.open({
    route: "details",
    surface: "dialog",
  });
  expect(dialog.surface).toBe("dialog");

  const controller = new AbortController();
  const loading = router.navigate({ to: "slow", signal: controller.signal });
  controller.abort("external");
  await expect(loading).rejects.toBe("external");
  expect(router.state.location?.route).toBe("details");
});

test("router serializes history against pending loads and restores focus both ways", async () => {
  let release: (() => void) | undefined;
  let focusedId = "home-field";
  const restored: string[] = [];
  const router = createRouter(
    defineRoutes({
      home: route({}),
      settings: route({}),
      slow: route({
        loader: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      }),
    }),
    {
      captureFocus: () => ({ focusedId }),
      restoreFocus: (snapshot) => {
        if (snapshot.focusedId) restored.push(snapshot.focusedId);
      },
    },
  );
  await router.navigate({ to: "home" });
  focusedId = "home-field";
  await router.navigate({ to: "settings" });
  focusedId = "settings-field";
  await router.back();
  expect(restored).toEqual(["home-field"]);
  await router.forward();
  expect(restored).toEqual(["home-field", "settings-field"]);

  const pending = router.navigate({ to: "slow" });
  await Bun.sleep(1);
  const restoredHome = await router.back();
  expect(restoredHome?.route).toBe("home");
  release?.();
  await expect(pending).rejects.toThrow("Superseded");
  expect(router.state.location?.route).toBe("home");
});

test("router clears pending navigation when history traversal has no target", async () => {
  const router = createRouter(
    defineRoutes({
      slow: route({
        loader: ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      }),
    }),
  );
  const loading = router.navigate({ to: "slow" });
  await Bun.sleep(1);
  expect(router.state.pending?.to).toBe("slow");
  expect(await router.back()).toBeUndefined();
  expect(router.state.pending).toBeUndefined();
  await expect(loading).rejects.toThrow("Superseded");
});

test("router commits leave events only after success and guards exits and history", async () => {
  const events: string[] = [];
  let parseErrors = 0;
  let allowLeave = false;
  let allowProtected = true;
  const router = createRouter(
    defineRoutes({
      home: route({
        beforeLeave: () => allowLeave,
      }),
      protected: route({
        beforeEnter: () => allowProtected,
      }),
      failed: route({
        loader: () => {
          throw new Error("load failed");
        },
      }),
      parsed: route({
        parseParams: (): Readonly<Record<never, never>> => {
          throw new Error("bad params");
        },
        onError: () => {
          parseErrors += 1;
        },
      }),
    }),
  );
  router.observe((event) => events.push(event.type));
  await router.navigate({ to: "home" });
  events.length = 0;
  await expect(router.navigate({ to: "failed" })).rejects.toThrow("denied");
  expect(events).not.toContain("route:leave");
  allowLeave = true;
  await expect(router.navigate({ to: "failed" })).rejects.toThrow(
    "load failed",
  );
  expect(events).not.toContain("route:leave");
  await expect(router.navigate({ to: "parsed" })).rejects.toThrow("bad params");
  expect(parseErrors).toBe(1);
  expect(events).not.toContain("route:leave");
  await router.navigate({ to: "protected" });
  await router.back();
  allowProtected = false;
  await expect(router.forward()).rejects.toThrow("denied");
  expect(router.state.location?.route).toBe("home");
});

test("router route names and parsed parameters are compile-time typed", () => {
  const router = createRouter(
    defineRoutes({
      home: route({}),
      project: route({
        parseParams: (value) => {
          const projectId = (value as { projectId?: unknown }).projectId;
          if (typeof projectId !== "string") throw new Error("projectId");
          return { projectId };
        },
      }),
    }),
  );
  const assertRouteTypes = () => {
    void router.navigate({ to: "home" });
    void router.navigate({ to: "project", params: { projectId: "tuil" } });
    void router.open({
      route: "project",
      params: { projectId: "tuil" },
      surface: "dialog",
    });
    // @ts-expect-error unknown route names are rejected
    void router.navigate({ to: "missing" });
    // @ts-expect-error parsed route parameters are required
    void router.navigate({ to: "project" });
    // @ts-expect-error parsed route parameters retain their shape
    void router.navigate({ to: "project", params: { slug: "tuil" } });
    // @ts-expect-error open surfaces preserve required parsed parameters
    void router.open({ route: "project", surface: "dialog" });
  };
  expect(typeof assertRouteTypes).toBe("function");
  expect(router.routes).toEqual(["home", "project"]);
});

test("nested routes require ancestor params and report boundary-local context", async () => {
  const boundaryParams: Readonly<Record<string, unknown>>[] = [];
  const router = createRouter(
    defineRoutes({
      tenant: route({
        parseParams: (value) => {
          const tenantId = (value as { tenantId?: unknown }).tenantId;
          if (typeof tenantId !== "string") throw new Error("tenantId");
          return { tenantId };
        },
        onError: (_error, context) => {
          boundaryParams.push(context.params);
        },
        children: {
          project: route({
            parseParams: (value) => {
              const projectId = (value as { projectId?: unknown }).projectId;
              if (typeof projectId !== "string") throw new Error("projectId");
              return { projectId };
            },
            loader: () => {
              throw new Error("project failed");
            },
          }),
        },
      }),
    }),
  );
  const assertNestedRouteTypes = () => {
    void router.navigate({
      to: "tenant.project",
      params: { tenantId: "tenant", projectId: "project" },
    });
    void router.navigate({
      to: "tenant.project",
      // @ts-expect-error nested navigation requires ancestor parameters
      params: { projectId: "project" },
    });
    void router.open({
      route: "tenant.project",
      // @ts-expect-error nested navigation requires leaf parameters
      params: { tenantId: "tenant" },
      surface: "dialog",
    });
  };
  expect(typeof assertNestedRouteTypes).toBe("function");
  await expect(
    router.navigate({
      to: "tenant.project",
      params: { tenantId: "tenant", projectId: "project" },
    }),
  ).rejects.toThrow("project failed");
  expect(boundaryParams).toEqual([{ tenantId: "tenant" }]);
});

test("history focus restoration rolls back when cancellation wins", async () => {
  let focusedId = "home-field";
  let restoreStarted: () => void = () => undefined;
  let releaseRestore: () => void = () => undefined;
  const restoreReady = new Promise<void>((resolve) => {
    restoreStarted = resolve;
  });
  const restoreGate = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  const events: string[] = [];
  const router = createRouter(
    defineRoutes({
      home: route({}),
      settings: route({}),
    }),
    {
      captureFocus: () => ({ focusedId }),
      restoreFocus: async (_snapshot, signal) => {
        restoreStarted();
        await restoreGate;
        signal.throwIfAborted();
      },
    },
  );
  router.observe((event) => events.push(event.type));
  await router.navigate({ to: "home" });
  focusedId = "home-field";
  await router.navigate({ to: "settings" });
  focusedId = "settings-field";
  events.length = 0;
  const controller = new AbortController();
  const restoring = router.back(controller.signal);
  await restoreReady;
  controller.abort(new DOMException("Focus cancelled", "AbortError"));
  releaseRestore();
  await expect(restoring).rejects.toThrow("Focus cancelled");
  expect(router.state.location?.route).toBe("settings");
  expect(router.state.index).toBe(1);
  expect(events).not.toContain("route:restore-focus");
  expect(events).not.toContain("route:leave");
  expect(events).not.toContain("route:ready");
});

test("router composes nested layouts, loaders, guards, and error boundaries", async () => {
  const lifecycle: string[] = [];
  const boundaryErrors: string[] = [];
  const router = createRouter(
    defineRoutes({
      root: route({
        component: "Root layout",
        beforeEnter: () => {
          lifecycle.push("root:enter");
          return true;
        },
        beforeLeave: () => {
          lifecycle.push("root:leave");
          return true;
        },
        loader: () => {
          lifecycle.push("root:load");
          return { root: true };
        },
        onError: (error) => {
          boundaryErrors.push(String(error));
        },
        children: {
          child: route({
            component: "Child screen",
            beforeEnter: () => {
              lifecycle.push("child:enter");
              return true;
            },
            loader: () => {
              lifecycle.push("child:load");
              return { child: true };
            },
          }),
          broken: route({
            loader: () => {
              throw new Error("nested failure");
            },
          }),
        },
      }),
      other: route({ component: "Other screen" }),
    }),
  );
  const entry = await router.navigate({ to: "root.child" });
  expect(lifecycle).toEqual([
    "root:enter",
    "child:enter",
    "root:load",
    "child:load",
  ]);
  expect(entry.matches.map((match) => match.component)).toEqual([
    "Root layout",
    "Child screen",
  ]);
  expect(entry.matches.map((match) => match.data)).toEqual([
    { root: true },
    { child: true },
  ]);
  expect(entry.data).toEqual({ child: true });
  await router.navigate({ to: "other" });
  expect(lifecycle).toContain("root:leave");
  await expect(router.navigate({ to: "root.broken" })).rejects.toThrow(
    "nested failure",
  );
  expect(boundaryErrors).toEqual(["Error: nested failure"]);
});

test("router observer failures are isolated", async () => {
  const errors: unknown[] = [];
  const router = createRouter(defineRoutes({ home: route({}) }), {
    onObserverError: (error) => errors.push(error),
  });
  router.observe(() => {
    throw new Error("observer failed");
  });
  await router.navigate({ to: "home" });
  expect(router.state.location?.route).toBe("home");
  expect(errors.length).toBeGreaterThan(0);
});
