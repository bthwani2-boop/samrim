import { type CreateJoiningCaseRequest, dshOperationPaths, isMediaProvenanceInputValid, type JoiningCaseListResponse, type JoiningCaseProofDetailsResponse, type JoiningCaseResponse, type MediaProvenanceInput, type PublicationAction, type ReviewJoiningCaseRequest, type SetStoreCommercialTypeRequest, type SetStoreCommercialTypeResponse, type SetStoreFulfillmentModesRequest, type StoreAccessGrantListResponse, type StoreAccessGrantMutationResponse, type StoreFulfillmentModesResponse, type StorePublicationRequest, type StorePublicationResponse } from "@bthwani/dsh";
import { normalizeYemenPhoneE164 } from "@bthwani/identity/phone";
import { appendMediaProvenance, type DshClientError, type DshOperatorReadContext, type DshVersionedMutationContext, dshBaseUrl, dshToken, type JoiningCaseMutationContext, parseErrorPayload, requestDshFile, requestDshJson, requestDshMultipart, type StorePublicationMutationContext, validateAttributedMutationContext, validateVersionedMutationContext } from "./dsh-transport";

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




const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;

export async function readJoiningCase(caseId: string, context: DshOperatorReadContext): Promise<JoiningCaseResponse> {
  if (!caseId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_JOINING_CASE_READ_INPUT_INVALID");
  const path = dshOperationPaths.readJoiningCase.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return (await requestDshJson<JoiningCaseResponse>(dshOperationPaths.readJoiningCase.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readJoiningCaseForPartnerActor(actorId: string, context: DshOperatorReadContext): Promise<JoiningCaseResponse> {
  const normalized = actorId.trim();
  if (!normalized || normalized.length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_PARTNER_JOINING_CASE_READ_INPUT_INVALID");
  const path = dshOperationPaths.readJoiningCaseForPartnerActor.path.replace("{actorId}", encodeURIComponent(normalized));
  return (await requestDshJson<JoiningCaseResponse>(dshOperationPaths.readJoiningCaseForPartnerActor.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export function createOperatorMerchantStore(
  actorId: string,
  input: import("@bthwani/dsh").PartnerFirstStoreCreateRequest,
  context: JoiningCaseMutationContext,
) {
  const owner = actorId.trim();
  if (!owner || owner.length > 128 || !context.operatorActorId.trim() ||
    context.correlationId.trim().length < 8 || context.idempotencyKey.trim().length < 8) {
    throw new Error("DSH_STORE_CREATE_CONTEXT_INVALID");
  }
  const operation = dshOperationPaths.createOperatorMerchantStore;
  return requestDshJson<import("@bthwani/dsh").PartnerFirstStoreCreateResponse>(
    operation.method,
    operation.path.replace("{actorId}", encodeURIComponent(owner)),
    input,
    { "X-Acting-Actor-ID": context.operatorActorId.trim(),
      "X-Correlation-ID": context.correlationId.trim(),
      "Idempotency-Key": context.idempotencyKey.trim() },
  );
}


export async function listJoiningCases(state: string, query: string, sort: "created_asc" | "created_desc", limit: number, cursor: string, context: DshOperatorReadContext): Promise<JoiningCaseListResponse> {
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 50 || Array.from(query.trim()).length > 128 || cursor.trim().length > 2048) throw new Error("DSH_JOINING_CASE_QUEUE_INPUT_INVALID");
  const params = new URLSearchParams({ limit: String(limit) });
  params.set("sort", sort);
  if (state.trim()) params.set("state", state.trim());
  if (query.trim()) params.set("q", query.trim());
  if (cursor.trim()) params.set("cursor", cursor.trim());
  const path = `${dshOperationPaths.listJoiningCases.path}?${params.toString()}`;
  return (await requestDshJson<JoiningCaseListResponse>(dshOperationPaths.listJoiningCases.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorPartnerTeamPage = Readonly<{
 items: ReadonlyArray<import("@bthwani/dsh").StoreAccessGrant>;
 nextCursor?: string;
 counts: Readonly<{total:number;active:number;pending:number;suspended:number}>;
}>;
export async function listOperatorPartnerTeam(ownerId:string,storeId:string,limit:number,cursor:string,context:DshOperatorReadContext):Promise<OperatorPartnerTeamPage>{
 if(!ownerId.trim()||ownerId.length>128||storeId.length>128||cursor.length>512||!Number.isInteger(limit)||limit<1||limit>50||!context.operatorActorId.trim())throw Error("INVALID_PARTNER_TEAM_READ");
 const query=new URLSearchParams({limit:String(limit)});
 if(storeId)query.set("storeId",storeId);if(cursor)query.set("cursor",cursor);
 return (await requestDshJson<OperatorPartnerTeamPage>("GET","/dsh/operations/partners/"+encodeURIComponent(ownerId.trim())+"/team?"+query,undefined,{"X-Acting-Actor-ID":context.operatorActorId.trim()})).payload;
}
export async function listStoreAccessRoleAdmissionsForOperator(context: DshOperatorReadContext, limit = 25, cursor = ""): Promise<StoreAccessGrantListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_STORE_ACCESS_OPERATOR_REQUIRED");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 512) throw new Error("DSH_STORE_ACCESS_PAGE_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  const path = `${dshOperationPaths.listStoreAccessRoleAdmissionsForOperator.path}?${query}`;
  return (await requestDshJson<StoreAccessGrantListResponse>(dshOperationPaths.listStoreAccessRoleAdmissionsForOperator.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function provisionPartnerRoleForStoreAccessForOperator(grantId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: StoreAccessGrantMutationResponse }>> {
  const normalizedGrant = grantId.trim();
  validateAttributedMutationContext(context);
  if (!normalizedGrant || normalizedGrant.length > 128 || !context.idempotencyKey.trim()) throw new Error("DSH_STORE_ACCESS_ADMISSION_INPUT_INVALID");
  const path = dshOperationPaths.provisionPartnerRoleForStoreAccessForOperator.path.replace("{grantId}", encodeURIComponent(normalizedGrant));
  return requestDshJson<StoreAccessGrantMutationResponse>(dshOperationPaths.provisionPartnerRoleForStoreAccessForOperator.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function createJoiningCase(input: CreateJoiningCaseRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  const contactPhoneE164 = normalizeYemenPhoneE164(input.contactPhoneE164);
  if (!phoneE164Pattern.test(contactPhoneE164) || input.businessName.trim().length < 2 || input.firstStoreName.trim().length < 2 || !input.serviceCityId.trim() || !input.firstStoreVerticalId.trim() || !input.firstStoreCommercialTypeId.trim() || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude)) {
    throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
  }
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_IDEMPOTENCY_INVALID");
  return requestDshJson<JoiningCaseResponse>(dshOperationPaths.createJoiningCase.method, dshOperationPaths.createJoiningCase.path, { ...input, contactPhoneE164 }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function uploadOperatorJoiningCaseStoreImage(caseId: string, file: File, provenance: MediaProvenanceInput, context: StorePublicationMutationContext, role: "primary" | "cover" = "primary"): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  const normalizedCaseId = caseId.trim();
  if (!normalizedCaseId || file.size < 1 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type) || !isMediaProvenanceInputValid(provenance)) throw new Error("DSH_JOINING_CASE_STORE_IMAGE_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_STORE_IMAGE_IDEMPOTENCY_INVALID");
  const form = new FormData();
  form.append("file", file, file.name || "storefront-image");
  form.append("role", role);
  appendMediaProvenance(form, provenance);
  const path = dshOperationPaths.uploadOperatorJoiningCaseStoreImage.path.replace("{caseId}", encodeURIComponent(normalizedCaseId));
  return requestDshMultipart<JoiningCaseResponse>(dshOperationPaths.uploadOperatorJoiningCaseStoreImage.method, path, form, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readJoiningCaseProofDetails(caseId: string, context: DshOperatorReadContext): Promise<JoiningCaseProofDetailsResponse> {
  if (!caseId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_JOINING_CASE_PROOF_READ_INPUT_INVALID");
  const path = dshOperationPaths.readJoiningCaseProofDetails.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return (await requestDshJson<JoiningCaseProofDetailsResponse>(dshOperationPaths.readJoiningCaseProofDetails.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": `cp_proof_details_${crypto.randomUUID()}` })).payload;
}

export async function downloadJoiningCaseProofImage(caseId: string, context: DshOperatorReadContext): Promise<Readonly<{ content: Uint8Array; contentType: string; contentDisposition: string }>> {
  if (!caseId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_JOINING_CASE_PROOF_READ_INPUT_INVALID");
  const path = dshOperationPaths.downloadJoiningCaseProofImage.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return requestDshFile(path, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": `cp_proof_image_${crypto.randomUUID()}` });
}

export async function downloadJoiningCaseReviewPhoto(caseId: string, context: DshOperatorReadContext): Promise<Readonly<{ content: Uint8Array; contentType: string; contentDisposition: string }>> {
  if (!caseId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_JOINING_REVIEW_PHOTO_READ_INPUT_INVALID");
  const path = dshOperationPaths.downloadJoiningCaseReviewPhoto.path.replace("{caseId}", encodeURIComponent(caseId.trim()));
  return requestDshFile(path, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": "cp_joining_review_" + crypto.randomUUID() });
}
