import { type CommercialStoreType, type CommerceVertical, createDshMobileClient, type CorrectJoiningCaseRequest, type DshImageUploadInput, type JoiningCaseResponse, type MediaProvenanceInput, type PartnerAccessibleStorePage, type PartnerStoreOperationalAvailabilityMutationResponse, type PartnerStoreOperationalAvailabilityResponse, type ServiceCity, type StoreAccessGrantListResponse, type StoreAccessGrantMutationResponse, type StoreAccessGrantPermissionsRequest, type StoreAccessGrantTransitionRequest, type StoreAccessInvitationCreateRequest, type StoreAccessInvitationDecisionRequest, type StoreAccessPermission, type StoreCaptainInvitationResponse, type StoreCaptainMembershipListResponse, type StoreCaptainMembershipResponse, type StoreCaptainMembershipTransitionRequest, type StoreOperationalAvailabilityRequest } from "@bthwani/dsh";
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

type OwnJoiningCaseCorrection = Readonly<{
  caseID: string;
  input: CorrectJoiningCaseRequest;
  expectedVersion: number;
}>;

export async function readOwnJoiningCase(): Promise<JoiningCaseResponse> {
  return accessToken().then((token) => dshClient().readOwnJoiningCase(token));
}

export async function listPartnerAccessibleStores(cursor = ""): Promise<PartnerAccessibleStorePage> {
  const token = await accessToken();
  return dshClient().listPartnerAccessibleStores(token, 50, cursor);
}

export async function listOwnStoreAccessGrants(storeID: string): Promise<StoreAccessGrantListResponse> {
  const token = await accessToken();
  return dshClient().listPartnerStoreAccessGrants(token, storeID);
}

export async function createOwnStoreAccessInvitation(storeID: string, input: StoreAccessInvitationCreateRequest, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
  const token = await accessToken();
  return dshClient().createPartnerStoreAccessInvitation(token, storeID, input, idempotencyKey, correlationID);
}

export async function transitionOwnStoreAccessGrant(storeID: string, grantID: string, input: StoreAccessGrantTransitionRequest, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
  const token = await accessToken();
  return dshClient().transitionPartnerStoreAccessGrant(token, storeID, grantID, input, idempotencyKey, correlationID);
}

export async function updateOwnStoreAccessPermissions(storeID: string, grantID: string, permissions: ReadonlyArray<StoreAccessPermission>, expectedVersion: number, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
  const token = await accessToken();
  const input: StoreAccessGrantPermissionsRequest = { permissions: [...permissions], expectedVersion };
  return dshClient().updatePartnerStoreAccessPermissions(token, storeID, grantID, input, idempotencyKey, correlationID);
}

export async function listOwnStoreAccessInvitations(): Promise<StoreAccessGrantListResponse> {
  const token = await accessToken();
  return dshClient().listActorStoreAccessInvitations(token);
}

export async function decideOwnStoreAccessInvitation(grantID: string, input: StoreAccessInvitationDecisionRequest, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
  const token = await accessToken();
  return dshClient().decideActorStoreAccessInvitation(token, grantID, input, idempotencyKey, correlationID);
}

export async function activateOwnStoreAccessInvitation(grantID: string, expectedVersion: number, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
  const token = await accessToken();
  return dshClient().activatePartnerStoreAccessInvitation(token, grantID, { expectedVersion }, idempotencyKey, correlationID);
}

export async function correctAndResubmitOwnJoiningCase({ caseID, input, expectedVersion }: OwnJoiningCaseCorrection): Promise<JoiningCaseResponse> {
	const token = await accessToken();
	return dshClient().correctAndResubmitJoiningCase(token, caseID, input, expectedVersion, `partner_case_correction_${Crypto.randomUUID()}`, `partner_case_correction_corr_${Crypto.randomUUID()}`);
}

export async function uploadOwnJoiningCaseProofImage(caseID: string, image: DshImageUploadInput, expectedVersion: number, idempotencyKey: string, correlationID: string): Promise<JoiningCaseResponse> {
  const token = await accessToken();
  return dshClient().uploadJoiningCaseProofImage(token, caseID, image, expectedVersion, idempotencyKey, correlationID);
}

export async function uploadOwnJoiningCaseStoreImage(caseID: string, image: DshImageUploadInput, provenance: MediaProvenanceInput, expectedVersion: number, idempotencyKey: string, correlationID: string): Promise<JoiningCaseResponse> {
  const token = await accessToken();
  return dshClient().uploadJoiningCaseStoreImage(token, caseID, image, provenance, expectedVersion, idempotencyKey, correlationID);
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

export async function readOwnStoreOperationalAvailability(storeID: string): Promise<PartnerStoreOperationalAvailabilityResponse> {
  const token = await accessToken();
  return dshClient().readPartnerStoreOperationalAvailability(token, storeID);
}

export async function updateOwnStoreOperationalAvailability(
  storeID: string,
  input: StoreOperationalAvailabilityRequest,
  idempotencyKey: string,
  correlationID: string,
): Promise<PartnerStoreOperationalAvailabilityMutationResponse> {
  const token = await accessToken();
  return dshClient().updatePartnerStoreOperationalAvailability(token, storeID, input, idempotencyKey, correlationID);
}

export function listActiveServiceCities(): Promise<ReadonlyArray<ServiceCity>> {
  return dshClient().listActiveServiceCities();
}

export function listCatalogVerticals(): Promise<ReadonlyArray<CommerceVertical>> {
  return dshClient().listCatalogVerticals();
}

export function listCommercialStoreTypes(verticalID: string): Promise<ReadonlyArray<CommercialStoreType>> {
  return dshClient().listCommercialStoreTypes(verticalID);
}

export function isJoiningCaseNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { kind?: unknown; status?: unknown };
  return candidate.kind === "http" && candidate.status === 404;
}
