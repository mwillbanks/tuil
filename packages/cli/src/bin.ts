#!/usr/bin/env bun
import { main } from "./index.tsx";

try {
  await main();
} catch (error) {
  process.stderr.write(
    `tuil: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
