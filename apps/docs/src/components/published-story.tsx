"use client";

import { type ReactNode, useEffect, useState } from "react";
import { GhosttyStory } from "./ghostty-story";
import type { PublishedStoryFrame } from "./story-explorer";

const basePath = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";

export function PublishedStory(props: {
  readonly storyId?: string;
  readonly variant: string;
}): ReactNode {
  const [frame, setFrame] = useState<PublishedStoryFrame>();
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${basePath}/integrations/story-manifest.json`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Story manifest returned ${response.status}.`);
        return response.json() as Promise<{
          readonly stories: readonly PublishedStoryFrame[];
        }>;
      })
      .then((manifest) => {
        const match = manifest.stories.find(
          (candidate) =>
            (!props.storyId || candidate.storyId === props.storyId) &&
            candidate.variant.toLowerCase() === props.variant.toLowerCase(),
        );
        if (!match)
          throw new Error(`No published story exists for ${props.variant}.`);
        setFrame(match);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [props.storyId, props.variant]);

  if (error) return <p role="alert">{error}</p>;
  if (!frame) return <p aria-live="polite">Loading executable example…</p>;
  return (
    <section className="terminal-story">
      <header>
        <strong>
          {frame.storyTitle} / {frame.variant}
        </strong>
      </header>
      <GhosttyStory frame={frame} />
      <button type="button" onClick={() => setShowSource((value) => !value)}>
        {showSource ? "Hide source" : "View source"}
      </button>
      {showSource ? (
        <pre>
          <code>{frame.source ?? "Source is unavailable."}</code>
        </pre>
      ) : null}
    </section>
  );
}
