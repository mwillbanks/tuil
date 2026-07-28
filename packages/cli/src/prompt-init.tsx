import {
  createApp,
  createPlugin,
  type TuilExtensionPoints,
  type TuilRuntime,
} from "@mwillbanks/tuil";
import { render } from "@mwillbanks/tuil-ink";
import {
  type InitAnswers,
  InitWizard,
} from "./generated-ui/blocks/init-wizard.tsx";

export interface InitializerRenderResult {
  unmount(): void | Promise<void>;
}

export type InitializerRenderer = (
  app: TuilRuntime,
) => Promise<InitializerRenderResult>;

const initializerPlugin = createPlugin<
  Record<string, never>,
  TuilExtensionPoints
>({
  id: "tuil.initializer",
  version: "0.1.0",
  setup(context) {
    return context.registry.register({
      id: "tuil.initializer",
      title: "tuil project initializer",
    });
  },
});

export async function promptInitWithRenderer(
  name: string | undefined,
  renderer: InitializerRenderer,
): Promise<InitAnswers> {
  let complete: ((answers: InitAnswers) => void) | undefined;
  let cancel: ((reason: Error) => void) | undefined;
  const answer = new Promise<InitAnswers>((resolveAnswer, rejectAnswer) => {
    complete = resolveAnswer;
    cancel = rejectAnswer;
  });
  const app = createApp({
    component: () => (
      <InitWizard
        initialName={name ?? "my-tuil-app"}
        onComplete={(answers) => complete?.(answers)}
        onCancel={() => cancel?.(new Error("Initialization cancelled"))}
      />
    ),
    plugins: [initializerPlugin],
    errorHandler(error) {
      cancel?.(
        error instanceof Error
          ? error
          : new Error("Initialization failed", { cause: error }),
      );
    },
    terminal: { mode: "interactive" },
  });
  const instance = await renderer(app);
  try {
    return await answer;
  } finally {
    await instance.unmount();
  }
}

export function renderInitializerApp(
  app: TuilRuntime,
): Promise<InitializerRenderResult> {
  return render(app, { exitOnCtrlC: false });
}

export function promptInit(
  name: string | undefined,
  renderer: InitializerRenderer = renderInitializerApp,
): Promise<InitAnswers> {
  return promptInitWithRenderer(name, renderer);
}
