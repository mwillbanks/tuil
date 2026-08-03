import { createApp, type TuilRuntime } from "@mwillbanks/tuil";
import {
  Badge,
  Box,
  Button,
  Heading,
  Overlay,
  Progress,
  Text,
} from "@mwillbanks/tuil-ink";
import { type ReactNode, useState } from "react";
import { browserTerminalProbe } from "./browser-terminal";

function BrowserFeasibilitySurface(): ReactNode {
  const [overlay, setOverlay] = useState(false);
  const [progress, setProgress] = useState(0.65);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Heading>TUIL in Ghostty Web</Heading>
      <Text color="cyan">Ink 7 · true color · Unicode: 世界 👩🏽‍💻</Text>
      <Badge label="Browser status">WASM ready</Badge>
      <Progress label="Feasibility coverage" value={progress} max={1} />
      <Box gap={1}>
        <Button
          id="browser-progress"
          autoFocus
          onPress={() => setProgress((value) => (value >= 1 ? 0 : value + 0.1))}
        >
          Advance
        </Button>
        <Button id="browser-overlay" onPress={() => setOverlay(true)}>
          Open overlay
        </Button>
      </Box>
      <Text>01 Layout · 02 Input · 03 Pointer · 04 Scroll</Text>
      <Text>05 Resize · 06 Theme · 07 Events · 08 Semantics</Text>
      <Overlay
        id="browser-dialog"
        open={overlay}
        onDismiss={() => setOverlay(false)}
      >
        <Box borderStyle="double" flexDirection="column">
          <Text>Overlay focus is trapped.</Text>
          <Button
            id="browser-close"
            autoFocus
            onPress={() => setOverlay(false)}
          >
            Close
          </Button>
        </Box>
      </Overlay>
    </Box>
  );
}

export function createTuilGhosttyFeasibilityApp(): TuilRuntime {
  return createApp({
    id: "tuil-ghostty-feasibility",
    component: BrowserFeasibilitySurface,
    terminal: {
      ...browserTerminalProbe(80, 24),
      mode: "interactive",
      capabilities: {
        width: 80,
        height: 24,
        colorDepth: 24,
        unicode: true,
        hyperlinks: true,
        interactive: true,
        tty: true,
        alternateScreen: true,
        mouse: true,
        reducedMotion: false,
        platform: "linux",
      },
    },
  });
}
