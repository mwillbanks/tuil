import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  type PublishedStoryFrame,
  ShowcaseGallery,
} from "@/components/story-explorer";
import { baseOptions } from "@/lib/layout.shared";
import storyFrames from "../../../public/integrations/story-frames.json";

export const metadata: Metadata = {
  title: "Showcase",
  description:
    "A gallery of portable tuil components, states, and application flows.",
};

export default function ShowcasePage(): ReactNode {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="integration-page">
        <header>
          <p>COMPONENT GALLERY</p>
          <h1>Showcase</h1>
          <span>
            Inspect terminal output across component families, variants,
            capability profiles, themes, and application blocks.
          </span>
          <div>
            <Link href="/playground">Open playground</Link>
            <Link href="/docs/reference">Read the reference</Link>
          </div>
        </header>
        <ShowcaseGallery
          frames={storyFrames as readonly PublishedStoryFrame[]}
        />
      </main>
    </HomeLayout>
  );
}
