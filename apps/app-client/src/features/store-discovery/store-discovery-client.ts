import { type CartResponse, type CatalogStoreOffer, type ClientOpenCartListResponse, createDshMobileClient, type DiscoveryContentEventRequest, type DiscoveryContentListResponse, type DiscoveryContentTargetResolution, type MultiStoreCheckoutRequest, type MultiStoreCheckoutResponse, type PromotionListResponse, type PublicCatalogResponse, type PublicCatalogSearchResponse, type PublicStoreView, type PublishedStoreListResponse, type ServiceabilityResponse } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { listOwnDeliveryAddresses } from "../location-core/delivery-address-client";

function dshBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(dshBaseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

export async function listPublishedStores(serviceCityID: string, location?: Readonly<{ latitude: number; longitude: number }>): Promise<PublishedStoreListResponse> {
  return client().listPublishedStores(serviceCityID, location);
}

export async function listPublicPromotions(serviceCityID: string, storeID = ""): Promise<PromotionListResponse> {
  return client().listPublicPromotions(serviceCityID, storeID);
}

export async function listPublicDiscoveryContent(serviceCityID: string): Promise<DiscoveryContentListResponse> {
  return client().listPublicDiscoveryContent(serviceCityID);
}

export async function resolvePublicDiscoveryContentTarget(contentID: string, serviceCityID: string): Promise<DiscoveryContentTargetResolution> {
  return client().resolvePublicDiscoveryContentTarget(contentID, serviceCityID);
}

export async function recordPublicDiscoveryContentEvent(input: DiscoveryContentEventRequest): Promise<void> {
  const accessToken = input.eventType === "CONVERSION" ? await getUsableIdentityAccessToken() : "";
  await client().recordPublicDiscoveryContentEvent(input, accessToken);
}

export async function listFavoriteStoreIDs(): Promise<ReadonlyArray<string>> {
  const accessToken = await getUsableIdentityAccessToken();
  return (await client().listClientFavoriteStores(accessToken)).storeIds;
}

export async function setFavoriteStore(storeID: string, isFavorite: boolean): Promise<boolean> {
  const accessToken = await getUsableIdentityAccessToken();
  const result = isFavorite ? await client().addClientFavoriteStore(accessToken, storeID) : await client().removeClientFavoriteStore(accessToken, storeID);
  return result.isFavorite;
}

export async function listFavoriteStoreOfferIDs(storeID: string): Promise<ReadonlyArray<string>> {
  const accessToken = await getUsableIdentityAccessToken();
  return (await client().listClientFavoriteStoreOffers(accessToken, storeID)).offerIds;
}

export async function setFavoriteStoreOffer(storeOfferID: string, isFavorite: boolean): Promise<boolean> {
  const accessToken = await getUsableIdentityAccessToken();
  const result = isFavorite
    ? await client().addClientFavoriteStoreOffer(accessToken, storeOfferID)
    : await client().removeClientFavoriteStoreOffer(accessToken, storeOfferID);
  return result.isFavorite;
}

export async function readFavoriteStoreCatalog(storeID: string, serviceCityID: string, limit = 20, cursor = ""): Promise<PublicCatalogResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().readClientFavoriteStoreCatalog(accessToken, storeID, serviceCityID, limit, cursor);
}

export async function readPublishedStore(storeID: string, serviceCityID: string): Promise<PublicStoreView> {
  return client().readPublishedStore(storeID, serviceCityID);
}

export async function readPublicStoreCatalog(storeID: string, serviceCityID: string, categoryID = "", query = "", limit = 20, cursor = "", productID = ""): Promise<PublicCatalogResponse> {
  return client().readPublicStoreCatalog(storeID, serviceCityID, categoryID, query, limit, cursor, productID);
}

export async function searchPublicCatalog(serviceCityID: string, query: string, categoryID = "", limit = 20, cursor = ""): Promise<PublicCatalogSearchResponse> {
  return client().searchPublicCatalog(serviceCityID, query, categoryID, limit, cursor);
}

export async function evaluateStoreServiceability(storeID: string, addressID: string): Promise<ServiceabilityResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().evaluateServiceability(accessToken, storeID, addressID);
}

export async function listOwnOpenCarts(): Promise<ClientOpenCartListResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().listClientOpenCarts(accessToken);
}

export async function readOwnOpenCart(storeID: string): Promise<CartResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().readOpenCart(accessToken, storeID);
}

export async function createMultiStoreCheckout(input: MultiStoreCheckoutRequest, idempotencyKey: string, correlationID: string): Promise<MultiStoreCheckoutResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().createMultiStoreCheckout(accessToken, input, idempotencyKey, correlationID);
}

export async function readOwnMultiStoreCheckout(checkoutID: string): Promise<MultiStoreCheckoutResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().readMultiStoreCheckout(accessToken, checkoutID);
}

export async function cancelMultiStoreCheckout(checkoutID: string, expectedVersion: number, idempotencyKey: string, correlationID: string): Promise<MultiStoreCheckoutResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().cancelMultiStoreCheckout(accessToken, checkoutID, expectedVersion, idempotencyKey, correlationID);
}

export async function addCatalogOfferToCart(
  storeID: string,
  offer: CatalogStoreOffer,
  quantityBaseUnits: number,
  selectedModifierOptionIds: ReadonlyArray<string>,
): Promise<CartResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  let expectedVersion = 0;
  try {
    expectedVersion = (await client().readOpenCart(accessToken, storeID)).cart.version;
  } catch (error) {
    const notFound = error && typeof error === "object" && (error as { kind?: unknown; status?: unknown }).kind === "http" && (error as { status?: unknown }).status === 404;
    if (!notFound) throw error;
  }
  return client().upsertCartLine(accessToken, { storeId: storeID, storeOfferId: offer.offerId, quantityBaseUnits, selectedModifierOptionIds }, expectedVersion);
}

export { listOwnDeliveryAddresses };
