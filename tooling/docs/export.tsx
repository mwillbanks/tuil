export type DocsExporter = () => Promise<void>;

/** Run one finite export. Imports remain safe in validation and orchestration. */
export async function runDocsExport(exporter?: DocsExporter): Promise<void> {
  const operation =
    exporter ?? (await import("../../apps/docs/src/build")).exportDocs;
  await operation();
}

if (import.meta.main) await runDocsExport();
