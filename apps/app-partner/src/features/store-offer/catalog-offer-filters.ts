/** Only screen modes needing a canonical Store-wide query use DSH's existing filtered offer registry. */
export type StoreOfferListFilter = "all" | "popular" | "offers" | "published" | "unavailable" | "hidden" | "stockout";
export type StoreOfferQuery = Readonly<{
  q?: string;
  availability?: "available" | "unavailable";
  publicationState?: "published" | "not_published";
  inventoryStatus?: "stockout";
}>;

/** null means use the existing unfiltered owner page (or the separate promotions/popularity surface). */
export function storeOfferServerQuery(filter: StoreOfferListFilter, rawQuery: string): StoreOfferQuery | null {
  if (filter === "offers" || filter === "popular") return null;
  const q = rawQuery.trim();
  if (filter === "all" && !q) return null;
  const base = q ? { q: q.slice(0, 160) } : {};
  if (filter === "published") return { ...base, publicationState: "published", availability: "available" };
  if (filter === "unavailable") return { ...base, availability: "unavailable" };
  if (filter === "hidden") return { ...base, publicationState: "not_published" };
  if (filter === "stockout") return { ...base, inventoryStatus: "stockout" };
  return base;
}
