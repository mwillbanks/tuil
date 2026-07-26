import Image from "next/image";

const basePath = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";

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
