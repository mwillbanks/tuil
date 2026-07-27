import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowRight,
  Blocks,
  Braces,
  Check,
  Focus,
  Gauge,
  GitBranch,
  Keyboard,
  Layers3,
  Route,
  Sparkles,
  TerminalSquare,
  Workflow,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { type DocsLocale, localizeDocsHref } from "@/lib/i18n";
import { baseOptions } from "@/lib/layout.shared";

const basePath = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";

const features = [
  {
    description:
      "Compose commands, events, capabilities, plugins, operations, and lifecycle services behind one explicit application boundary.",
    icon: Layers3,
    title: "One runtime",
  },
  {
    description:
      "Move through focus scopes, typed routes, overlays, forms, and hotkey sequences without rebuilding terminal behavior.",
    icon: Keyboard,
    title: "Terminal-native UX",
  },
  {
    description:
      "Run the same application in an interactive TTY, redirected output, tests, Storybook, snapshots, and documentation.",
    icon: Sparkles,
    title: "Every surface",
  },
];

const packageSignals = [
  ["focus", "scoped + restorable"],
  ["routing", "typed + guarded"],
  ["operations", "observable + cancellable"],
  ["workflows", "persistent + resumable"],
];

export function HomePageContent(props: {
  readonly locale: DocsLocale;
}): ReactNode {
  return (
    <HomeLayout {...baseOptions(props.locale)}>
      <main className="home-shell" lang={props.locale}>
        <section className="hero-section">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-aurora hero-aurora-cyan" aria-hidden="true" />
          <div className="hero-aurora hero-aurora-magenta" aria-hidden="true" />

          <div className="hero-copy">
            <div className="hero-brand">
              <Brand />
            </div>
            <p className="eyebrow">
              <span />
              React · Ink · Bun
            </p>
            <h1>
              Terminal UI,
              <span className="hero-title-accent">
                without the runtime tax.
              </span>
            </h1>
            <p className="hero-description">
              Build polished terminal applications with composable components,
              typed services, deterministic output, portable stories, and a
              production runtime that stays out of your way.
            </p>
            <div className="hero-actions">
              <Link
                className="primary-action"
                href={localizeDocsHref(
                  "/docs/introduction/quick-start",
                  props.locale,
                )}
              >
                Start building
                <ArrowRight aria-hidden="true" className="action-icon" />
              </Link>
              <a
                className="secondary-action"
                href="https://github.com/mwillbanks/tuil"
              >
                View on GitHub
              </a>
            </div>
            <div className="install-command">
              <span aria-hidden="true">$</span>
              <code>npm install @mwillbanks/tuil</code>
              <b>MIT</b>
            </div>
          </div>

          <div
            className="hero-visual"
            aria-label="tuil runtime preview"
            role="img"
          >
            <div className="logo-stage">
              <div className="logo-halo" aria-hidden="true" />
              <Image
                alt="tuil terminal window"
                height={768}
                priority
                src={`${basePath}/logo.svg`}
                width={1024}
              />
              <span className="orbit-chip chip-focus">
                <Focus />
                focus
              </span>
              <span className="orbit-chip chip-route">
                <Route />
                route
              </span>
              <span className="orbit-chip chip-flow">
                <Workflow />
                workflow
              </span>
            </div>
            <div className="runtime-panel">
              <div className="panel-bar">
                <span />
                <span />
                <span />
                <code>runtime.inspect()</code>
              </div>
              <div className="panel-body">
                {packageSignals.map(([label, value]) => (
                  <div key={label}>
                    <span>
                      <Check />
                      {label}
                    </span>
                    <code>{value}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="signal-strip" aria-label="Framework capabilities">
          <span>INTERACTIVE</span>
          <i />
          <span>STATIC</span>
          <i />
          <span>SEMANTIC</span>
          <i />
          <span>PORTABLE</span>
          <i />
          <span>TYPE-SAFE</span>
        </section>

        <section className="feature-section">
          <div className="section-heading">
            <p>THE FRAMEWORK LAYER</p>
            <h2>Build the interface. Keep the control.</h2>
            <span>
              tuil owns the repetitive terminal machinery while your application
              keeps its domain, data, and architecture.
            </span>
          </div>
          <div className="feature-grid">
            {features.map(({ description, icon: Icon, title }, index) => (
              <article className="feature-card" key={title}>
                <div className="feature-topline">
                  <span className="feature-index">0{index + 1}</span>
                  <Icon aria-hidden="true" className="feature-icon" />
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="architecture-section">
          <div className="architecture-copy">
            <p className="eyebrow">
              <span />
              Composable by design
            </p>
            <h2>A complete layer, not a component grab bag.</h2>
            <p className="architecture-description">
              Start with the umbrella package or choose focused package
              boundaries. Every part shares typed contracts, deterministic
              teardown, and semantic testing.
            </p>
            <Link
              className="architecture-action"
              href={localizeDocsHref(
                "/docs/concepts/architecture",
                props.locale,
              )}
            >
              Explore the architecture
              <ArrowRight className="action-icon" />
            </Link>
          </div>
          <div
            className="package-map"
            aria-label="tuil package architecture"
            role="img"
          >
            <div className="map-core">
              <TerminalSquare />
              <strong>@mwillbanks/tuil</strong>
              <small>application runtime</small>
            </div>
            <div className="map-node node-components">
              <Blocks />
              <span>components</span>
            </div>
            <div className="map-node node-forms">
              <Braces />
              <span>forms</span>
            </div>
            <div className="map-node node-router">
              <GitBranch />
              <span>router</span>
            </div>
            <div className="map-node node-operations">
              <Zap />
              <span>operations</span>
            </div>
            <div className="map-node node-testing">
              <Gauge />
              <span>testing</span>
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div>
            <p>YOUR TERMINAL DESERVES A DESIGN SYSTEM</p>
            <h2>Ship an interface people want to use.</h2>
          </div>
          <Link href="/playground">
            Open the playground
            <ArrowRight className="action-icon" />
          </Link>
        </section>
      </main>
    </HomeLayout>
  );
}

export default function HomePage(): ReactNode {
  return <HomePageContent locale="en" />;
}
