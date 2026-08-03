import type { TuilRuntime } from "@mwillbanks/tuil";

export interface TuilGhosttyStoryOptions {
  readonly storyId: string;
  readonly variant: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly controls?: Readonly<Record<string, unknown>>;
}

export function createTuilGhosttyStoryApp(
  options: TuilGhosttyStoryOptions,
): TuilRuntime;
