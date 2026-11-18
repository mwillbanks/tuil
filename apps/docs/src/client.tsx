import type { MDXContent } from "mdx/types";
import { restoreElements } from "./lib/static-route";
import { hydrateRoot } from "react-dom/client";
import { loadDocument } from "tuil:docs-content";
import { StaticApplication } from "./components/static-application";
import type { StaticRoute } from "./lib/static-types";

const data = document.getElementById("tuil-route-data");
const host = document.getElementById("tuil-root");
if (!data?.textContent || !host)
  throw new Error("Static route data is missing");
const route = restoreElements(JSON.parse(data.textContent)) as StaticRoute;
let body: MDXContent | undefined;
if (route.page) body = (await loadDocument(route.page.path)).default;
hydrateRoot(host, <StaticApplication route={route} body={body} />);
