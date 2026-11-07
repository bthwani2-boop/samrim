import type { PartnerAccessibleStore } from "./partner-store-scope-context";

/** Authoring an independent Store's private banner drafts is owner-only.
 * Marketplace promotion capabilities and delegated Store grants do not confer it.
 * DSH still authorizes every mutation against the canonical Store owner. */
export function mayPrepareIndependentStoreBanners(
  store: Pick<PartnerAccessibleStore, "relationModel" | "owned"> | null | undefined,
): boolean {
  return store?.relationModel === "INDEPENDENT_STORE" && store.owned === true;
}
