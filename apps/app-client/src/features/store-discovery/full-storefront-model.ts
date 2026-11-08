import type { PublicCatalogResponse, PublicStoreView } from "@bthwani/dsh";

// Marketplace publication and the Store relation are enforced by DSH's public
// Store and catalog readers. This check prevents accidental cross-Store/city
// composition if a stale response is returned during navigation.
export function verifiedMarketplaceStoreRead(
  store: Pick<PublicStoreView, "id" | "publishedAt" | "serviceCity">,
  catalog: Pick<PublicCatalogResponse, "storeId">,
  storeID: string,
  cityID: string,
): boolean {
  return Boolean(storeID && cityID &&
    store.id === storeID && catalog.storeId === storeID &&
    store.serviceCity.id === cityID && store.serviceCity.active === true &&
    store.publishedAt?.trim());
}

export function visiblePublishedOffers(
  offers: PublicCatalogResponse["offers"],
  storeID: string,
): PublicCatalogResponse["offers"] {
  return offers.filter((offer) =>
    offer.storeId === storeID &&
    offer.publicationState === "published" &&
    offer.productActive && offer.variantActive,
  );
}

export function storefrontColumns(width: number): number {
  if (width < 360) return 1;
  if (width < 720) return 2;
  if (width < 1200) return 3;
  return 4;
}
