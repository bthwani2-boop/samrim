import { createDshMobileClient } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";

// Technical configuration only. DSH remains authoritative for Store, Order
// and catalog operations; Identity owns the token/session at each caller.
export function createPartnerDshClient() {
  const baseURL = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseURL) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseURL, { cryptoRandomUUID: () => Crypto.randomUUID() });
}
