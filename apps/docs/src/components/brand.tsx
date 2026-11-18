import { getBasePath } from "@/lib/base-path";
import { Image } from "fumadocs-core/framework";

const basePath = getBasePath();

export function Brand({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <span className={compact ? "brand brand-compact" : "brand"}>
      <Image
        alt=""
        aria-hidden="true"
        height={768}
        src={`${basePath}/logo.svg`}
        width={1024}
      />
      <span className="brand-copy">
        <strong
          className={
            compact ? "brand-wordmark brand-wordmark-compact" : "brand-wordmark"
          }
        >
          tuil
        </strong>
        {!compact && <small>TERMINAL UI LAYER</small>}
      </span>
    </span>
  );
}
