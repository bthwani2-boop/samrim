import * as Crypto from "expo-crypto";

import {
  createDshMobileClient,
  type CreateDeliveryAddressRequest,
  type DeliveryAddress,
  type DeliveryAddressResponse,
  type UpdateDeliveryAddressRequest,
} from "@bthwani/dsh";
import { readIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function token(): string {
  const value = readIdentityAccessToken();
  if (!value) throw new Error("DSH_CLIENT_SESSION_UNAVAILABLE");
  return value;
}

export function listOwnDeliveryAddresses(): Promise<ReadonlyArray<DeliveryAddress>> {
  return client().listOwnDeliveryAddresses(token());
}

export function createOwnDeliveryAddress(input: CreateDeliveryAddressRequest): Promise<DeliveryAddressResponse> {
  return client().createOwnDeliveryAddress(token(), input);
}

export function updateOwnDeliveryAddress(addressID: string, input: UpdateDeliveryAddressRequest, expectedVersion: number): Promise<DeliveryAddressResponse> {
  return client().updateOwnDeliveryAddress(token(), addressID, input, expectedVersion);
}

export function isLocationHttpError(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && value.status === status;
}
