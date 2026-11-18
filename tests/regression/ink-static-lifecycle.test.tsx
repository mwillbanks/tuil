import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createApp } from "@mwillbanks/tuil";
import { Text } from "ink";
import { createElement } from "react";
import { render } from "../../packages/ink/src/index.ts";

test("static Ink finishes the rendered frame and disposes without terminal input", async () => {
  const output = new PassThrough();
  let text = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    text += chunk;
  });
  const app = createApp({
    component: () => createElement(Text, null, "Redirected terminal output"),
    terminal: { mode: "static" },
  });
  const instance = await render(app, {
    stdout: output as unknown as NodeJS.WriteStream,
  });
  try {
    expect(app.lifecycle.state).toBe("ready");
    await instance.waitUntilExit();
    expect(app.lifecycle.state).toBe("disposed");
    expect(text.trim()).toBe("Redirected terminal output");
  } finally {
    await instance.unmount();
    output.destroy();
  }
});
