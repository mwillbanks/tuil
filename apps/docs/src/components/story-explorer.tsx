"use client";

import {
  ArrowLeft,
  ArrowRight,
  Code,
  CursorClick,
  Monitor,
  Sparkle,
} from "@phosphor-icons/react";
import { type ReactNode, useMemo, useState } from "react";

export interface PublishedStoryFrame {
  readonly id: string;
  readonly storyId: string;
  readonly storyTitle: string;
  readonly variant: string;
  readonly frame: string;
  readonly events: readonly string[];
  readonly focus: readonly string[];
  readonly controls: {
    readonly width: number;
    readonly height: number;
    readonly theme: string;
    readonly interactive: boolean;
  };
}

function TerminalFrame(props: {
  readonly frame: PublishedStoryFrame;
}): ReactNode {
  return (
    <article className="terminal-story">
      <header>
        <span />
        <span />
        <span />
        <code>
          {props.frame.storyId}.{props.frame.variant}
        </code>
      </header>
      <pre>{props.frame.frame}</pre>
      <footer>
        <span>
          <Monitor aria-hidden="true" />
          {props.frame.controls.width}×{props.frame.controls.height}
        </span>
        <span>
          <CursorClick aria-hidden="true" />
          {props.frame.focus.length} focus targets
        </span>
        <span>
          <Sparkle aria-hidden="true" />
          {props.frame.controls.theme}
        </span>
      </footer>
    </article>
  );
}

export function PlaygroundExplorer(props: {
  readonly frames: readonly PublishedStoryFrame[];
}): ReactNode {
  const [index, setIndex] = useState(0);
  const frame = props.frames[index];
  if (!frame) return null;

  return (
    <div className="playground-explorer">
      <nav aria-label="Portable story controls">
        <button
          aria-label="Previous story"
          onClick={() =>
            setIndex(
              (current) =>
                (current - 1 + props.frames.length) % props.frames.length,
            )
          }
          type="button"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <label>
          <span>Story</span>
          <select
            onChange={(event) =>
              setIndex(
                Number(
                  (
                    event.currentTarget as unknown as {
                      readonly value: string;
                    }
                  ).value,
                ),
              )
            }
            value={index}
          >
            {props.frames.map((candidate, candidateIndex) => (
              <option key={candidate.id} value={candidateIndex}>
                {candidate.storyTitle} / {candidate.variant}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="Next story"
          onClick={() =>
            setIndex((current) => (current + 1) % props.frames.length)
          }
          type="button"
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </nav>
      <TerminalFrame frame={frame} />
      <section className="story-inspector">
        <div>
          <strong>Semantic focus order</strong>
          <span>{frame.focus.join(" → ") || "No focusable nodes"}</span>
        </div>
        <div>
          <strong>Observed events</strong>
          <span>
            {frame.events.join(", ") || "No events emitted on render"}
          </span>
        </div>
        <div>
          <strong>Run locally</strong>
          <code>bun run playground</code>
        </div>
      </section>
    </div>
  );
}

export function ShowcaseGallery(props: {
  readonly frames: readonly PublishedStoryFrame[];
}): ReactNode {
  const [filter, setFilter] = useState("all");
  const storySets = useMemo(
    () => [...new Set(props.frames.map((frame) => frame.storyId))],
    [props.frames],
  );
  const visible =
    filter === "all"
      ? props.frames
      : props.frames.filter((frame) => frame.storyId === filter);

  return (
    <div className="showcase-gallery">
      <nav aria-label="Showcase filters">
        <Code aria-hidden="true" />
        <button
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
          type="button"
        >
          All
        </button>
        {storySets.map((storyId) => (
          <button
            aria-pressed={filter === storyId}
            key={storyId}
            onClick={() => setFilter(storyId)}
            type="button"
          >
            {storyId}
          </button>
        ))}
      </nav>
      <div className="showcase-grid">
        {visible.map((frame) => (
          <TerminalFrame frame={frame} key={frame.id} />
        ))}
      </div>
    </div>
  );
}
