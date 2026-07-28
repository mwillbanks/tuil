import { Progress } from "@mwillbanks/tuil-ink";
import { useMemo } from "react";
import { Table } from "../../../registry/data-display/complex-data.tsx";
import {
  createProductionApplicationAdapter,
  ProductionApplicationShell,
  type ProductionRecordSource,
  runExampleApplication,
} from "../../_shared.tsx";

const deploymentSource: ProductionRecordSource = {
  async *stream(signal) {
    signal.throwIfAborted();
    const configured =
      typeof process === "undefined"
        ? undefined
        : process.env["TUIL_DEPLOYMENTS_JSON"];
    if (!configured) {
      yield [
        JSON.stringify({
          id: "local",
          service: "local",
          status: "unknown",
          region: "local",
        }),
      ];
      return;
    }
    const deployments = JSON.parse(configured) as readonly unknown[];
    yield deployments.map((deployment) => JSON.stringify(deployment));
  },
};

export function DeploymentDashboardApplication(
  props: { readonly source?: ProductionRecordSource } = {},
) {
  const source = props.source ?? deploymentSource;
  const adapter = useMemo(
    () => createProductionApplicationAdapter("deployment-dashboard", source),
    [source],
  );
  return (
    <ProductionApplicationShell kind="deployment-dashboard" adapter={adapter}>
      {({ revision, lines }) => {
        const deployments = lines.flatMap((line, index) => {
          try {
            const value = JSON.parse(line) as Record<string, unknown>;
            return [
              {
                id: String(value["id"] ?? index),
                service: String(value["service"] ?? "unknown"),
                status: String(value["status"] ?? "unknown"),
                region: String(value["region"] ?? "unknown"),
              },
            ];
          } catch {
            return [];
          }
        });
        return (
          <>
            <Progress
              label="Rollout"
              value={Math.min(3, revision + 2)}
              max={3}
            />
            <Table
              id="deployment-table"
              label="Deployments"
              rows={deployments}
              height={4}
              width={60}
              getRowKey={(row) => row.id}
              columns={[
                {
                  id: "service",
                  header: "Service",
                  accessor: (row) => row.service,
                },
                {
                  id: "status",
                  header: "Status",
                  accessor: (row) => row.status,
                },
                {
                  id: "region",
                  header: "Region",
                  accessor: (row) => row.region,
                },
              ]}
            />
          </>
        );
      }}
    </ProductionApplicationShell>
  );
}

if (import.meta.main)
  await runExampleApplication(
    "deployment-dashboard",
    DeploymentDashboardApplication,
  );
