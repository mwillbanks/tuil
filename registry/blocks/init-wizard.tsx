import {
  Alert,
  AppBar,
  AppShell,
  Heading,
  Stack,
  StatusBar,
  Text,
} from "@mwillbanks/tuil-ink";
import { defineOperation } from "@mwillbanks/tuil-operations";
import { createRouter, defineRoutes, route } from "@mwillbanks/tuil-router";
import {
  createWorkflow,
  defineOperationStep,
  defineStep,
  defineWorkflow,
  transition,
} from "@mwillbanks/tuil-workflow";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "../components/button.tsx";
import { Dialog } from "../feedback/overlays.tsx";
import {
  Field,
  Form,
  MultiSelect,
  Select,
  TextInput,
} from "../forms/controls.tsx";
import { Workflow } from "../workflows/workflow.tsx";

export const templates = [
  "minimal",
  "application",
  "dashboard",
  "wizard",
  "command-center",
  "plugin",
  "component-library",
] as const;

export type Template = (typeof templates)[number];

export const features = ["router", "forms", "workflow"] as const;

export type Feature = (typeof features)[number];

export interface InitAnswers {
  readonly name: string;
  readonly template: Template;
  readonly features: readonly Feature[];
}

export interface InitWizardProps {
  readonly initialName: string;
  readonly onComplete: (answers: InitAnswers) => void;
  readonly onCancel: () => void;
}

export function InitWizard(props: InitWizardProps): ReactNode {
  const [name, setName] = useState(props.initialName);
  const [template, setTemplate] = useState<Template>("application");
  const [selectedFeatures, setSelectedFeatures] = useState<readonly Feature[]>(
    [],
  );
  const [error, setError] = useState<unknown>();
  const router = useMemo(
    () =>
      createRouter(
        defineRoutes({
          name: route({ component: "Project name" }),
          template: route({ component: "Template" }),
          features: route({ component: "Features" }),
          confirm: route({ component: "Confirmation" }),
        }),
      ),
    [],
  );
  const workflow = useMemo(() => {
    const validateSelection = defineOperation({
      id: "init.validate-selection",
      title: "Validate project selection",
      async run({ signal, updateProgress }) {
        signal.throwIfAborted();
        updateProgress({
          current: 0,
          total: 1,
          message: "Checking configuration",
        });
        await Promise.resolve();
        signal.throwIfAborted();
        updateProgress({ current: 1, total: 1, message: "Ready" });
        return { valid: true };
      },
    });
    return createWorkflow(
      defineWorkflow({
        id: "tuil.init",
        version: 1,
        initialState: {},
        steps: {
          name: defineStep({ title: "Name", component: "Name the project" }),
          template: defineStep({
            title: "Template",
            component: "Choose an application template",
          }),
          features: defineStep({
            title: "Features",
            component: "Choose optional framework features",
          }),
          confirm: defineOperationStep({
            title: "Confirm",
            operations: [validateSelection],
          }),
        },
        transitions: [
          transition("name", "template"),
          transition("template", "features"),
          transition("features", "confirm"),
        ],
      }),
    );
  }, []);
  const workflowSnapshot = useSyncExternalStore(
    (notify) => workflow.subscribe(notify),
    () => workflow.snapshot,
    () => workflow.snapshot,
  );
  const routerState = useSyncExternalStore(
    (notify) => router.subscribe(notify),
    () => router.state,
    () => router.state,
  );
  const stage = workflowSnapshot.currentStep ?? "name";
  const run = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (cause) {
      setError(cause);
    }
  };
  const advance = async (destination: "template" | "features" | "confirm") => {
    if (workflow.snapshot.status === "idle") await workflow.start();
    if (!(await workflow.next())) return;
    await router.navigate({
      to: destination,
      surface: destination === "confirm" ? "dialog" : "screen",
    });
  };
  const complete = async () => {
    if (!(await workflow.next())) return;
    props.onComplete({
      name: name.trim(),
      template,
      features: selectedFeatures,
    });
  };
  const revise = async () => {
    if (!(await workflow.back())) return;
    await router.navigate({ to: "features" });
  };
  useEffect(() => {
    void (async () => {
      await workflow.start();
      await router.navigate({ to: "name" });
    })().catch(setError);
    return () => {
      workflow.dispose();
      router.dispose();
    };
  }, [router, workflow]);
  const visibleError = error ?? routerState.error ?? workflowSnapshot.errors[0];
  return (
    <AppShell>
      <AppShell.AppBar>
        <AppBar>
          <Heading>tuil init</Heading>
        </AppBar>
      </AppShell.AppBar>
      <AppShell.Main>
        <Workflow workflow={workflow} autoStart={false}>
          <Form
            id="init-form"
            onSubmit={async () => {
              if (stage === "name" && name.trim()) {
                await advance("template");
              }
            }}
          >
            <Stack gap="sm">
              <Workflow.Stepper />
              <Text>{`Route: ${routerState.location?.route ?? "starting"}`}</Text>
              {stage === "name" ? (
                <Field label="Project name" required>
                  <TextInput
                    id="init-project-name"
                    label="Project name"
                    value={name}
                    onValueChange={setName}
                    validators={{
                      submit: (value) =>
                        value.trim() ? undefined : "Project name is required",
                    }}
                    onSubmit={() => run(advance("template"))}
                    autoFocus
                  />
                </Field>
              ) : null}
              {stage === "template" ? (
                <Field label="Application template">
                  <Select
                    id="init-template"
                    label="Application template"
                    options={templates.map((value) => ({
                      value,
                      label: value,
                    }))}
                    value={template}
                    onValueChange={async (value) => {
                      setTemplate(value);
                      await advance("features");
                    }}
                    autoFocus
                  />
                </Field>
              ) : null}
              {stage === "features" ? (
                <>
                  <Field label="Optional features">
                    <MultiSelect
                      id="init-features"
                      label="Optional features"
                      options={features.map((value) => ({
                        value,
                        label: value,
                      }))}
                      value={selectedFeatures}
                      onValueChange={setSelectedFeatures}
                      autoFocus
                    />
                  </Field>
                  <Button
                    id="review-project"
                    hotkeys={["ctrl+enter"]}
                    onPress={() => run(advance("confirm"))}
                  >
                    Review project
                  </Button>
                </>
              ) : null}
              <Workflow.Operations showAttempts showDuration />
              {visibleError ? (
                <Alert tone="danger" title="Initialization failed">
                  {String(visibleError)}
                </Alert>
              ) : null}
              <Dialog
                id="init-confirmation"
                open={stage === "confirm"}
                onOpenChange={(open) => {
                  if (!open && workflow.snapshot.status !== "completed") {
                    return revise();
                  }
                }}
              >
                <Dialog.Content label="Create this project?">
                  <Dialog.Title>Create this project?</Dialog.Title>
                  <Dialog.Description>
                    {`${name.trim()} · ${template} · ${
                      selectedFeatures.join(", ") || "foundation"
                    }`}
                  </Dialog.Description>
                  <Dialog.Actions>
                    <Dialog.Cancel>Revise selections</Dialog.Cancel>
                    <Dialog.Confirm onPress={() => run(complete())}>
                      Create project
                    </Dialog.Confirm>
                  </Dialog.Actions>
                </Dialog.Content>
              </Dialog>
              <Button
                id="cancel-init"
                variant="danger"
                hotkeys={["ctrl+c"]}
                onPress={() =>
                  run(
                    (async () => {
                      await workflow.cancel();
                      props.onCancel();
                    })(),
                  )
                }
              >
                Cancel
              </Button>
            </Stack>
          </Form>
        </Workflow>
      </AppShell.Main>
      <AppShell.StatusBar>
        <StatusBar>
          <Text>Tab navigate · Enter select · Ctrl+C cancel</Text>
        </StatusBar>
      </AppShell.StatusBar>
    </AppShell>
  );
}
