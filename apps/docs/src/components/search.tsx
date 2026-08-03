"use client";

import { create } from "@orama/orama";
import { useDocsSearch } from "fumadocs-core/search/client";
import { oramaStaticClient } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { usePathname } from "next/navigation";
import { localeFromPath } from "@/lib/i18n";

const basePath = process.env["NEXT_PUBLIC_BASE_PATH"] ?? "";
const searchEndpoint = `${basePath}/api/search`;

function initOrama(_locale?: string) {
  return create({
    language: "english",
    schema: { _: "string" },
  });
}

export default function StaticSearchDialog(props: SharedProps) {
  const locale = localeFromPath(usePathname());
  const { query, search, setSearch } = useDocsSearch({
    client: oramaStaticClient({
      from: searchEndpoint,
      initOrama,
      locale,
    }),
  });

  return (
    <SearchDialog
      isLoading={query.isLoading}
      onSearchChange={setSearch}
      search={search}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== "empty" ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
