import * as Crypto from "expo-crypto";

import {
  createDshMobileClient,
  type CreateDeliveryAddressRequest,
  type DeliveryAddressListResponse,
  type DeliveryAddressResponse,
  type UpdateDeliveryAddressRequest,
} from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

const token = getUsableIdentityAccessToken;

export function listOwnDeliveryAddresses(cursor = ""): Promise<DeliveryAddressListResponse> {
  return token().then((value) => client().listOwnDeliveryAddresses(value, 50, cursor));
}

export function createOwnDeliveryAddress(input: CreateDeliveryAddressRequest): Promise<DeliveryAddressResponse> {
  return token().then((value) => client().createOwnDeliveryAddress(value, input));
}

export function updateOwnDeliveryAddress(addressID: string, input: UpdateDeliveryAddressRequest, expectedVersion: number): Promise<DeliveryAddressResponse> {
  return token().then((value) => client().updateOwnDeliveryAddress(value, addressID, input, expectedVersion));
}

export function isLocationHttpError(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && value.status === status;
}
