import { type CommerceVertical, createDshMobileClient, type DshImageUploadInput, type JoiningCaseResponse, type ServiceCity, type StoreCaptainInvitationResponse, type StoreCaptainMembershipListResponse, type StoreCaptainMembershipResponse, type StoreCaptainMembershipTransitionRequest } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
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
	const identity = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, [caseID.trim(), businessName.trim(), firstStoreName.trim(), serviceCityId.trim(), firstStoreVerticalId.trim(), String(firstStoreLatitude), String(firstStoreLongitude), String(expectedVersion)].join("\u0000"));
	const token = await accessToken();
	return dshClient().correctAndResubmitJoiningCase(token, caseID, { businessName, firstStoreName, serviceCityId, firstStoreVerticalId, firstStoreLatitude, firstStoreLongitude }, expectedVersion, `partner_case_correction_${identity}`, `partner_case_correction_corr_${identity}`);
}

export async function uploadOwnJoiningCaseStoreImage(caseID: string, image: DshImageUploadInput, expectedVersion: number, idempotencyKey: string, correlationID: string): Promise<JoiningCaseResponse> {
  const token = await accessToken();
  return dshClient().uploadJoiningCaseStoreImage(token, caseID, image, expectedVersion, idempotencyKey, correlationID);
}

export async function listOwnStoreCaptainMemberships(storeID: string): Promise<StoreCaptainMembershipListResponse> {
  const token = await accessToken();
  return dshClient().listPartnerStoreCaptainMemberships(token, storeID);
}

export async function createOwnStoreCaptainInvitation(storeID: string): Promise<StoreCaptainInvitationResponse> {
  const token = await accessToken();
  return dshClient().createPartnerStoreCaptainInvitation(token, storeID);
}

export async function transitionOwnStoreCaptainMembership(storeID: string, membershipID: string, state: StoreCaptainMembershipTransitionRequest["state"], expectedVersion: number): Promise<StoreCaptainMembershipResponse> {
  const token = await accessToken();
  return dshClient().transitionPartnerStoreCaptainMembership(token, storeID, membershipID, { state }, expectedVersion);
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
