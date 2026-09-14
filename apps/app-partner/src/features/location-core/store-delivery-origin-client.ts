import * as Crypto from "expo-crypto";

import { createDshMobileClient, type StoreDeliveryOriginResponse } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

const token = getUsableIdentityAccessToken;

export function readStoreDeliveryOrigin(storeID: string): Promise<StoreDeliveryOriginResponse> {
  return token().then((value) => client().readStoreDeliveryOrigin(value, storeID));
}

export function setStoreDeliveryOrigin(storeID: string, latitude: number, longitude: number, expectedVersion: number): Promise<StoreDeliveryOriginResponse> {
  return token().then((value) => client().setStoreDeliveryOrigin(value, storeID, { latitude, longitude }, expectedVersion));
}

export function isOriginHttpError(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && value.status === status;
}
