import type { CatalogStoreOffer } from "@bthwani/dsh";

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

/** A published offer is exhausted only when DSH tracks bounded stock and every unit is reserved or sold. */
export function isOfferStockout(offer: Pick<CatalogStoreOffer,
  "publicationState" | "inventoryPolicy" | "inventoryOnHandBaseUnits" | "inventoryReservedBaseUnits">): boolean {
  return offer.publicationState === "published" && offer.inventoryPolicy === "QUANTITY_ON_HAND"
    && offer.inventoryOnHandBaseUnits <= offer.inventoryReservedBaseUnits;
}

/** A paginated DSH response can prove that an available offer exists, but not that none exists. */
export function catalogPublishedAvailability(
  offers: ReadonlyArray<Pick<CatalogStoreOffer, "publicationState" | "availability">> | null,
  hasMore: boolean,
): boolean | null {
  if (offers === null) return null;
  if (offers.some((offer) => offer.publicationState === "published" && offer.availability)) return true;
  return hasMore ? null : false;
}
