"use client";

import { Broadcast, Cube, FlowArrow, Keyboard } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export interface ReferenceStoryProps {
  readonly name: string;
  readonly category: string;
  readonly frame: string;
  readonly interaction: string;
  readonly emits: string;
}

export function ReferenceStory(props: ReferenceStoryProps): ReactNode {
  return (
    <section className="reference-story">
      <header>
        <span>
          <Cube aria-hidden="true" />
          {props.category}
        </span>
        <strong>{props.name}</strong>
      </header>
      <pre>{props.frame}</pre>
      <footer>
        <span>
          <Keyboard aria-hidden="true" />
          {props.interaction}
        </span>
        <span>
          <Broadcast aria-hidden="true" />
          {props.emits}
        </span>
        <span>
          <FlowArrow aria-hidden="true" />
          semantics + focus
        </span>
      </footer>
    </section>
  );
}
