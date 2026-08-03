"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { PublishedStoryFrame } from "./story-explorer";

export function GhosttyStory(props: {
  readonly frame: PublishedStoryFrame;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Revision intentionally remounts the terminal session.
  useEffect(() => {
    let active = true;
    let dispose: (() => Promise<void>) | undefined;
    setReady(false);
    setError(undefined);
    const mount = async () => {
      if (!host.current) return;
      const adapter = await import("@mwillbanks/tuil-ghostty-web");
      const app = adapter.createTuilGhosttyStoryApp({
        storyId: props.frame.storyId,
        variant: props.frame.variant,
        args: props.frame.args,
        controls: props.frame.controls,
      });
      const instance = await adapter.mountTuilGhostty({
        app,
        element: host.current,
        accessibility: {
          label: `${props.frame.storyTitle} ${props.frame.variant} interactive terminal`,
          instructions:
            "Use Tab to move, Enter or Space to activate, arrow keys to navigate, and Escape to close overlays.",
        },
        terminal: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 14,
          theme: {
            background: "#07111f",
            foreground: "#dce8f5",
            cursor: "#22d3ee",
          },
        },
      });
      if (!active) return instance.unmount();
      dispose = instance.unmount;
      setReady(true);
    };
    void mount().catch((cause: unknown) => {
      if (active)
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
      void dispose?.().catch(() => undefined);
    };
  }, [props.frame, revision]);

  return (
    <section className="ghostty-story-live ghostty-workspace">
      <div className="ghostty-toolbar">
        <strong>Live Ink 7 session</strong>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          Reset session
        </button>
      </div>
      {!ready ? (
        <pre aria-hidden={error ? undefined : "true"}>{props.frame.frame}</pre>
      ) : null}
      <div className="ghostty-terminal" ref={host} />
      <p aria-live="polite">
        {error
          ? `Interactive terminal unavailable: ${error}`
          : ready
            ? "Interactive terminal ready."
            : "Loading interactive terminal…"}
      </p>
    </section>
  );
}
