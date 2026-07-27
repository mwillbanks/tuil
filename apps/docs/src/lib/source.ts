import {
  Aperture,
  ArrowsClockwise,
  BookOpenText,
  Stack as Boxes,
  BracketsCurly,
  Browser,
  CirclesThreePlus,
  Code,
  Compass,
  Cube,
  CursorClick,
  Database,
  FlowArrow,
  Gear,
  Globe,
  GraduationCap,
  Lightning,
  ListBullets,
  MagicWand,
  Package,
  Palette,
  Play,
  Plugs,
  PuzzlePiece,
  RocketLaunch,
  Sparkle,
  SquaresFour,
  TerminalWindow,
  TestTube,
  TreeStructure,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";
import { loader } from "fumadocs-core/source";
import { createElement, type ReactNode } from "react";
import { docs } from "@/.source";
import { i18n } from "@/lib/i18n";

const icons = {
  Aperture,
  ArrowsClockwise,
  BookOpenText,
  Boxes,
  BracketsCurly,
  Browser,
  CirclesThreePlus,
  Code,
  Compass,
  CursorClick,
  Cube,
  Database,
  FlowArrow,
  Gear,
  Globe,
  GraduationCap,
  Lightning,
  ListBullets,
  MagicWand,
  Package,
  Palette,
  Play,
  Plugs,
  PuzzlePiece,
  RocketLaunch,
  Sparkle,
  SquaresFour,
  TerminalWindow,
  TestTube,
  TreeStructure,
  Wrench,
} as const;

function resolveIcon(name: string | undefined): ReactNode {
  if (!name) return undefined;
  const Icon = icons[name as keyof typeof icons];
  return Icon
    ? createElement(Icon, {
        "aria-hidden": true,
        size: 18,
        weight: "duotone",
      })
    : undefined;
}

export const source = loader({
  baseUrl: "/docs",
  i18n,
  icon: resolveIcon,
  source: docs.toFumadocsSource(),
});

export function getPageImageUrl(page: (typeof source)["$inferPage"]): {
  readonly segments: string[];
  readonly url: string;
} {
  const basePath = (process.env["NEXT_PUBLIC_BASE_PATH"] ?? "").replace(
    /\/+$/,
    "",
  );
  const segments = [
    page.locale ?? i18n.defaultLanguage,
    ...page.slugs,
    "image.webp",
  ];
  return {
    segments,
    url: `${basePath}/og/docs/${segments.join("/")}`,
  };
}
