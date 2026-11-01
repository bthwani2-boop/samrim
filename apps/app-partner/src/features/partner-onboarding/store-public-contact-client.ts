import { createDshMobileClient, type StorePublicContactInput } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!url) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() });
}
export async function readPartnerStoreContact(storeID: string) {
  const token = await getUsableIdentityAccessToken();
  return client().readPartnerStorePublicContact(token, storeID);
}
export async function savePartnerStoreContact(storeID: string, input: StorePublicContactInput, key: string, correlation: string) {
  const token = await getUsableIdentityAccessToken();
  return client().updatePartnerStorePublicContact(token, storeID, input, key, correlation);
}
