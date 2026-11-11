import type { DiscoveryContentEventRequest, DiscoveryContentListResponse, DiscoveryContentTargetResolution, PromotionListResponse, PublicCatalogResponse, PublicCatalogSearchResponse, PublicStoreOrderabilityResponse, PublicStoreView, PublishedStoreListResponse } from "@bthwani/dsh";
import { clientDshBaseURL, createClientDsh } from "../../bootstrap/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { tokenForClientSession } from "../access/client-request-token";

export async function listPublishedStores(serviceCityID: string, options: Readonly<{
  q?: string;
  verticalId?: string;
  categoryId?: string;
  shortcutId?: string;
  favoritesOnly?: boolean;
  sort?: "all" | "newest" | "nearest";
  limit?: number;
  cursor?: string;
  location?: Readonly<{ latitude: number; longitude: number }> | undefined;
}> = {}): Promise<PublishedStoreListResponse> {
  if (options.favoritesOnly) {
    const accessToken = await getUsableIdentityAccessToken();
    return createClientDsh().listPublishedStores(serviceCityID, { ...options, accessToken });
  }
  return createClientDsh().listPublishedStores(serviceCityID, options);
}

export async function readPublicStudioLayout() {
  return createClientDsh().readPublicStudioLayout();
}

export async function listPublicPromotions(serviceCityID: string, storeID = ""): Promise<PromotionListResponse> {
  return createClientDsh().listPublicPromotions(serviceCityID, storeID);
}

export type BannerPresentation = Readonly<{ placement: "HOME"; mode: "STATIC" | "CINEMATIC" | "CROSSFADE"; intervalSeconds: number; version: number }>;
export async function readPublicBannerPresentation(): Promise<BannerPresentation> {
  const response = await fetch(`${clientDshBaseURL()}/dsh/public/banner-presentation`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("BANNER_PRESENTATION_UNAVAILABLE");
  const value = await response.json() as BannerPresentation;
  if (!["STATIC", "CINEMATIC", "CROSSFADE"].includes(value.mode) || !Number.isInteger(value.intervalSeconds) || value.intervalSeconds < 3 || value.intervalSeconds > 10) throw new Error("BANNER_PRESENTATION_INVALID");
  return value;
}

export async function listPublicDiscoveryContent(serviceCityID: string): Promise<DiscoveryContentListResponse> {
  return createClientDsh().listPublicDiscoveryContent(serviceCityID);
}

export async function listPublicStoreBanners(storeID: string, serviceCityID: string, relation: "marketplace" | "independent" = "marketplace"): Promise<DiscoveryContentListResponse> {
  // Both sites reuse the DSH Discovery Content reader and its publication rules.
  return await createClientDsh().listPublicStoreBanners(storeID, serviceCityID, relation);
}

export async function resolvePublicDiscoveryContentTarget(contentID: string, serviceCityID: string): Promise<DiscoveryContentTargetResolution> {
  return createClientDsh().resolvePublicDiscoveryContentTarget(contentID, serviceCityID);
}

export async function recordPublicDiscoveryContentEvent(input: DiscoveryContentEventRequest): Promise<void> {
  const accessToken = input.eventType === "CONVERSION" ? await getUsableIdentityAccessToken() : "";
  await createClientDsh().recordPublicDiscoveryContentEvent(input, accessToken);
}

export async function listFavoriteStoreIDs(): Promise<ReadonlyArray<string>> {
  const accessToken = await getUsableIdentityAccessToken();
  return (await createClientDsh().listClientFavoriteStores(accessToken)).storeIds;
}

export async function setFavoriteStore(storeID: string, isFavorite: boolean, sessionKey: string): Promise<boolean> {
  const accessToken = await tokenForClientSession(sessionKey);
  const result = isFavorite ? await createClientDsh().addClientFavoriteStore(accessToken, storeID) : await createClientDsh().removeClientFavoriteStore(accessToken, storeID);
  return result.isFavorite;
}

export async function listFavoriteStoreOfferIDs(storeID: string): Promise<ReadonlyArray<string>> {
  const accessToken = await getUsableIdentityAccessToken();
  return (await createClientDsh().listClientFavoriteStoreOffers(accessToken, storeID)).offerIds;
}

export async function setFavoriteStoreOffer(storeOfferID: string, isFavorite: boolean, sessionKey: string): Promise<boolean> {
  const accessToken = await tokenForClientSession(sessionKey);
  const result = isFavorite
    ? await createClientDsh().addClientFavoriteStoreOffer(accessToken, storeOfferID)
    : await createClientDsh().removeClientFavoriteStoreOffer(accessToken, storeOfferID);
  return result.isFavorite;
}

export async function readFavoriteStoreCatalog(storeID: string, serviceCityID: string, limit = 20, cursor = ""): Promise<PublicCatalogResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return createClientDsh().readClientFavoriteStoreCatalog(accessToken, storeID, serviceCityID, limit, cursor);
}

export async function readPublishedStore(storeID: string, serviceCityID: string): Promise<PublicStoreView> {
  return createClientDsh().readPublishedStore(storeID, serviceCityID);
}

export async function readStorePublicContact(storeID: string) {
  return createClientDsh().readPublishedStorePublicContact(storeID);
}

export async function readPublicStoreOrderability(storeID: string, serviceCityID: string): Promise<PublicStoreOrderabilityResponse> {
  return createClientDsh().readPublicStoreOrderability(storeID, serviceCityID);
}

export async function readPublicStoreCatalog(storeID: string, serviceCityID: string, categoryID = "", query = "", limit = 20, cursor = "", productID = "", sort: "" | "MOST_ORDERED_30_DAYS" = ""): Promise<PublicCatalogResponse> {
  return createClientDsh().readPublicStoreCatalog(storeID, serviceCityID, categoryID, query, limit, cursor, productID, sort);
}

export async function searchPublicCatalog(serviceCityID: string, query: string, categoryID = "", limit = 20, cursor = "", verticalID = "", shortcutID = "", sort: "" | "PRICE_ASC" | "PRICE_DESC" = ""): Promise<PublicCatalogSearchResponse> {
  return createClientDsh().searchPublicCatalog(serviceCityID, query, categoryID, limit, cursor, verticalID, shortcutID, sort);
}
