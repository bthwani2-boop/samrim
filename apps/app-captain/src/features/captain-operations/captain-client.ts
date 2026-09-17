import * as Crypto from "expo-crypto";

import { createDshMobileClient } from "@bthwani/dsh";

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

export function captainClient() {
  return createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });
}
