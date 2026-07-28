import type {
  RegistryIndexEntry,
  RegistryItem,
  RegistrySource,
} from "@mwillbanks/tuil-registry";
import { generatedRegistryItems } from "./generated-registry.ts";

export class BundledRegistrySource implements RegistrySource {
  readonly id = "tuil";
  readonly #items: Map<string, RegistryItem>;

  constructor() {
    this.#items = new Map(
      generatedRegistryItems.map((item) => [item.name, item as RegistryItem]),
    );
  }

  async get(name: string): Promise<RegistryItem | undefined> {
    return this.#items.get(name);
  }

  async list(): Promise<readonly RegistryIndexEntry[]> {
    return [...this.#items.values()].map((item) => ({
      name: item.name,
      type: item.type,
      title: item.title,
      description: item.description,
    }));
  }
}
