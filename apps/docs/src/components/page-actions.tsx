"use client";

import { Copy, GithubLogo, MarkdownLogo } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

const repository =
  "https://github.com/mwillbanks/tuil/blob/main/apps/docs/content/docs";

interface BrowserEnvironment {
  readonly navigator: {
    readonly clipboard: {
      writeText(value: string): Promise<void>;
    };
  };
  setTimeout(callback: () => void, timeout: number): number;
}

export function PageActions(props: {
  readonly markdownUrl: string;
  readonly sourcePath: string;
}): ReactNode {
  const [copied, setCopied] = useState(false);
  const basePath = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";
  const rawUrl = `${basePath}${props.markdownUrl}`;

  return (
    <div className="page-actions">
      <button
        onClick={async () => {
          const response = await fetch(rawUrl);
          const browser = globalThis as unknown as BrowserEnvironment;
          await browser.navigator.clipboard.writeText(await response.text());
          setCopied(true);
          browser.setTimeout(() => setCopied(false), 1_500);
        }}
        type="button"
      >
        <Copy aria-hidden="true" />
        {copied ? "Copied" : "Copy Markdown"}
      </button>
      <a href={rawUrl}>
        <MarkdownLogo aria-hidden="true" />
        View raw
      </a>
      <a href={`${repository}/${props.sourcePath}`}>
        <GithubLogo aria-hidden="true" />
        Edit
      </a>
    </div>
  );
}
