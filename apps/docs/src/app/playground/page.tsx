import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Link } from "fumadocs-core/framework";
import type { ReactNode } from "react";
import { VisualComposer } from "@/components/visual-composer";
import { baseOptions } from "@/lib/layout.shared";

export const playgroundMetadata = {
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
            Run the existing TUIL and Ink runtime inside Ghostty Web. The
            complete catalog remains available as deterministic static frames.
          </span>
          <div>
            <Link href="/docs/reference/components">Component reference</Link>
            <Link href="/showcase">Open showcase</Link>
          </div>
        </header>
        <VisualComposer />
      </main>
    </HomeLayout>
  );
}
