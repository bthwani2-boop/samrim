import { createDshMobileClient } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";

/** Shared Client-only SDK wiring. DSH owns the transport contract and all business facts. */
export function clientDshBaseURL(): string {
  const baseURL = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseURL) throw new Error("DSH_BASE_URL_REQUIRED");
  return baseURL;
}

/** Construct per operation; never cache an SDK client or actor/session credentials. */
export function createClientDsh() {
  return createDshMobileClient(clientDshBaseURL(), { cryptoRandomUUID: () => Crypto.randomUUID() });
}
