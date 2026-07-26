const surface = process.argv[2];
const showcaseRoot = new URL("..", import.meta.url).pathname;
const commands: Readonly<
  Record<
    string,
    {
      readonly cwd: string;
      readonly command: readonly string[];
    }
  >
> = {
  storybook: {
    cwd: showcaseRoot,
    command: ["storybook", "dev", "--no-open", "--port", "6006"],
  },
  docs: {
    cwd: new URL("../../docs", import.meta.url).pathname,
    command: ["next", "dev"],
  },
};
const selected = surface ? commands[surface] : undefined;
if (!selected) {
  throw new Error("Expected development surface: storybook or docs");
}

const bridge = Bun.spawn(["bun", "story-server.ts"], {
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, FORCE_COLOR: "3" },
});

let ready = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (bridge.exitCode !== null) {
    throw new Error("Story bridge exited before becoming ready");
  }
  try {
    const response = await fetch("http://127.0.0.1:4317/health");
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    await Bun.sleep(25);
  }
}
if (!ready) {
  bridge.kill();
  throw new Error("Story bridge did not become ready");
}

const application = Bun.spawn([...selected.command], {
  cwd: selected.cwd,
  stdout: "inherit",
  stderr: "inherit",
});
const stop = () => {
  application.kill();
  bridge.kill();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const exitCode = await application.exited;
bridge.kill();
await bridge.exited;
process.exitCode = exitCode;
