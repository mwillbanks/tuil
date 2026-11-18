import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TuilGhosttyInstance } from "@mwillbanks/tuil-ghostty-web";

const inputKeys: Readonly<Record<string, string>> = {
  Enter: "\r",
  Tab: "\t",
  Escape: "\u001b",
  ArrowUp: "\u001b[A",
  ArrowDown: "\u001b[B",
  ArrowRight: "\u001b[C",
  ArrowLeft: "\u001b[D",
};

export function GhosttyStoryFrame(props: {
  readonly storyId: string;
  readonly variant: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly controls: Readonly<Record<string, unknown>>;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<TuilGhosttyInstance | undefined>(undefined);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const [result, setResult] = useState<{ mountKey: string; status: string }>();
  const [input, setInput] = useState("");
  const serializedArgs = JSON.stringify(props.args);
  const serializedControls = JSON.stringify(props.controls);
  const storyId = props.storyId;
  const variant = props.variant;
  const mountKey = JSON.stringify([
    storyId,
    variant,
    serializedArgs,
    serializedControls,
  ]);

  useEffect(() => {
    let active = true;
    let mounted: TuilGhosttyInstance | undefined;
    pending.current = (pending.current ?? Promise.resolve())
      .then(async () => {
        if (!active || !host.current) return;
        const adapter = await import("@mwillbanks/tuil-ghostty-web");
        if (!active || !host.current) return;
        const controls = JSON.parse(serializedControls) as Readonly<
          Record<string, unknown>
        >;
        const app = adapter.createTuilGhosttyStoryApp({
          storyId,
          variant,
          args: JSON.parse(serializedArgs) as Readonly<Record<string, unknown>>,
          controls,
        });
        mounted = await adapter.mountTuilGhostty({
          app,
          element: host.current,
          terminal: {
            cols:
              typeof controls["width"] === "number" ? controls["width"] : 80,
            rows:
              typeof controls["height"] === "number" ? controls["height"] : 24,
          },
          accessibility: {
            label: storyId + " " + variant + " TUIL demonstration",
          },
        });
        if (!active) {
          await mounted.unmount();
          mounted = undefined;
          return;
        }
        instance.current = mounted;
        setResult({
          mountKey,
          status: controls["interactive"]
            ? "Interactive terminal ready."
            : "Static terminal ready.",
        });
      })
      .catch((cause: unknown) => {
        if (active) {
          setResult({
            mountKey,
            status:
              "Terminal failed: " +
              (cause instanceof Error ? cause.message : String(cause)),
          });
        }
      });
    return () => {
      active = false;
      instance.current = undefined;
      pending.current = (pending.current ?? Promise.resolve())
        .then(async () => {
          await mounted?.unmount();
          mounted = undefined;
        })
        .catch(() => undefined);
    };
  }, [mountKey, serializedArgs, serializedControls, storyId, variant]);

  const send = (value: string) => {
    instance.current?.terminal.input(value, true);
    instance.current?.focus();
  };

  return (
    <section>
      <div
        ref={host}
        className="ghostty-terminal"
        style={{ width: "100%", minHeight: 384 }}
      />
      <p role="status" aria-live="polite">
        {result?.mountKey === mountKey
          ? result.status
          : "Loading browser terminal…"}
      </p>
      {props.controls["interactive"] ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
            setInput("");
          }}
        >
          <label>
            Terminal input
            <input
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
            />
          </label>
          <button type="submit">Send input</button>
          {Object.entries(inputKeys).map(([label, value]) => (
            <button key={label} type="button" onClick={() => send(value)}>
              {label}
            </button>
          ))}
        </form>
      ) : null}
    </section>
  );
}
