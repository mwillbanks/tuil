import { getBasePath } from "@/lib/base-path";
import type { ReactNode } from "react";

const basePath = getBasePath();

export default function RetiredSpanishDocumentation(): ReactNode {
  const destination = `${basePath}/docs`;
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${destination}`} />
      <link rel="canonical" href={destination} />
      <p>
        Documentation moved to <a href={destination}>Tuil Overview</a>.
      </p>
    </>
  );
}
