import { expect, test } from "bun:test";
import { BrowserWritableStream } from "../../packages/ghostty-web/src/streams.ts";

test("settles active and queued terminal writes exactly once on disposal", async () => {
  let acknowledge: (() => void) | undefined;
  const stream = new BrowserWritableStream(
    {
      write: (_data, done) => {
        acknowledge = done;
      },
    },
    80,
    24,
  );
  const errors: string[] = [];
  const record = (error?: Error | null) =>
    errors.push(error?.message ?? "success");
  stream.write("active", record);
  stream.write("queued", record);
  const idle = stream.whenIdle();
  stream.destroy();
  await idle;
  acknowledge?.();
  expect(errors).toEqual([
    "Browser terminal output was disposed",
    "Browser terminal output was disposed",
  ]);
});
