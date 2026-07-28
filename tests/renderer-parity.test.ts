import { expect, test } from "bun:test";
import { CellRendererBackend } from "@mwillbanks/tuil-cell";
import { InkRendererBackend } from "@mwillbanks/tuil-ink";
import {
  createRendererComponentRuntime,
  LayoutProjection,
  type RendererBackend,
  type RendererContext,
  type RendererScene,
} from "@mwillbanks/tuil-renderer";

const context: RendererContext = {
  capabilities: {
    width: 24,
    height: 4,
    colorDepth: 24,
    unicode: true,
    hyperlinks: true,
    interactive: true,
    tty: true,
    alternateScreen: true,
    mouse: true,
    images: false,
    reducedMotion: false,
    platform: "linux",
  },
  mode: "interactive",
  layout: new LayoutProjection(),
  signal: new AbortController().signal,
};

const application = createRendererComponentRuntime({
  initialState: { count: 0, width: 24, overlay: false },
  component: ({ state, renderer }) => {
    renderer.layout.reconcile([
      {
        id: "increment",
        bounds: { x: 0, y: 0, width: 16, height: 1 },
        clip: { x: 0, y: 0, width: state.width, height: 4 },
        zIndex: 0,
        focusable: true,
        pointerEvents: "auto",
        semantics: {
          id: "increment",
          role: "button",
          label: `Count ${state.count}`,
        },
      },
    ]);
    return {
      lines: [
        `Count: ${state.count}`,
        `${state.width} columns`,
        state.overlay ? "Overlay open" : "Overlay closed",
      ],
      styledLines: [
        [
          {
            text: `Count: ${state.count}`,
            style: { foreground: "bright-green", bold: true },
          },
        ],
        [{ text: `${state.width} columns` }],
        [{ text: state.overlay ? "Overlay open" : "Overlay closed" }],
      ],
      semantics: [
        {
          id: "increment",
          role: "button",
          label: `Count ${state.count}`,
        },
      ],
      cursor: { x: 0, y: 1, visible: true },
    };
  },
  input: (state, input) =>
    input === "+"
      ? { ...state, count: state.count + 1 }
      : input === "o"
        ? { ...state, overlay: !state.overlay }
        : undefined,
  resize: (state, width) => ({ ...state, width }),
});

async function renderScene(
  backend: RendererBackend<RendererScene>,
): Promise<{ readonly lines: readonly string[]; readonly semantics: unknown }> {
  const scene = await application.project(context);
  const frame = await backend.render(scene, context);
  if (backend.id === "ink") {
    const payload = frame.payload as {
      readonly frame: string;
      readonly semantics: unknown;
    };
    return { lines: payload.frame.split("\n"), semantics: payload.semantics };
  }
  return {
    lines: Array.from({ length: frame.height }, (_value, y) => {
      const payload = frame.payload as {
        readonly width: number;
        readonly cells: readonly {
          readonly grapheme: string;
          readonly continuation?: boolean;
        }[];
      };
      return payload.cells
        .slice(y * payload.width, (y + 1) * payload.width)
        .filter((cell) => !cell.continuation)
        .map((cell) => cell.grapheme)
        .join("")
        .trimEnd();
    }).filter((line) => line.length > 0),
    semantics: (frame.payload as { readonly semantics?: unknown }).semantics,
  };
}

test("Ink and cell backends share renderer-neutral state, input, resize, layout, semantics, overlays, and output", async () => {
  await application.input?.("+");
  await application.input?.("o");
  await application.resize?.(20, 4);
  const ink = await renderScene(new InkRendererBackend());
  const cell = await renderScene(new CellRendererBackend());
  expect(cell).toEqual(ink);
  expect(cell.lines).toEqual(["Count: 1", "20 columns", "Overlay open"]);
  expect(context.layout.get("increment")).toEqual(
    expect.objectContaining({
      focusable: true,
      pointerEvents: "auto",
      bounds: { x: 0, y: 0, width: 16, height: 1 },
    }),
  );
});
