import type { CatalogStoreOffer } from "@bthwani/dsh";

/** A published offer is exhausted only when DSH tracks bounded stock and every unit is reserved or sold. */
export function isOfferStockout(offer: Pick<CatalogStoreOffer,
  "publicationState" | "inventoryPolicy" | "inventoryOnHandBaseUnits" | "inventoryReservedBaseUnits">): boolean {
  return offer.publicationState === "published" && offer.inventoryPolicy === "QUANTITY_ON_HAND"
    && offer.inventoryOnHandBaseUnits <= offer.inventoryReservedBaseUnits;
}
