import * as Crypto from "expo-crypto";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type StoreCommercialAgreementRate = Readonly<{
  fulfillmentMode: string;
  commissionRateBps: number;
}>;

export type StoreCommercialAgreement = Readonly<{
  agreementId: string;
  storeId: string;
  partnerActorId: string;
  agreementVersion: number;
  status: string;
  rates: ReadonlyArray<StoreCommercialAgreementRate>;
  partnerAcceptedByActorId?: string | null;
  partnerAcceptedAt?: string | null;
}>;

export type StoreCommercialAgreementAcceptance = Readonly<{
  expectedAgreementVersion: number;
  reason: string;
}>;

type DshErrorPayload = Readonly<{
  error?: Readonly<{ code?: unknown; message?: unknown }>;
}>;

class StoreCommercialAgreementRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "StoreCommercialAgreementRequestError";
    this.status = status;
    this.code = code;
  }
}

function dshBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!configured) throw new Error("DSH_BASE_URL_REQUIRED");
  return configured.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgreement(value: unknown): value is StoreCommercialAgreement {
  if (!isRecord(value) || typeof value.agreementId !== "string" || !value.agreementId.trim() ||
    typeof value.storeId !== "string" || !value.storeId.trim() ||
    typeof value.partnerActorId !== "string" || !value.partnerActorId.trim() ||
    !Number.isSafeInteger(value.agreementVersion) || Number(value.agreementVersion) < 1 ||
    typeof value.status !== "string" || !Array.isArray(value.rates)) return false;
  return value.rates.every((rate) => isRecord(rate) && typeof rate.fulfillmentMode === "string" &&
    rate.fulfillmentMode.trim().length > 0 && Number.isSafeInteger(rate.commissionRateBps) &&
    Number(rate.commissionRateBps) >= 0 && Number(rate.commissionRateBps) <= 10_000);
}

async function request<T>(path: string, method: "GET" | "POST", body?: unknown, mutation?: Readonly<{ idempotencyKey: string; correlationID: string }>): Promise<T> {
  const token = await getUsableIdentityAccessToken();
  const response = await fetch(`${dshBaseUrl()}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(mutation ? { "Idempotency-Key": mutation.idempotencyKey, "X-Correlation-ID": mutation.correlationID } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(payload) ? (payload as DshErrorPayload).error : undefined;
    throw new StoreCommercialAgreementRequestError(
      response.status,
      typeof error?.code === "string" ? error.code : "DSH_REQUEST_FAILED",
      typeof error?.message === "string" ? error.message : "DSH commercial agreement request failed",
    );
  }
  return payload as T;
}

export async function readOwnStoreCommercialAgreements(storeID: string): Promise<ReadonlyArray<StoreCommercialAgreement>> {
  const normalizedStoreID = storeID.trim();
  if (!normalizedStoreID) throw new StoreCommercialAgreementRequestError(400, "INVALID_INPUT", "Store is required");
  const payload = await request<{ agreements?: unknown }>(`/dsh/partner/stores/${encodeURIComponent(normalizedStoreID)}/commercial-agreements`, "GET");
  if (!Array.isArray(payload?.agreements) || !payload.agreements.every(isAgreement)) {
    throw new StoreCommercialAgreementRequestError(502, "INVALID_RESPONSE", "DSH returned an invalid Store commercial agreement list");
  }
  if (payload.agreements.some((agreement) => agreement.storeId !== normalizedStoreID)) {
    throw new StoreCommercialAgreementRequestError(502, "STORE_SCOPE_MISMATCH", "DSH returned an agreement for another Store");
  }
  return payload.agreements;
}

export async function acceptOwnStoreCommercialAgreement(
  storeID: string,
  agreementId: string,
  input: StoreCommercialAgreementAcceptance,
  idempotencyKey: string,
  correlationID: string,
): Promise<StoreCommercialAgreement> {
  const normalizedStoreID = storeID.trim();
  if (!normalizedStoreID) throw new StoreCommercialAgreementRequestError(400, "INVALID_INPUT", "Store is required");
  const payload = await request<{ agreement?: unknown }>(
    `/dsh/partner/stores/${encodeURIComponent(normalizedStoreID)}/commercial-agreements/${encodeURIComponent(agreementId)}/accept`,
    "POST",
    input,
    { idempotencyKey, correlationID },
  );
  if (!isAgreement(payload?.agreement)) {
    throw new StoreCommercialAgreementRequestError(502, "INVALID_RESPONSE", "DSH returned an invalid Store commercial agreement acceptance");
  }
  if (payload.agreement.storeId !== normalizedStoreID) {
    throw new StoreCommercialAgreementRequestError(502, "STORE_SCOPE_MISMATCH", "DSH returned an agreement for another Store");
  }
  return payload.agreement;
}

export function newStoreAgreementMutationKeys(): Readonly<{ idempotencyKey: string; correlationID: string }> {
  return {
    idempotencyKey: `partner_store_agreement_accept_${Crypto.randomUUID()}`,
    correlationID: `partner_store_agreement_accept_corr_${Crypto.randomUUID()}`,
  };
}
