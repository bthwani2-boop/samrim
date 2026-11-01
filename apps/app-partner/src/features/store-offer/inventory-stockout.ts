import type { CatalogStoreOffer } from "@bthwani/dsh";

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
