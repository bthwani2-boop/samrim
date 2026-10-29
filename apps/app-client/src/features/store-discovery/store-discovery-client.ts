import { type CartResponse, type CatalogStoreOffer, type CheckoutQuoteResponse, type CheckoutRequest, type ClientOpenCartListResponse, createDshMobileClient, type DiscoveryContentEventRequest, type DiscoveryContentListResponse, type DiscoveryContentTargetResolution, type MultiStoreCheckoutRequest, type MultiStoreCheckoutResponse, type PromotionListResponse, type PublicCatalogResponse, type PublicCatalogSearchResponse, type PublicStoreOrderabilityResponse, type PublicStoreView, type PublishedStoreListResponse, type ServiceabilityResponse } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { listOwnDeliveryAddresses } from "../location-core/delivery-address-client";

function dshBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(dshBaseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

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
    return client().listPublishedStores(serviceCityID, { ...options, accessToken });
  }
  return client().listPublishedStores(serviceCityID, options);
}

export async function listPublicPromotions(serviceCityID: string, storeID = ""): Promise<PromotionListResponse> {
  return client().listPublicPromotions(serviceCityID, storeID);
}

export type BannerPresentation = Readonly<{ placement: "HOME"; mode: "STATIC" | "CINEMATIC" | "CROSSFADE"; intervalSeconds: number; version: number }>;
export async function readPublicBannerPresentation(): Promise<BannerPresentation> {
  const response = await fetch(`${dshBaseUrl()}/dsh/public/banner-presentation`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("BANNER_PRESENTATION_UNAVAILABLE");
  const value = await response.json() as BannerPresentation;
  if (!["STATIC", "CINEMATIC", "CROSSFADE"].includes(value.mode) || !Number.isInteger(value.intervalSeconds) || value.intervalSeconds < 3 || value.intervalSeconds > 10) throw new Error("BANNER_PRESENTATION_INVALID");
  return value;
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

export async function readPublicStoreOrderability(storeID: string, serviceCityID: string): Promise<PublicStoreOrderabilityResponse> {
  return client().readPublicStoreOrderability(storeID, serviceCityID);
}

export async function readPublicStoreCatalog(storeID: string, serviceCityID: string, categoryID = "", query = "", limit = 20, cursor = "", productID = "", sort: "" | "MOST_ORDERED_30_DAYS" = ""): Promise<PublicCatalogResponse> {
  return client().readPublicStoreCatalog(storeID, serviceCityID, categoryID, query, limit, cursor, productID, sort);
}

export async function searchPublicCatalog(serviceCityID: string, query: string, categoryID = "", limit = 20, cursor = "", verticalID = "", shortcutID = ""): Promise<PublicCatalogSearchResponse> {
  return client().searchPublicCatalog(serviceCityID, query, categoryID, limit, cursor, verticalID,shortcutID);
}

export async function evaluateStoreServiceability(storeID: string, addressID: string): Promise<ServiceabilityResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().evaluateServiceability(accessToken, storeID, addressID);
}

export async function listOwnOpenCarts(): Promise<ClientOpenCartListResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().listClientOpenCarts(accessToken);
}

export async function quoteMultiStoreChildCheckout(input: CheckoutRequest, expectedCartVersion: number): Promise<CheckoutQuoteResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().quoteCheckout(accessToken, input, expectedCartVersion);
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

export async function readOwnStoreCart(storeID: string): Promise<CartResponse | null> {
  const accessToken = await getUsableIdentityAccessToken();
  try {
    return await client().readOpenCart(accessToken, storeID);
  } catch (error) {
    const notFound = error && typeof error === "object" && (error as { kind?: unknown; status?: unknown }).kind === "http" && (error as { status?: unknown }).status === 404;
    if (notFound) return null;
    throw error;
  }
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

/** Update one simple, discrete home offer using DSH's authoritative cart version. */
export async function adjustSimpleOfferQuantity(storeID: string, offer: CatalogStoreOffer, direction: 1 | -1): Promise<CartResponse> {
  if (offer.quantityPolicy !== "DISCRETE" || offer.modifierGroups.length > 0 || !offer.availability) {
    throw new Error("HOME_OFFER_REQUIRES_DETAIL");
  }
  const accessToken = await getUsableIdentityAccessToken();
  let current: CartResponse | null = null;
  try {
    current = await client().readOpenCart(accessToken, storeID);
  } catch (error) {
    const missing = error && typeof error === "object" && (error as { status?: unknown }).status === 404;
    if (!missing) throw error;
  }
  const line = current?.cart.lines.find((item) => item.storeOfferId === offer.offerId);
  if (direction === -1 && !line) throw new Error("HOME_OFFER_NOT_IN_CART");
  if (direction === -1 && line && line.quantityBaseUnits <= offer.quantityMinBaseUnits) {
    return client().removeCartLine(accessToken, line.id, current!.cart.version);
  }
  const quantityBaseUnits = line
    ? line.quantityBaseUnits + direction * offer.quantityStepBaseUnits
    : offer.quantityMinBaseUnits;
  if (!Number.isSafeInteger(quantityBaseUnits) || quantityBaseUnits < offer.quantityMinBaseUnits || quantityBaseUnits > offer.quantityMaxBaseUnits) {
    throw new Error("HOME_OFFER_QUANTITY_LIMIT");
  }
  return client().upsertCartLine(
    accessToken,
    { storeId: storeID, storeOfferId: offer.offerId, quantityBaseUnits, selectedModifierOptionIds: [] },
    current?.cart.version ?? 0,
  );
}

export { listOwnDeliveryAddresses };
