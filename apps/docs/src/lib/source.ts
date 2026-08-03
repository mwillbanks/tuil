import {
  Aperture,
  AppWindow,
  ArrowsClockwise,
  Article,
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
  Desktop,
  FileCode,
  FlowArrow,
  Gauge,
  Gear,
  Globe,
  GraduationCap,
  Keyboard,
  Lifebuoy,
  Lightning,
  ListBullets,
  ListMagnifyingGlass,
  MagicWand,
  MagnifyingGlass,
  Monitor,
  Package,
  Palette,
  PencilSimple,
  Play,
  Plugs,
  Pulse,
  PuzzlePiece,
  RocketLaunch,
  ShieldCheck,
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
  AppWindow,
  Article,
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
  Desktop,
  FileCode,
  FlowArrow,
  Gear,
  Gauge,
  Globe,
  GraduationCap,
  Lightning,
  Keyboard,
  Lifebuoy,
  ListBullets,
  ListMagnifyingGlass,
  MagicWand,
  MagnifyingGlass,
  Monitor,
  Package,
  Palette,
  Play,
  PencilSimple,
  Plugs,
  PuzzlePiece,
  Pulse,
  RocketLaunch,
  Sparkle,
  SquaresFour,
  ShieldCheck,
  TerminalWindow,
  TestTube,
  TreeStructure,
  Wrench,
} as const;

export function hasDocsIcon(name: string): boolean {
  return name in icons;
}

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
