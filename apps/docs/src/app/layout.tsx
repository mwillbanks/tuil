import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "tuil",
    template: "%s · tuil",
  },
  description: "A production terminal UI framework for React and Ink.",
};

export default function RootLayout(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{props.children}</RootProvider>
      </body>
    </html>
  );
}
