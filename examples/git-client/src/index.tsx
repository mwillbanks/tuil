import { useEffect, useMemo, useState } from "react";
import { RichDiffViewer } from "../../../registry/data-display/rich-content.tsx";
import { Tree } from "../../../registry/data-display/tree.tsx";
import { SplitPane } from "../../../registry/layout/panes.tsx";
import {
  createProductionApplicationAdapter,
  ProductionApplicationShell,
  type ProductionRecordSource,
  runExampleApplication,
} from "../../_shared.tsx";

function GitDiff(props: {
  readonly path?: string;
  readonly read: (path: string) => Promise<string>;
}) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    if (!props.path) {
      setSource("");
      return;
    }
    void props.read(props.path).then((value) => {
      if (active) setSource(value);
    });
    return () => {
      active = false;
    };
  }, [props.path, props.read]);
  return <RichDiffViewer source={source || "No selected change"} />;
}

async function git(...arguments_: readonly string[]): Promise<string> {
  if (typeof Bun === "undefined") return "";
  const process = Bun.spawn(["git", ...arguments_], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(error.trim() || "Git operation failed");
  return output.trim();
}

type GitRunner = (...arguments_: readonly string[]) => Promise<string>;

export function createGitRepositorySource(
  runGit: GitRunner = git,
): ProductionRecordSource {
  return {
    async *stream(signal) {
      if (typeof Bun === "undefined") {
        yield [
          JSON.stringify({ kind: "branch", name: "main", current: true }),
          JSON.stringify({ kind: "change", path: "packages/example.ts" }),
        ];
        return;
      }
      const [branches, status] = await Promise.all([
        runGit("branch", "--format=%(HEAD)|%(refname:short)"),
        runGit("status", "--short"),
      ]);
      signal.throwIfAborted();
      yield branches
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [marker, name] = line.split("|");
          return JSON.stringify({
            kind: "branch",
            name,
            current: marker === "*",
          });
        });
      signal.throwIfAborted();
      yield status
        .split("\n")
        .filter(Boolean)
        .map((line) =>
          JSON.stringify({
            kind: "change",
            status: line.slice(0, 2),
            path: line.slice(3),
          }),
        );
    },
    read: (path) => runGit("diff", "--", path),
    async execute(action, input) {
      if (action === "stage") await runGit("add", "--", String(input));
      else if (action === "unstage")
        await runGit("restore", "--staged", "--", String(input));
      else if (action === "checkout") await runGit("switch", String(input));
      else throw new Error(`Unsupported Git action "${action}"`);
    },
  };
}

const repositorySource = createGitRepositorySource();

export function GitClientApplication(
  props: { readonly source?: ProductionRecordSource } = {},
) {
  const source = props.source ?? repositorySource;
  const adapter = useMemo(
    () => createProductionApplicationAdapter("git-client", source),
    [source],
  );
  return (
    <ProductionApplicationShell kind="git-client" adapter={adapter}>
      {({ lines, read }) => {
        const records = lines.flatMap((line) => {
          try {
            return [JSON.parse(line) as Record<string, unknown>];
          } catch {
            return [];
          }
        });
        const branches = records.filter(
          (record) => record["kind"] === "branch",
        );
        const changes = records.filter((record) => record["kind"] === "change");
        return (
          <SplitPane
            id="git-panes"
            panes={[
              {
                id: "branches",
                content: (
                  <Tree
                    label="Repository branches"
                    items={branches.map((record, index) => ({
                      id: `branch-${index}`,
                      label: `${record["current"] ? "* " : "  "}${String(record["name"])}`,
                    }))}
                  />
                ),
              },
              {
                id: "changes",
                content: (
                  <GitDiff
                    path={
                      changes[0]?.["path"]
                        ? String(changes[0]?.["path"])
                        : undefined
                    }
                    read={read}
                  />
                ),
              },
            ]}
          />
        );
      }}
    </ProductionApplicationShell>
  );
}

if (import.meta.main)
  await runExampleApplication("git-client", GitClientApplication);
