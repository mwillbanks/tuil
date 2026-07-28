import { Button, Progress } from "@mwillbanks/tuil-ink";
import { useMemo } from "react";
import { Timeline } from "../../../registry/data-display/rich-content.tsx";
import {
  createProductionApplicationAdapter,
  ProductionApplicationShell,
  type ProductionRecordSource,
  runExampleApplication,
} from "../../_shared.tsx";

const workflowSource: ProductionRecordSource = {
  async *stream(signal) {
    signal.throwIfAborted();
    const configured =
      typeof process === "undefined"
        ? undefined
        : process.env["TUIL_WORKFLOW_JSON"];
    if (!configured) {
      yield [];
      return;
    }
    const stages = JSON.parse(configured) as readonly {
      readonly id: string;
      readonly status: string;
    }[];
    yield stages.map((stage) => `${stage.id}:${stage.status}`);
  },
};

export function WorkflowRunnerApplication(
  props: { readonly source?: ProductionRecordSource } = {},
) {
  const source = props.source ?? workflowSource;
  const adapter = useMemo(
    () => createProductionApplicationAdapter("workflow-runner", source),
    [source],
  );
  return (
    <ProductionApplicationShell kind="workflow-runner" adapter={adapter}>
      {({ revision, lines, execute }) => (
        <>
          <Button
            id="workflow-run"
            disabled={!source.execute}
            onPress={() => execute("run")}
          >
            Run workflow
          </Button>
          <Progress
            label="Workflow progress"
            value={Math.min(3, revision + 2)}
            max={3}
          />
          <Timeline
            items={lines.map((line, index) => {
              const [title = line, description = "unknown"] = line.split(":");
              return {
                id: `${title}-${index}`,
                time: String(index + 1),
                title,
                description,
              };
            })}
          />
        </>
      )}
    </ProductionApplicationShell>
  );
}

if (import.meta.main)
  await runExampleApplication("workflow-runner", WorkflowRunnerApplication);
