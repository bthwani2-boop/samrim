import type { PartnerStoreOrderSummaryResponse, StoreImagesResponse, StoreOrderRatingListResponse, StorePublicContactResponse } from "@bthwani/dsh";
import { dshOperationPaths, isMediaProvenanceInputValid, type MediaProvenanceInput, type OperatorStoreListResponse, type PartnerStoreListResponse, type PartnerStoreOperationalAvailabilityMutationResponse, type PartnerStoreOperationalAvailabilityResponse, type StoreOperationalAvailabilityRequest } from "@bthwani/dsh";
import { appendMediaProvenance, type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshFile, requestDshJson, requestDshMultipart, type StorePublicationMutationContext, validateAttributedMutationContext, validateVersionedMutationContext } from "./dsh-transport";

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



export async function listOperatorPartnerStores(actorId: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<PartnerStoreListResponse> {
  const normalizedActorId = actorId.trim();
  if (!normalizedActorId || !context.operatorActorId.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || cursor.length > 128) throw new Error("DSH_PARTNER_STORES_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  const path = `${dshOperationPaths.listOperatorPartnerStores.path.replace("{actorId}", encodeURIComponent(normalizedActorId))}?${query.toString()}`;
  return (await requestDshJson<PartnerStoreListResponse>(dshOperationPaths.listOperatorPartnerStores.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorPartnerStorePresence(actorIds: ReadonlyArray<string>, context: DshOperatorReadContext): Promise<ReadonlyArray<string>> {
  const unique = [...new Set(actorIds)];
  if (!context.operatorActorId.trim() || unique.length < 1 || unique.length > 50 || unique.some((id) => !id.trim() || id.length > 128)) throw new Error("DSH_PARTNER_STORE_PRESENCE_INPUT_INVALID");
  const response = await requestDshJson<{ actorIds: string[] }>(
    dshOperationPaths.readOperatorPartnerStorePresence.method,
    dshOperationPaths.readOperatorPartnerStorePresence.path,
    { actorIds: unique },
    { "X-Acting-Actor-ID": context.operatorActorId.trim() },
  );
  return response.payload.actorIds;
}

export async function listOperatorStores(state: string, search: string, serviceCityId: string, searchMode: string, sort: string, limit: number, cursor: string, context: DshOperatorReadContext, relationModel: "" | "BTHWANI_PARTNER" | "INDEPENDENT_STORE" = ""): Promise<OperatorStoreListResponse> {
	const normalizedState = state.trim();
	const normalizedSearch = search.trim();
	const normalizedCityId = serviceCityId.trim();
	const normalizedSearchMode = searchMode.trim() || "contains";
	const normalizedSort = sort.trim() || "updated_desc";
	const normalizedCursor = cursor.trim();
	const namePrefixSearch = normalizedSearchMode === "name_prefix";
	if ((relationModel !== "" && relationModel !== "BTHWANI_PARTNER" && relationModel !== "INDEPENDENT_STORE") || !context.operatorActorId.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || normalizedCursor.length > 1024 || Array.from(normalizedSearch).length > 128 || normalizedCityId.length > 128 || (normalizedState !== "" && normalizedState !== "unpublished" && normalizedState !== "published" && normalizedState !== "hidden") || (normalizedSearchMode !== "contains" && !namePrefixSearch) || (normalizedSort !== "updated_desc" && normalizedSort !== "updated_asc" && normalizedSort !== "name_asc") || (namePrefixSearch && (normalizedState !== "published" || Array.from(normalizedSearch).length < 2 || !normalizedCityId || normalizedSort !== "name_asc")) || (!namePrefixSearch && normalizedSort === "name_asc")) {
		throw new Error("DSH_OPERATOR_STORES_INPUT_INVALID");
	}
	const query = new URLSearchParams({ limit: String(limit) });
	if (normalizedState) query.set("state", normalizedState);
	if (relationModel) query.set("relationModel", relationModel);
	if (normalizedSearch) query.set("q", normalizedSearch);
	if (normalizedCityId) query.set("serviceCityId", normalizedCityId);
	if (namePrefixSearch) query.set("searchMode", normalizedSearchMode);
	if (normalizedSort !== "updated_desc") query.set("sort", normalizedSort);
	if (normalizedCursor) query.set("cursor", normalizedCursor);
	const path = `${dshOperationPaths.listOperatorStores.path}?${query.toString()}`;
	return (await requestDshJson<OperatorStoreListResponse>(dshOperationPaths.listOperatorStores.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function uploadOperatorStoreImage(storeId: string, file: File, provenance: MediaProvenanceInput, context: StorePublicationMutationContext, role: "primary" | "cover" = "primary"): Promise<Readonly<{ status: number; payload: StoreImagesResponse }>> {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId || file.size < 1 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type) || !isMediaProvenanceInputValid(provenance)) throw new Error("DSH_JOINING_CASE_STORE_IMAGE_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_STORE_IMAGE_IDEMPOTENCY_INVALID");
  const form = new FormData();
  form.append("file", file, file.name || "storefront-image");
  form.append("role", role);
  appendMediaProvenance(form, provenance);
  const path = dshOperationPaths.uploadOperatorStoreImage.path.replace("{storeId}", encodeURIComponent(normalizedStoreId));
  return requestDshMultipart<StoreImagesResponse>(dshOperationPaths.uploadOperatorStoreImage.method, path, form, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listOperatorStoreInternalPhotos(storeId: string, context: DshOperatorReadContext): Promise<Readonly<{ storeId: string; photos: ReadonlyArray<import("@bthwani/dsh").StoreInternalPhotoSummary> }>> {
  const normalized = storeId.trim();
  if (!normalized || !context.operatorActorId.trim()) throw new Error("DSH_STORE_INTERNAL_PHOTOS_INPUT_INVALID");
  const path = dshOperationPaths.listOperatorStoreInternalPhotos.path.replace("{storeId}", encodeURIComponent(normalized));
  return (await requestDshJson<{ storeId: string; photos: ReadonlyArray<import("@bthwani/dsh").StoreInternalPhotoSummary> }>(dshOperationPaths.listOperatorStoreInternalPhotos.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": `cp_store_photos_${crypto.randomUUID()}` })).payload;
}

export async function downloadOperatorStoreInternalPhoto(storeId: string, photoId: string, context: DshOperatorReadContext): Promise<Readonly<{ content: Uint8Array; contentType: string; contentDisposition: string }>> {
  const normalizedStoreId = storeId.trim();
  const normalizedPhotoId = photoId.trim();
  if (!normalizedStoreId || !normalizedPhotoId || !context.operatorActorId.trim()) throw new Error("DSH_STORE_INTERNAL_PHOTO_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorStoreInternalPhoto.path.replace("{storeId}", encodeURIComponent(normalizedStoreId)).replace("{photoId}", encodeURIComponent(normalizedPhotoId));
  return requestDshFile(path, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": `cp_store_photo_${crypto.randomUUID()}` });
}
