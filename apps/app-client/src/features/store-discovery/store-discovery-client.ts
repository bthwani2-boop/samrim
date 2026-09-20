import { type CartResponse, type CatalogStoreOffer, createDshMobileClient, type PublicCatalogResponse, type PublicStoreView, type ServiceabilityResponse } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { listOwnDeliveryAddresses } from "../location-core/delivery-address-client";

function dshBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const client = () => createDshMobileClient(dshBaseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

export async function listPublishedStores(serviceCityID: string): Promise<ReadonlyArray<PublicStoreView>> {
  return client().listPublishedStores(serviceCityID);
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

export async function readPublishedStore(storeID: string, serviceCityID: string): Promise<PublicStoreView> {
  return client().readPublishedStore(storeID, serviceCityID);
}

export async function readPublicStoreCatalog(storeID: string, serviceCityID: string, categoryID = "", query = "", limit = 20, cursor = ""): Promise<PublicCatalogResponse> {
  return client().readPublicStoreCatalog(storeID, serviceCityID, categoryID, query, limit, cursor);
}

export async function evaluateStoreServiceability(storeID: string, addressID: string): Promise<ServiceabilityResponse> {
  const accessToken = await getUsableIdentityAccessToken();
  return client().evaluateServiceability(accessToken, storeID, addressID);
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
