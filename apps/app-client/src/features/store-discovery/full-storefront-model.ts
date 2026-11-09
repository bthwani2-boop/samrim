import type { PublicCatalogResponse, PublicStoreView, ServiceCity } from "@bthwani/dsh";

export function buildFullStorefrontPath(
  storeID: string,
  cityID: string,
  scope: Readonly<{ categoryID?: string; productID?: string; query?: string }> = {},
): string {
  const params = new URLSearchParams({ serviceCityId: cityID });
  if (scope.productID) {
    params.set("productId", scope.productID);
  } else {
    if (scope.categoryID) params.set("categoryId", scope.categoryID);
    if (scope.query?.trim()) params.set("q", scope.query.trim());
  }
  return `/storefront/${encodeURIComponent(storeID)}?${params}`;
}

export function resolveFullStorefrontCityID(
  linkedCityID: string,
  savedCityID: string | null,
  cities: ReadonlyArray<Pick<ServiceCity, "id" | "active">>,
): string | null {
  if (!linkedCityID) return savedCityID;
  return cities.some((city) => city.id === linkedCityID && city.active) ? linkedCityID : null;
}

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
  productID = "",
): PublicCatalogResponse["offers"] {
  return offers.filter((offer) =>
    offer.storeId === storeID &&
    (!productID || offer.productId === productID) &&
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
