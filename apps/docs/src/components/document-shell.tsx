import type { ReactNode } from "react";
import { Providers } from "@/components/providers";

export function DocumentShell(props: {
  readonly bodyClassName: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={props.bodyClassName}>
        <Providers locale="en">{props.children}</Providers>
      </body>
    </html>
  );
}
