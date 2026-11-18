import { FrameworkProvider, type ImageProps } from "fumadocs-core/framework";
import type { ComponentProps, ReactNode } from "react";
import { withBasePath } from "../lib/base-path";

function StaticLink({
  href,
  prefetch: _prefetch,
  ...props
}: ComponentProps<"a"> & { prefetch?: boolean }) {
  return <a {...props} href={href ? withBasePath(href) : href} />;
}
function StaticImage({ src, alt, priority, ...props }: ImageProps) {
  const url =
    typeof src === "string"
      ? src
      : src && ("default" in src ? src.default.src : src.src);
  return (
    <img
      {...props}
      src={url ? withBasePath(url) : url}
      alt={alt ?? ""}
      fetchPriority={priority ? "high" : undefined}
    />
  );
}
export function StaticFramework(props: {
  readonly pathname: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <FrameworkProvider
      Link={StaticLink}
      Image={StaticImage}
      usePathname={() => props.pathname}
      useParams={() => ({})}
      useRouter={() => ({
        push: (url: string) => {
          window.location.assign(withBasePath(url));
        },
        refresh: () => {
          window.location.reload();
        },
      })}
    >
      {props.children}
    </FrameworkProvider>
  );
}
