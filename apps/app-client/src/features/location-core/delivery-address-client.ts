
import {
  type CreateDeliveryAddressRequest,
  type DeliveryAddressListResponse,
  type DeliveryAddressResponse,
  type UpdateDeliveryAddressRequest,
} from "@bthwani/dsh";
import { createClientDsh } from "../../bootstrap/dsh";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

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
  return token().then((value) => createClientDsh().listOwnDeliveryAddresses(value, 50, cursor));
}

export function createOwnDeliveryAddress(input: CreateDeliveryAddressRequest, actorID: string): Promise<DeliveryAddressResponse> {
  return tokenForActor(actorID).then((value) => createClientDsh().createOwnDeliveryAddress(value, input));
}

export function updateOwnDeliveryAddress(addressID: string, input: UpdateDeliveryAddressRequest, expectedVersion: number, actorID: string): Promise<DeliveryAddressResponse> {
  return tokenForActor(actorID).then((value) => createClientDsh().updateOwnDeliveryAddress(value, addressID, input, expectedVersion));
}

export function isLocationHttpError(error: unknown, status: number): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && value.status === status;
}
