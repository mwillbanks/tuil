import { type ReactNode, useEffect, useRef, useState } from "react";

export function GhosttyStoryFrame(props: {
  readonly storyId: string;
  readonly variant: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly controls: Readonly<Record<string, unknown>>;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading browser terminal…");
  const serializedArgs = JSON.stringify(props.args);
  const serializedControls = JSON.stringify(props.controls);
  const storyId = props.storyId;
  const variant = props.variant;

  useEffect(() => {
    let active = true;
    let dispose: (() => Promise<void>) | undefined;
    const mount = async () => {
      if (!host.current) return;
      const adapter = await import("@mwillbanks/tuil-ghostty-web");
      if (!active || !host.current) return;
      const app = adapter.createTuilGhosttyStoryApp({
        storyId,
        variant,
        args: JSON.parse(serializedArgs) as Readonly<Record<string, unknown>>,
        controls: JSON.parse(serializedControls) as Readonly<
          Record<string, unknown>
        >,
      });
      const instance = await adapter.mountTuilGhostty({
        app,
        element: host.current,
        accessibility: {
          label: `${storyId} ${variant} TUIL demonstration`,
        },
      });
      if (!active) return instance.unmount();
      dispose = instance.unmount;
      setStatus("Interactive terminal ready.");
    };
    void mount().catch((cause: unknown) => {
      if (active) {
        setStatus(
          `Terminal failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    });
    return () => {
      active = false;
      void dispose?.().catch(() => undefined);
    };
  }, [serializedArgs, serializedControls, storyId, variant]);

  return (
    <section>
      <div ref={host} style={{ minWidth: 640, minHeight: 384 }} />
      <p aria-live="polite">{status}</p>
    </section>
  );
}
