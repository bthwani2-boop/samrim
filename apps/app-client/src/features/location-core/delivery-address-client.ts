import * as Crypto from "expo-crypto";

import {
  createDshMobileClient,
  type CreateDeliveryAddressRequest,
  type DeliveryAddressListResponse,
  type DeliveryAddressResponse,
  type UpdateDeliveryAddressRequest,
} from "@bthwani/dsh";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(baseUrl, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

const token = getUsableIdentityAccessToken;

async function tokenForActor(expectedActorID: string): Promise<string> {
  const accessToken = await token();
  const session = currentIdentityState();
  if (!expectedActorID || session.kind !== "authenticated" || session.identity.subject.trim() !== expectedActorID) {
    throw new Error("CLIENT_ADDRESS_SESSION_CHANGED");
  }
  return accessToken;
}

export function listOwnDeliveryAddresses(cursor = ""): Promise<DeliveryAddressListResponse> {
  return token().then((value) => client().listOwnDeliveryAddresses(value, 50, cursor));
}

export function createOwnDeliveryAddress(input: CreateDeliveryAddressRequest, actorID: string): Promise<DeliveryAddressResponse> {
  return tokenForActor(actorID).then((value) => client().createOwnDeliveryAddress(value, input));
}

export function updateOwnDeliveryAddress(addressID: string, input: UpdateDeliveryAddressRequest, expectedVersion: number, actorID: string): Promise<DeliveryAddressResponse> {
  return tokenForActor(actorID).then((value) => client().updateOwnDeliveryAddress(value, addressID, input, expectedVersion));
}

export function isLocationHttpError(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && value.status === status;
}
