import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocumentShell } from "@/components/document-shell";
import "./globals.css";

const basePath = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";

export const metadata: Metadata = {
  title: {
    default: "tuil — terminal UI, without the runtime tax",
    template: "%s · tuil",
  },
  description:
    "A renderer-neutral terminal application runtime with React Ink compatibility and deterministic cell rendering.",
  icons: {
    icon: `${basePath}/logo.svg`,
  },
  metadataBase: new URL("https://mwillbanks.github.io/"),
  openGraph: {
    description:
      "Build polished Ink-compatible or cell-rendered terminal applications with one runtime for interactive, static, test, and story surfaces.",
    siteName: "tuil",
    title: "tuil — terminal UI, without the runtime tax",
    type: "website",
    url: "https://mwillbanks.github.io/tuil/",
  },
};

export default function RootLayout(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <DocumentShell
      bodyClassName={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      {props.children}
    </DocumentShell>
  );
}
