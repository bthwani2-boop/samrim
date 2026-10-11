"use client";

import { useSession } from "../../session/session-provider";
import { CatalogCategoryTrash } from "./catalog-category-trash";
import { CatalogTrash } from "./catalog-trash";
import { StoreTrash } from "./store-trash";

export function TrashContents() {
  const { state } = useSession();
  if (state.kind !== "authenticated" || state.identity.role !== "operator") return null;
  const permissions = state.identity.permissions ?? [];
  return <>
    {permissions.includes("catalog") ? <><CatalogTrash /><CatalogCategoryTrash /></> : null}
    {permissions.includes("partners") ? <StoreTrash /> : null}
  </>;
}
