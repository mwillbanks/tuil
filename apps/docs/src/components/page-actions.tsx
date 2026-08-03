"use client";

import { Copy, GithubLogo, MarkdownLogo } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const repository =
  "https://github.com/mwillbanks/tuil/blob/main/apps/docs/content/docs";

type CopyStatus = "idle" | "copying" | "success" | "error";

export function PageActions(props: {
  readonly markdownUrl: string;
  readonly sourcePath: string;
}): ReactNode {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const basePath = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";
  const rawUrl = `${basePath}${props.markdownUrl}`;

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copyMarkdown = async () => {
    setCopyStatus("copying");
    try {
      const response = await fetch(rawUrl);
      if (!response.ok) {
        throw new Error(
          `Markdown request failed with status ${response.status}`,
        );
      }
      await (
        navigator as Navigator & {
          readonly clipboard: { writeText(value: string): Promise<void> };
        }
      ).clipboard.writeText(await response.text());
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyStatus("idle"), 3_000);
  };

  const buttonLabel =
    copyStatus === "copying"
      ? "Copying…"
      : copyStatus === "success"
        ? "Copied"
        : copyStatus === "error"
          ? "Copy failed"
          : "Copy Markdown";

  return (
    <div className="page-actions">
      <button
        disabled={copyStatus === "copying"}
        onClick={copyMarkdown}
        type="button"
      >
        <Copy aria-hidden="true" />
        {buttonLabel}
      </button>
      <a href={rawUrl}>
        <MarkdownLogo aria-hidden="true" />
        View raw
      </a>
      <a href={`${repository}/${props.sourcePath}`}>
        <GithubLogo aria-hidden="true" />
        Edit
      </a>
      <span aria-live="polite" className="sr-only" role="status">
        {copyStatus === "success"
          ? "Markdown copied to the clipboard."
          : copyStatus === "error"
            ? "Markdown could not be copied."
            : ""}
      </span>
    </div>
  );
}
