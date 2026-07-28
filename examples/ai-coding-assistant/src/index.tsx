import { Box, Button, Text } from "@mwillbanks/tuil-ink";
import { useMemo, useState } from "react";
import { CodeViewer } from "../../../registry/data-display/rich-content.tsx";
import { TextArea } from "../../../registry/forms/controls.tsx";
import { SplitPane } from "../../../registry/layout/panes.tsx";
import {
  createProductionApplicationAdapter,
  ProductionApplicationShell,
  type ProductionRecordSource,
  runExampleApplication,
} from "../../_shared.tsx";

const assistantSource: ProductionRecordSource = {
  async *stream(signal) {
    signal.throwIfAborted();
    const configured =
      typeof process === "undefined"
        ? undefined
        : process.env["TUIL_ASSISTANT_PROVIDERS"];
    yield configured?.split(",").filter(Boolean) ?? [];
  },
};

export function AiCodingAssistantApplication(
  props: { readonly source?: ProductionRecordSource } = {},
) {
  const [prompt, setPrompt] = useState("Fix the streaming parser");
  const source = props.source ?? assistantSource;
  const adapter = useMemo(
    () => createProductionApplicationAdapter("ai-coding-assistant", source),
    [source],
  );
  return (
    <ProductionApplicationShell kind="ai-coding-assistant" adapter={adapter}>
      {({ lines, execute }) => (
        <SplitPane
          id="assistant-panes"
          panes={[
            {
              id: "prompt",
              content: (
                <Box flexDirection="column">
                  <TextArea
                    id="assistant-prompt"
                    label="Prompt"
                    value={prompt}
                    onValueChange={setPrompt}
                  />
                  <Button
                    id="assistant-submit"
                    disabled={!source.execute}
                    onPress={() => execute("submit", { prompt })}
                  >
                    Submit to provider
                  </Button>
                  <Text>Tool providers: {lines.join(" · ")}</Text>
                </Box>
              ),
            },
            {
              id: "code",
              content: (
                <CodeViewer
                  language="typescript"
                  source={`export const task = ${JSON.stringify(prompt)};`}
                />
              ),
            },
          ]}
        />
      )}
    </ProductionApplicationShell>
  );
}

if (import.meta.main)
  await runExampleApplication(
    "ai-coding-assistant",
    AiCodingAssistantApplication,
  );
