import { afterEach, expect, test } from "bun:test";
import { createApp, createTheme } from "@mwillbanks/tuil";
import { renderStatic } from "@mwillbanks/tuil-ink";
import { cleanup, renderTuil } from "@mwillbanks/tuil-testing-ink";
import { AppBar } from "../../../registry/components/app-bar.tsx";
import { AppShell } from "../../../registry/components/app-shell.tsx";
import { StatusBar } from "../../../registry/components/status-bar.tsx";
import { Badge } from "../../../registry/data-display/badge.tsx";
import { Divider } from "../../../registry/data-display/divider.tsx";
import { Heading } from "../../../registry/data-display/heading.tsx";
import { Text } from "../../../registry/data-display/text.tsx";
import { Alert } from "../../../registry/feedback/alert.tsx";
import { Progress } from "../../../registry/feedback/progress.tsx";
import { Spinner } from "../../../registry/feedback/spinner.tsx";
import { Box } from "../../../registry/primitives/box.tsx";
import { Container } from "../../../registry/primitives/container.tsx";
import { HStack, Stack, VStack } from "../../../registry/primitives/stack.tsx";
import { theme } from "../../../registry/themes/default.ts";

afterEach(cleanup);

test("installable primitives render every responsive and feedback variant", async () => {
  const content = (
    <AppShell id="shell">
      <AppShell.AppBar>
        <AppBar>
          <Heading>Registry</Heading>
          <Heading level={4} label="Nested heading">
            <Text>Nested</Text>
          </Heading>
        </AppBar>
      </AppShell.AppBar>
      <AppShell.Main>
        <Container>
          <Stack gap="sm">
            <HStack gap={1}>
              {(
                ["neutral", "success", "warning", "danger", "info"] as const
              ).map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </HStack>
            <VStack>
              <Divider />
              <Divider title="Section" width={12} />
              <Divider orientation="vertical" />
            </VStack>
            {(["info", "success", "warning", "danger"] as const).map((tone) => (
              <Alert key={tone} tone={tone} title={tone}>
                {tone} content
              </Alert>
            ))}
            <Alert unstyled />
            <Progress value={50} />
            <Progress value={1} max={0} showValue={false} width={2} />
            <Spinner label="Working" />
            <Text id="numeric-text">{42}</Text>
          </Stack>
        </Container>
        <Container maxWidth={20} width={10}>
          <Box padding="sm" margin={1}>
            <Text>Sized</Text>
          </Box>
        </Container>
      </AppShell.Main>
      <AppShell.StatusBar>
        <StatusBar>
          <Text>Ready</Text>
        </StatusBar>
      </AppShell.StatusBar>
    </AppShell>
  );
  const app = createApp({
    component: () => content,
    terminal: { mode: "static" },
  });
  const frame = await renderStatic(app);
  expect(frame).toContain("Registry");
  expect(frame).toContain("Working");
  expect(theme.id).toBe("tuil-default");

  const spinner = renderTuil(<Spinner label="Interactive" />, {
    theme: createTheme({
      id: "animated",
      motion: { enabled: true, interval: 1 },
    }),
    terminal: {
      capabilities: { colorDepth: 24, reducedMotion: false },
    },
  });
  await spinner.ready;
  await Bun.sleep(25);
  expect(
    spinner.screen.getByRole("status", { name: "Interactive" }),
  ).toBeDefined();
  await spinner.cleanup();
});
