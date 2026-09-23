import * as Crypto from "expo-crypto";
import { createDshMobileClient, type CommerceVertical, type JoiningCaseResponse, type ServiceCity, type StoreFulfillmentMode, type StoreFulfillmentModesResponse } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function dshBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!explicit) throw new Error("DSH_BASE_URL_REQUIRED");
  return explicit;
}

function dshClient() {
  return createDshMobileClient(dshBaseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });
}

const accessToken = getUsableIdentityAccessToken;

export async function readOwnJoiningCase(): Promise<JoiningCaseResponse> {
  return accessToken().then((token) => dshClient().readOwnJoiningCase(token));
}

export async function correctAndResubmitOwnJoiningCase(caseID: string, businessName: string, firstStoreName: string, serviceCityId: string, firstStoreVerticalId: string, firstStoreLatitude: number, firstStoreLongitude: number, expectedVersion: number): Promise<JoiningCaseResponse> {
  return accessToken().then((token) => dshClient().correctAndResubmitJoiningCase(token, caseID, { businessName, firstStoreName, serviceCityId, firstStoreVerticalId, firstStoreLatitude, firstStoreLongitude }, expectedVersion));
}

export async function updateOwnStoreFulfillmentModes(storeID: string, fulfillmentModes: ReadonlyArray<StoreFulfillmentMode>, expectedVersion: number): Promise<StoreFulfillmentModesResponse> {
  const token = await accessToken();
  return dshClient().setStoreFulfillmentModes(token, storeID, { fulfillmentModes }, expectedVersion);
}

export function listActiveServiceCities(): Promise<ReadonlyArray<ServiceCity>> {
  return dshClient().listActiveServiceCities();
}

export function listCatalogVerticals(): Promise<ReadonlyArray<CommerceVertical>> {
  return dshClient().listCatalogVerticals();
}

export function isJoiningCaseNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { kind?: unknown; status?: unknown };
  return candidate.kind === "http" && candidate.status === 404;
}
