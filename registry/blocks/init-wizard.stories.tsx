import { defineTuilStories } from "@mwillbanks/tuil-testing";
import type { ReactNode } from "react";
import { InitWizard } from "./init-wizard.tsx";
import { initWizardStoryVariants } from "./init-wizard-story-data.ts";

function DocumentedInitWizard(props: {
  readonly initialName: string;
}): ReactNode {
  return (
    <InitWizard
      initialName={props.initialName}
      onComplete={() => undefined}
      onCancel={() => undefined}
    />
  );
}

export const initWizardStories = defineTuilStories({
  component: DocumentedInitWizard,
  stories: initWizardStoryVariants,
});
