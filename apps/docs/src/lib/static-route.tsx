import { createElement } from "react";

export function restoreElements(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreElements);
  if (value && typeof value === "object") {
    if ("__html" in value && typeof value.__html === "string") {
      return createElement("span", {
        dangerouslySetInnerHTML: { __html: value.__html },
      });
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, restoreElements(item)]),
    );
  }
  return value;
}
