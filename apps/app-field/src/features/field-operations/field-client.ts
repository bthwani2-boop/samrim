import * as Crypto from "expo-crypto";

import { createDshMobileClient } from "@bthwani/dsh";

export function isMissingFieldAdmission(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { status?: unknown; code?: unknown; message?: unknown };
  return error.status === 404 && error.code === "NOT_FOUND" && error.message === "Field admission was not found";
}

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

export function fieldClient() {
  return createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });
}
