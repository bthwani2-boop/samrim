import { dshOperationPaths, type JoiningCaseResponse, type PublicationAction, type ReviewJoiningCaseRequest, type SetStoreCommercialTypeRequest, type SetStoreCommercialTypeResponse, type SetStoreFulfillmentModesRequest, type StoreFulfillmentModesResponse, type StorePublicationRequest, type StorePublicationResponse } from "@bthwani/dsh";
import { dshBaseUrl, dshToken, parseErrorPayload, requestDshJson, validateVersionedMutationContext, type DshClientError, type DshOperatorReadContext, type DshVersionedMutationContext, type StorePublicationMutationContext } from "./dsh-transport";

export async function submitJoiningCase(caseId: string, context: DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  if (!caseId.trim()) throw new Error("DSH_JOINING_CASE_ID_REQUIRED");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.submitJoiningCase.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return requestDshJson<JoiningCaseResponse>(dshOperationPaths.submitJoiningCase.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function reviewJoiningCase(caseId: string, input: ReviewJoiningCaseRequest, context: DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  if (!caseId.trim() || !input.decision) throw new Error("DSH_JOINING_CASE_REVIEW_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.reviewJoiningCase.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return requestDshJson<JoiningCaseResponse>(dshOperationPaths.reviewJoiningCase.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function bindJoiningCaseFinancialTerms(caseId: string, input: Readonly<{ expectedTermsPolicyVersion: string }>, context: DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  if (!caseId.trim()) throw new Error("DSH_JOINING_CASE_ID_REQUIRED");
  if (!input.expectedTermsPolicyVersion.trim()) throw new Error("DSH_JOINING_CASE_POLICY_VERSION_REQUIRED");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.bindJoiningCaseFinancialTerms.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return requestDshJson<JoiningCaseResponse>(dshOperationPaths.bindJoiningCaseFinancialTerms.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readStorePublication(
  storeId: string,
  context: DshOperatorReadContext,
): Promise<StorePublicationResponse> {
  if (!storeId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_PUBLICATION_READ_INPUT_INVALID");
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const path = dshOperationPaths.readStorePublication.path.replace("{storeId}", encodeURIComponent(storeId.trim()));
      response = await fetch(`${baseUrl}${path}`, {
        method: dshOperationPaths.readStorePublication.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "X-Acting-Actor-ID": context.operatorActorId.trim(),
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return await response.json() as StorePublicationResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function setStorePublication(
  storeId: string,
  state: PublicationAction,
  context: StorePublicationMutationContext,
): Promise<Readonly<{ status: number; payload: StorePublicationResponse }>> {
  if (!storeId.trim() || !["published", "hidden"].includes(state)) throw new Error("DSH_PUBLICATION_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PUBLICATION_IDEMPOTENCY_INVALID");
  const input: StorePublicationRequest = { state };
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      const path = dshOperationPaths.setStorePublication.path.replace("{storeId}", encodeURIComponent(storeId.trim()));
      response = await fetch(`${baseUrl}${path}`, {
        method: dshOperationPaths.setStorePublication.method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Acting-Actor-ID": context.operatorActorId.trim(),
          "X-Correlation-ID": context.correlationId.trim(),
          "X-Expected-Version": String(context.expectedVersion),
          "Idempotency-Key": context.idempotencyKey.trim(),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return { status: response.status, payload: await response.json() as StorePublicationResponse };
  } finally {
    clearTimeout(timeout);
  }
}

export async function setStoreFulfillmentModes(
  storeId: string,
  input: SetStoreFulfillmentModesRequest,
  context: StorePublicationMutationContext,
): Promise<Readonly<{ status: number; payload: StoreFulfillmentModesResponse }>> {
  if (!storeId.trim() || input.fulfillmentModes.length < 1) throw new Error("DSH_STORE_FULFILLMENT_MODES_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_FULFILLMENT_MODES_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.setStoreFulfillmentModes.path.replace("{storeId}", encodeURIComponent(storeId.trim()));
  return requestDshJson<StoreFulfillmentModesResponse>(dshOperationPaths.setStoreFulfillmentModes.method, path, input, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(),
    "X-Correlation-ID": context.correlationId.trim(),
    "X-Expected-Version": String(context.expectedVersion),
    "Idempotency-Key": context.idempotencyKey.trim(),
  });
}

export async function setStoreCommercialType(
  storeId: string,
  input: SetStoreCommercialTypeRequest,
  context: StorePublicationMutationContext,
): Promise<Readonly<{ status: number; payload: SetStoreCommercialTypeResponse }>> {
  if (!storeId.trim() || !input.commercialStoreTypeId.trim() || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_STORE_COMMERCIAL_TYPE_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_COMMERCIAL_TYPE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.setStoreCommercialType.path.replace("{storeId}", encodeURIComponent(storeId.trim()));
  return requestDshJson<SetStoreCommercialTypeResponse>(dshOperationPaths.setStoreCommercialType.method, path, input, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(),
    "X-Correlation-ID": context.correlationId.trim(),
    "X-Expected-Version": String(context.expectedVersion),
    "Idempotency-Key": context.idempotencyKey.trim(),
  });
}
