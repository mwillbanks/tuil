#!/usr/bin/env bun
import { main } from "./index.tsx";

export async function runCli(argv = process.argv.slice(2)): Promise<0 | 1> {
  try {
    await main(argv);
    return 0;
  } catch (error) {
    process.stderr.write(
      `tuil: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

const cliExitCode = import.meta.main ? await runCli() : undefined;
process.exitCode = cliExitCode ?? process.exitCode;
