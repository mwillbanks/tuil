"use client";

import type { PlaygroundDocumentV1 } from "@mwillbanks/tuil-ghostty-web";
import { type ReactNode, useEffect, useRef, useState } from "react";

export function GhosttyPlayground(props: {
  readonly document?: PlaygroundDocumentV1;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const documentRef = useRef(props.document);
  const sessionRef = useRef<{
    update(document: PlaygroundDocumentV1): void;
  }>(undefined);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    generation: string;
    message: string;
  }>();
  const terminalKey = props.document
    ? JSON.stringify(props.document.terminal)
    : "feasibility";
  const generation = `${revision}:${terminalKey}`;

  useEffect(() => {
    documentRef.current = props.document;
    if (props.document) sessionRef.current?.update(props.document);
  }, [props.document]);

  useEffect(() => {
    let active = true;
    let dispose: (() => Promise<void>) | undefined;
    const mount = async () => {
      if (!host.current) return;
      const adapter = await import("@mwillbanks/tuil-ghostty-web");
      if (!active || !host.current) return;
      const session = documentRef.current
        ? adapter.createTuilGhosttyDocumentSession(documentRef.current)
        : undefined;
      if (session) sessionRef.current = session;
      const app = session
        ? session.app
        : adapter.createTuilGhosttyFeasibilityApp();
      const instance = await adapter.mountTuilGhostty({
        app,
        element: host.current,
        accessibility: {
          label: "Interactive TUIL Ghostty demonstration",
          instructions:
            "Use Tab to move, Enter or Space to activate, arrow keys to scroll, and Escape to close overlays.",
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
      if (!active) {
        await instance.unmount();
        return;
      }
      dispose = instance.unmount;
      instance.focus();
      setResult({ generation, message: "Interactive terminal ready." });
    };
    void mount().catch((cause: unknown) => {
      if (active)
        setResult({
          generation,
          message: `Browser terminal failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
    });
    return () => {
      active = false;
      sessionRef.current = undefined;
      void dispose?.().catch(() => undefined);
    };
  }, [generation]);

  return (
    <section className="ghostty-workspace">
      <div className="ghostty-toolbar">
        <strong>Live Ink session</strong>
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          Reset session
        </button>
      </div>
      <div className="ghostty-terminal" key={revision} ref={host} />
      <p aria-live="polite">
        {result?.generation === generation
          ? result.message
          : "Loading Ghostty Web…"}
      </p>
    </section>
  );
}
