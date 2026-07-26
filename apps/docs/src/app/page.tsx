import { HomeLayout } from "fumadocs-ui/layouts/home";
import Link from "next/link";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";

export default function HomePage(): ReactNode {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto flex min-h-[70vh] max-w-4xl flex-col justify-center gap-6 px-6">
        <p className="font-mono text-sm text-fd-muted-foreground">
          React · Ink · Bun
        </p>
        <h1 className="text-5xl font-bold tracking-tight">
          Build terminal interfaces without rebuilding the runtime.
        </h1>
        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          tuil provides composable components, application services, forms,
          navigation, workflows, operations, registries, testing, and portable
          stories.
        </p>
        <Link
          className="w-fit rounded-md bg-fd-primary px-4 py-2 text-fd-primary-foreground"
          href="/docs"
        >
          Read the documentation
        </Link>
      </main>
    </HomeLayout>
  );
}
