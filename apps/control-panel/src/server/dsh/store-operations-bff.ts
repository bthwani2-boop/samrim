import type { PartnerStoreOrderSummaryResponse, StoreImagesResponse, StoreOrderRatingListResponse, StorePublicContactResponse } from "@bthwani/dsh";
import { dshOperationPaths, type PartnerStoreOperationalAvailabilityMutationResponse, type PartnerStoreOperationalAvailabilityResponse, type StoreOperationalAvailabilityRequest } from "@bthwani/dsh";
import { type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshJson, validateAttributedMutationContext } from "./dsh-transport";

export async function readOperatorStoreAvailability(storeId: string, context: DshOperatorReadContext): Promise<PartnerStoreOperationalAvailabilityResponse> {
  if (!storeId.trim() || storeId.length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_STORE_AVAILABILITY_INPUT_INVALID");
  return (await requestDshJson<PartnerStoreOperationalAvailabilityResponse>(
    "GET", `/dsh/operations/stores/${encodeURIComponent(storeId.trim())}/operational-availability`, undefined,
    { "X-Acting-Actor-ID": context.operatorActorId.trim() }
  )).payload;
}
export async function updateOperatorStoreAvailability(storeId: string, input: StoreOperationalAvailabilityRequest,
  context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PartnerStoreOperationalAvailabilityMutationResponse }>> {
  validateAttributedMutationContext(context);
  if (!storeId.trim() || storeId.length > 128 || !context.idempotencyKey.trim()) throw new Error("DSH_STORE_AVAILABILITY_INPUT_INVALID");
  return requestDshJson<PartnerStoreOperationalAvailabilityMutationResponse>(
    "PATCH", `/dsh/operations/stores/${encodeURIComponent(storeId.trim())}/operational-availability`, input,
    { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() }
  );
}

export async function readOperatorStoreOrderSummary(storeId: string, period: "7d" | "30d" | "all", context: DshOperatorReadContext): Promise<PartnerStoreOrderSummaryResponse> {
  const scope = storeId.trim();
  if (!scope || scope.length > 128 || !["7d", "30d", "all"].includes(period)) throw new Error("DSH_OPERATOR_STORE_SUMMARY_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorStoreOrderSummary.path.replace("{storeId}", encodeURIComponent(scope)) + "?period=" + encodeURIComponent(period);
  return (await requestDshJson<PartnerStoreOrderSummaryResponse>(dshOperationPaths.readOperatorStoreOrderSummary.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listOperatorStoreOrderRatings(storeId: string, cursor: string, context: DshOperatorReadContext, limit = 20): Promise<StoreOrderRatingListResponse> {
  const scope = storeId.trim();
  if (!scope || scope.length > 128 || cursor.length > 1024 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("DSH_OPERATOR_STORE_RATINGS_INPUT_INVALID");
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const path = dshOperationPaths.listOperatorStoreOrderRatings.path.replace("{storeId}", encodeURIComponent(scope)) + "?" + params;
  return (await requestDshJson<StoreOrderRatingListResponse>(dshOperationPaths.listOperatorStoreOrderRatings.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorStorePublicContact(storeId: string, context: DshOperatorReadContext): Promise<StorePublicContactResponse> {
  const id = storeId.trim();
  const actor = context.operatorActorId.trim();
  if (!id || id.length > 128 || !actor) throw new Error("DSH_STORE_CONTACT_SCOPE_INVALID");
  return (await requestDshJson<StorePublicContactResponse>("GET",
    "/dsh/operator/stores/" + encodeURIComponent(id) + "/contact",
    undefined, { "X-Acting-Actor-ID": actor })).payload;
}

export async function readOperatorStoreImages(storeId: string,context: DshOperatorReadContext): Promise<StoreImagesResponse> {
 const result=await requestDshJson<StoreImagesResponse>("GET",dshOperationPaths.readOperatorStoreImages.path.replace("{storeId}",encodeURIComponent(storeId.trim())),undefined,{"X-Acting-Actor-ID":context.operatorActorId.trim()});
 return result.payload;
}
