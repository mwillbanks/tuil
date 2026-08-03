"use client";

import {
  ArrowLeft,
  ArrowRight,
  Code,
  CursorClick,
  Monitor,
  Sparkle,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GhosttyStory } from "./ghostty-story";

export interface PublishedStoryFrame {
  readonly id: string;
  readonly storyId: string;
  readonly storyTitle: string;
  readonly variant: string;
  readonly frame: string;
  readonly source?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly description?: string;
  readonly htmlFrame?: string;
  readonly capabilities?: readonly string[];
  readonly packageDependencies?: readonly string[];
  readonly events: readonly string[];
  readonly focus: readonly string[];
  readonly controls: {
    readonly width: number;
    readonly height: number;
    readonly theme: string;
    readonly interactive: boolean;
  };
}

function SafeHtmlFrame(props: { readonly value: string }): ReactNode {
  return <code dangerouslySetInnerHTML={{ __html: props.value }} />;
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
      <pre>
        {props.frame.htmlFrame ? (
          <SafeHtmlFrame value={props.frame.htmlFrame} />
        ) : (
          props.frame.frame
        )}
      </pre>
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

interface ShowcaseBrowser {
  readonly location: { readonly search: string; readonly pathname: string };
  readonly history: {
    replaceState(data: null, unused: string, url: string): void;
  };
  readonly scrollY: number;
  readonly document: {
    readonly scrollingElement: { scrollTop: number } | null;
  };
  scrollTo(options: { readonly top: number; readonly behavior: "auto" }): void;
}

function showcaseBrowser(): ShowcaseBrowser {
  return globalThis as unknown as ShowcaseBrowser;
}

function restoreShowcaseState(browser: ShowcaseBrowser): {
  readonly filter: string;
  readonly capability: string;
  readonly interaction: string;
  readonly query: string;
  readonly selectedId?: string;
} {
  const parameters = new URLSearchParams(browser.location.search);
  return {
    filter: parameters.get("category") ?? "all",
    capability: parameters.get("capability") ?? "all",
    interaction: parameters.get("interaction") ?? "all",
    query: parameters.get("query") ?? "",
    selectedId: parameters.get("story") ?? undefined,
  };
}

function syncShowcaseState(
  browser: ShowcaseBrowser,
  state: {
    readonly filter: string;
    readonly capability: string;
    readonly interaction: string;
    readonly query: string;
    readonly selectedId?: string;
  },
): void {
  const parameters = new URLSearchParams();
  if (state.filter !== "all") parameters.set("category", state.filter);
  if (state.capability !== "all") {
    parameters.set("capability", state.capability);
  }
  if (state.interaction !== "all") {
    parameters.set("interaction", state.interaction);
  }
  if (state.query) parameters.set("query", state.query);
  if (state.selectedId) parameters.set("story", state.selectedId);
  const suffix = parameters.size ? `?${parameters}` : browser.location.pathname;
  browser.history.replaceState(null, "", suffix);
}

function filterShowcaseFrames(
  frames: readonly PublishedStoryFrame[],
  state: {
    readonly filter: string;
    readonly capability: string;
    readonly interaction: string;
    readonly query: string;
  },
): readonly PublishedStoryFrame[] {
  const categoryFiltered =
    state.filter === "all"
      ? frames
      : frames.filter((frame) => frame.storyId === state.filter);
  const interactionMatches = (frame: PublishedStoryFrame): boolean =>
    state.interaction === "all" ||
    (state.interaction === "interactive") === frame.controls.interactive;
  const query = state.query.toLowerCase();
  return categoryFiltered.filter(
    (frame) =>
      (state.capability === "all" ||
        frame.capabilities?.includes(state.capability)) &&
      interactionMatches(frame) &&
      `${frame.storyTitle} ${frame.variant} ${frame.description ?? ""}`
        .toLowerCase()
        .includes(query),
  );
}

function scrollSelectedPreview(
  browser: ShowcaseBrowser,
  preview: HTMLElement | null,
): void {
  if (!preview) return;
  const target = preview as unknown as {
    focus(): void;
    scrollIntoView(options: {
      readonly behavior: "auto";
      readonly block: "start";
    }): void;
    getBoundingClientRect(): { readonly top: number };
  };
  target.focus();
  target.scrollIntoView({ behavior: "auto", block: "start" });
  const top = Math.max(
    0,
    browser.scrollY + target.getBoundingClientRect().top - 72,
  );
  browser.scrollTo({ top, behavior: "auto" });
  if (browser.document.scrollingElement) {
    browser.document.scrollingElement.scrollTop = top;
  }
}

function ShowcaseFilters(props: {
  readonly frames: readonly PublishedStoryFrame[];
  readonly storySets: readonly string[];
  readonly filter: string;
  readonly capability: string;
  readonly interaction: string;
  readonly query: string;
  readonly setFilter: (value: string) => void;
  readonly setCapability: (value: string) => void;
  readonly setInteraction: (value: string) => void;
  readonly setQuery: (value: string) => void;
}): ReactNode {
  const capabilities = [
    ...new Set(props.frames.flatMap((frame) => frame.capabilities ?? [])),
  ].sort();
  return (
    <>
      <nav aria-label="Showcase filters">
        <Code aria-hidden="true" />
        <button
          aria-pressed={props.filter === "all"}
          onClick={() => props.setFilter("all")}
          type="button"
        >
          All
        </button>
        {props.storySets.map((storyId) => (
          <button
            aria-pressed={props.filter === storyId}
            key={storyId}
            onClick={() => props.setFilter(storyId)}
            type="button"
          >
            {storyId}
          </button>
        ))}
      </nav>
      <label className="showcase-search">
        Search components
        <input
          value={props.query}
          onChange={(event) =>
            props.setQuery(
              (event.currentTarget as unknown as { readonly value: string })
                .value,
            )
          }
        />
      </label>
      <label className="showcase-search">
        Capability
        <select
          value={props.capability}
          onChange={(event) =>
            props.setCapability(
              (event.currentTarget as unknown as { readonly value: string })
                .value,
            )
          }
        >
          <option value="all">All capabilities</option>
          {capabilities.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="showcase-search">
        Interaction
        <select
          value={props.interaction}
          onChange={(event) =>
            props.setInteraction(
              (event.currentTarget as unknown as { readonly value: string })
                .value,
            )
          }
        >
          <option value="all">All interactions</option>
          <option value="interactive">Interactive</option>
          <option value="static">Static</option>
        </select>
      </label>
    </>
  );
}

function ShowcasePreview(props: {
  readonly frame: PublishedStoryFrame;
  readonly previewRef: RefObject<HTMLElement | null>;
}): ReactNode {
  const frame = props.frame;
  return (
    <section
      className="story-inspector showcase-preview"
      ref={props.previewRef}
      tabIndex={-1}
      aria-labelledby="showcase-preview-title"
    >
      <div className="showcase-preview-heading">
        <div>
          <p className="composer-eyebrow">Selected demonstration</p>
          <h2 id="showcase-preview-title">
            {frame.storyTitle} / {frame.variant}
          </h2>
          <p>{frame.description}</p>
        </div>
        <span className="showcase-preview-badge">
          {frame.controls.width}×{frame.controls.height} ·{" "}
          {frame.controls.theme}
        </span>
      </div>
      <GhosttyStory frame={frame} />
      <div className="showcase-preview-meta">
        <div>
          <strong>Semantic focus order</strong>
          <span>{frame.focus.join(" → ") || "No focus targets"}</span>
        </div>
        <div>
          <strong>Observed events</strong>
          <span>
            {frame.events.join(", ") || "No events emitted on render"}
          </span>
        </div>
        <div>
          <strong>Capabilities</strong>
          <span>
            {frame.capabilities?.join(", ") || "Portable browser demo"}
          </span>
        </div>
      </div>
      <details className="showcase-source">
        <summary>View source and dependencies</summary>
        <pre>
          <code>{frame.source ?? "Source is unavailable."}</code>
        </pre>
        <p>Dependencies: {frame.packageDependencies?.join(", ") || "None"}</p>
      </details>
    </section>
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
  const [capability, setCapability] = useState("all");
  const [interaction, setInteraction] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [restored, setRestored] = useState(false);
  const selectedPreviewRef = useRef<HTMLElement | null>(null);
  const storySets = useMemo(
    () => [...new Set(props.frames.map((frame) => frame.storyId))],
    [props.frames],
  );
  const browser = useMemo(showcaseBrowser, []);
  useEffect(() => {
    const state = restoreShowcaseState(browser);
    setFilter(state.filter);
    setCapability(state.capability);
    setInteraction(state.interaction);
    setQuery(state.query);
    setSelectedId(state.selectedId);
    setRestored(true);
  }, [browser]);
  useEffect(() => {
    if (!restored) return;
    syncShowcaseState(browser, {
      filter,
      capability,
      interaction,
      query,
      selectedId,
    });
  }, [browser, capability, filter, interaction, query, restored, selectedId]);
  const filtered = filterShowcaseFrames(props.frames, {
    filter,
    capability,
    interaction,
    query,
  });
  const visible = filtered.slice(0, 24);
  const selected = props.frames.find((frame) => frame.id === selectedId);

  useEffect(() => {
    if (!selectedId || !selected) return;
    scrollSelectedPreview(browser, selectedPreviewRef.current);
  }, [browser, selected, selectedId]);

  return (
    <div className="showcase-gallery">
      <ShowcaseFilters
        capability={capability}
        filter={filter}
        interaction={interaction}
        query={query}
        frames={props.frames}
        setCapability={setCapability}
        setFilter={setFilter}
        setInteraction={setInteraction}
        setQuery={setQuery}
        storySets={storySets}
      />
      <div className="showcase-grid">
        {visible.map((frame) => (
          <button
            className="showcase-card"
            key={frame.id}
            type="button"
            onClick={() => setSelectedId(frame.id)}
          >
            <TerminalFrame frame={frame} />
          </button>
        ))}
      </div>
      {filtered.length > 24 ? (
        <p>
          Showing 24 of {filtered.length} results. Refine the filters to inspect
          more.
        </p>
      ) : null}
      {selected ? (
        <ShowcasePreview frame={selected} previewRef={selectedPreviewRef} />
      ) : null}
    </div>
  );
}
