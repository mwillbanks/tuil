import { type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ShowcaseStory } from "./catalog.ts";
import {
  parseShowcaseArgument,
  selectShowcaseStory,
  showcaseQuery,
} from "./browser-state.ts";
import { GhosttyStoryFrame } from "./ghostty-story-frame.tsx";

const choices: Readonly<Record<string, readonly (string | number)[]>> = {
  colorDepth: [1, 4, 8, 24],
  theme: ["default-dark", "default-light"],
  platform: ["darwin", "linux", "win32"],
};

function Controls(props: {
  readonly values: ShowcaseStory["controls"];
  readonly onChange: (key: string, value: string | number | boolean) => void;
}): ReactNode {
  return (
    <fieldset>
      <legend>Terminal controls</legend>
      {Object.entries(props.values).map(([key, value]) => (
        <label key={key}>
          {key}
          {typeof value === "boolean" ? (
            <input
              type="checkbox"
              checked={value}
              onChange={(event) =>
                props.onChange(key, event.currentTarget.checked)
              }
            />
          ) : choices[key] ? (
            <select
              value={String(value)}
              onChange={(event) =>
                props.onChange(
                  key,
                  typeof value === "number"
                    ? Number(event.currentTarget.value)
                    : event.currentTarget.value,
                )
              }
            >
              {choices[key].map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={key === "width" ? 20 : 5}
              max={key === "width" ? 240 : 100}
              value={Number(value)}
              onChange={(event) => {
                const number = event.currentTarget.valueAsNumber;
                if (Number.isFinite(number))
                  props.onChange(
                    key,
                    Math.max(
                      key === "width" ? 20 : 5,
                      Math.min(key === "width" ? 240 : 100, number),
                    ),
                  );
              }}
            />
          )}
        </label>
      ))}
    </fieldset>
  );
}

function StoryPreview(props: { readonly story: ShowcaseStory }): ReactNode {
  const story = props.story;
  const [args, setArgs] = useState(story.args);
  const [controls, setControls] = useState(story.controls);
  const [session, setSession] = useState(0);
  const [error, setError] = useState("");
  return (
    <section aria-labelledby="preview-title">
      <h2 id="preview-title">
        {story.title} / {story.variant}
      </h2>
      <div className="preview-layout">
        <aside>
          <Controls
            values={controls}
            onChange={(key, value) =>
              setControls((current) => ({ ...current, [key]: value }))
            }
          />
          <fieldset>
            <legend>Component arguments</legend>
            {Object.entries(story.args).map(([key, initial]) => (
              <label key={key}>
                {key}
                <input
                  key={session}
                  defaultValue={
                    typeof initial === "object"
                      ? JSON.stringify(initial)
                      : String(initial)
                  }
                  onBlur={(event) => {
                    try {
                      const value = parseShowcaseArgument(
                        event.currentTarget.value,
                        initial,
                      );
                      setArgs((current) => ({ ...current, [key]: value }));
                      setError("");
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      );
                    }
                  }}
                />
              </label>
            ))}
          </fieldset>
          {error ? <p role="alert">{error}</p> : null}
          <button
            type="button"
            onClick={() => {
              setArgs(story.args);
              setControls(story.controls);
              setSession((current) => current + 1);
              setError("");
            }}
          >
            Reset session
          </button>
        </aside>
        <div className="terminal-preview">
          {!controls["interactive"] ? <p>Static playback</p> : null}
          <GhosttyStoryFrame
            key={session}
            storyId={story.storyId}
            variant={story.variant}
            args={args}
            controls={controls}
          />
          <details>
            <summary>Recorded static frame</summary>
            <pre>{story.frame}</pre>
          </details>
        </div>
      </div>
    </section>
  );
}

function ShowcaseBrowser(props: {
  readonly stories: readonly ShowcaseStory[];
}): ReactNode {
  const [selected, setSelected] = useState(() =>
    selectShowcaseStory(props.stories, window.location.search),
  );
  const [query, setQuery] = useState("");
  const filtered = props.stories.filter((story) =>
    (story.title + " " + story.variant)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const choose = (story: ShowcaseStory) => {
    setSelected(story);
    window.history.replaceState(null, "", showcaseQuery(story));
  };
  return (
    <main>
      <header>
        <h1>TUIL Showcase</h1>
        <p>Explore portable terminal components and applications.</p>
      </header>
      <div className="showcase-layout">
        <nav aria-label="Story selection">
          <label>
            Search stories
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          {filtered.map((story) => (
            <button
              key={story.id}
              type="button"
              aria-pressed={selected.id === story.id}
              onClick={() => choose(story)}
            >
              {story.title} / {story.variant}
            </button>
          ))}
          {filtered.length === 0 ? <p>No stories match.</p> : null}
        </nav>
        <StoryPreview key={selected.id} story={selected} />
      </div>
    </main>
  );
}

async function start(): Promise<void> {
  const response = await fetch(new URL("./catalog.json", import.meta.url));
  if (!response.ok) throw new Error("Unable to load the showcase catalog");
  const stories = (await response.json()) as ShowcaseStory[];
  const host = document.getElementById("showcase-root");
  if (!host) throw new Error("Showcase root is missing");
  createRoot(host).render(<ShowcaseBrowser stories={stories} />);
}

void start().catch((cause: unknown) => {
  const host = document.getElementById("showcase-root");
  if (host) {
    host.setAttribute("role", "alert");
    host.textContent = cause instanceof Error ? cause.message : String(cause);
  }
});
