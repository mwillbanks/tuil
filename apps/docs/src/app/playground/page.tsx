import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  PlaygroundExplorer,
  type PublishedStoryFrame,
} from "@/components/story-explorer";
import { baseOptions } from "@/lib/layout.shared";
import storyFrames from "../../../public/integrations/story-frames.json";

export const metadata: Metadata = {
  title: "Playground",
  description:
    "Explore every portable tuil story with terminal, semantics, focus, and event output.",
};

export default function PlaygroundPage(): ReactNode {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="integration-page">
        <header>
          <p>PORTABLE RUNTIME LAB</p>
          <h1>Playground</h1>
          <span>
            Browse the same story catalog used by the native terminal
            playground. Frames are rendered during the docs build, so this
            experience works without a server.
          </span>
          <div>
            <Link href="/docs/reference/components">Component reference</Link>
            <Link href="/showcase">Open showcase</Link>
          </div>
        </header>
        <PlaygroundExplorer
          frames={storyFrames as readonly PublishedStoryFrame[]}
        />
      </main>
    </HomeLayout>
  );
}
