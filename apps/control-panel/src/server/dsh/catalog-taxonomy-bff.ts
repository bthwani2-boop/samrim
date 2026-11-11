import { type CatalogAttributeDefinitionListResponse, type CatalogAttributeDefinitionResponse, type CatalogAttributeEnumOptionListResponse, type CatalogAttributeEnumOptionResponse, type CatalogAttributeRuleListResponse, type CatalogCategoryDetailResponse, type CatalogCategoryListResponse, type CatalogCategoryResponse, type CommerceVerticalListResponse, type CommerceVerticalResponse, type CommercialStoreTypeListResponse, type CommercialStoreTypeResponse, type CreateCatalogAttributeDefinitionRequest, type CreateCatalogAttributeEnumOptionRequest, type CreateCatalogCategoryRequest, type CreateCommerceVerticalRequest, type CreateCommercialStoreTypeRequest, dshOperationPaths, isMediaProvenanceInputValid, type MediaProvenanceInput, type UpdateCatalogAttributeDefinitionRequest, type UpdateCatalogAttributeEnumOptionRequest, type UpdateCatalogCategoryRequest, type UpdateCommerceVerticalRequest, type UpdateCommercialStoreTypeRequest, type UpsertCatalogAttributeRuleRequest } from "@bthwani/dsh";
import { appendMediaProvenance, type DshOperatorReadContext, type JoiningCaseMutationContext, requestDshJson, requestDshMultipart, validateAttributedMutationContext, validateVersionedMutationContext } from "./dsh-transport";



export async function listCatalogVerticals(context: DshOperatorReadContext, includeInactive = false): Promise<CommerceVerticalListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_CATALOG_VERTICAL_READ_INPUT_INVALID");
  const path = includeInactive ? `${dshOperationPaths.listCatalogVerticals.path}?includeInactive=true` : dshOperationPaths.listCatalogVerticals.path;
  return (await requestDshJson<CommerceVerticalListResponse>(dshOperationPaths.listCatalogVerticals.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createCatalogVertical(input: CreateCommerceVerticalRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CommerceVerticalResponse }>> {
  if (!input.nameAr.trim() || !input.nameEn.trim() || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_CATALOG_VERTICAL_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_VERTICAL_IDEMPOTENCY_INVALID");
  return requestDshJson<CommerceVerticalResponse>(dshOperationPaths.createCatalogVertical.method, dshOperationPaths.createCatalogVertical.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCatalogVertical(verticalId: string, input: UpdateCommerceVerticalRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CommerceVerticalResponse }>> {
  const normalizedId = verticalId.trim();
  if (!normalizedId || !input.nameAr.trim() || !input.nameEn.trim() || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_CATALOG_VERTICAL_UPDATE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_VERTICAL_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateCatalogVertical.path.replace("{verticalId}", encodeURIComponent(normalizedId));
  return requestDshJson<CommerceVerticalResponse>(dshOperationPaths.updateCatalogVertical.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCommercialStoreTypes(context: DshOperatorReadContext, verticalId: string, includeInactive = false): Promise<CommercialStoreTypeListResponse> {
  const normalizedVerticalId = verticalId.trim();
  if (!context.operatorActorId.trim() || !normalizedVerticalId) throw new Error("DSH_COMMERCIAL_STORE_TYPE_READ_INPUT_INVALID");
  const query = new URLSearchParams({ verticalId: normalizedVerticalId });
  if (includeInactive) query.set("includeInactive", "true");
  return (await requestDshJson<CommercialStoreTypeListResponse>(dshOperationPaths.listCommercialStoreTypes.method, `${dshOperationPaths.listCommercialStoreTypes.path}?${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createCommercialStoreType(input: CreateCommercialStoreTypeRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CommercialStoreTypeResponse }>> {
  if (!input.verticalId.trim() || !input.nameAr.trim() || !input.nameEn.trim() || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_COMMERCIAL_STORE_TYPE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_COMMERCIAL_STORE_TYPE_IDEMPOTENCY_INVALID");
  return requestDshJson<CommercialStoreTypeResponse>(dshOperationPaths.createCommercialStoreType.method, dshOperationPaths.createCommercialStoreType.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCommercialStoreType(storeTypeId: string, input: UpdateCommercialStoreTypeRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CommercialStoreTypeResponse }>> {
  const normalizedId = storeTypeId.trim();
  if (!normalizedId || !input.nameAr.trim() || !input.nameEn.trim() || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_COMMERCIAL_STORE_TYPE_UPDATE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_COMMERCIAL_STORE_TYPE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateCommercialStoreType.path.replace("{storeTypeId}", encodeURIComponent(normalizedId));
  return requestDshJson<CommercialStoreTypeResponse>(dshOperationPaths.updateCommercialStoreType.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function createCatalogCategory(input: CreateCatalogCategoryRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogCategoryResponse }>> {
  if (!input.verticalId.trim() || !input.nameAr.trim() || !input.nameEn.trim() || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_CATALOG_CATEGORY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_CATEGORY_IDEMPOTENCY_INVALID");
  return requestDshJson<CatalogCategoryResponse>(dshOperationPaths.createCatalogCategory.method, dshOperationPaths.createCatalogCategory.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCatalogCategory(categoryId: string, input: UpdateCatalogCategoryRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogCategoryResponse }>> {
  const normalizedId = categoryId.trim();
  if (!normalizedId || !input.nameAr.trim() || !input.nameEn.trim() || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_CATALOG_CATEGORY_UPDATE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_CATEGORY_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateCatalogCategory.path.replace("{categoryId}", encodeURIComponent(normalizedId));
  return requestDshJson<CatalogCategoryResponse>(dshOperationPaths.updateCatalogCategory.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCatalogCategories(verticalId: string, query = "", status = "active", sort = "name_asc", limit = 100, cursor = "", context?: DshOperatorReadContext): Promise<CatalogCategoryListResponse> {
	if (verticalId.trim().length > 128) throw new Error("DSH_CATALOG_CATEGORY_READ_INPUT_INVALID");
	const normalizedStatus = status || "active";
	const needsOperator = !verticalId.trim() || normalizedStatus === "all" || normalizedStatus === "inactive";
	if ((needsOperator && !context?.operatorActorId.trim()) || query.trim().length > 160 || !["all", "active", "inactive"].includes(normalizedStatus) || !["name_asc", "name_desc", "updated_desc"].includes(sort) || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor.length > 2048) throw new Error("DSH_CATALOG_CATEGORY_READ_INPUT_INVALID");
	const params = new URLSearchParams({ verticalId: verticalId.trim(), status: normalizedStatus, sort, limit: String(limit) });
	if (query.trim()) params.set("query", query.trim());
	if (cursor) params.set("cursor", cursor);
	const path = `${dshOperationPaths.listCatalogCategories.path}?${params.toString()}`;
	const headers = needsOperator ? { "X-Acting-Actor-ID": context?.operatorActorId.trim() ?? "" } : {};
	return (await requestDshJson<CatalogCategoryListResponse>(dshOperationPaths.listCatalogCategories.method, path, undefined, headers)).payload;
}

export async function readCatalogCategory(categoryId: string, context: DshOperatorReadContext): Promise<CatalogCategoryDetailResponse> {
	const normalizedId = categoryId.trim();
	if (!normalizedId || !context.operatorActorId.trim()) throw new Error("DSH_CATALOG_CATEGORY_READ_INPUT_INVALID");
	const path = dshOperationPaths.readCatalogCategory.path.replace("{categoryId}", encodeURIComponent(normalizedId));
	return (await requestDshJson<CatalogCategoryDetailResponse>(dshOperationPaths.readCatalogCategory.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listCatalogAttributeDefinitions(verticalId: string, includeInactive: boolean, context: DshOperatorReadContext): Promise<CatalogAttributeDefinitionListResponse> {
  if (!verticalId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_READ_INPUT_INVALID");
  const params = new URLSearchParams({ verticalId: verticalId.trim() });
  if (includeInactive) params.set("includeInactive", "true");
  const path = `${dshOperationPaths.listCatalogAttributeDefinitions.path}?${params.toString()}`;
  return (await requestDshJson<CatalogAttributeDefinitionListResponse>(dshOperationPaths.listCatalogAttributeDefinitions.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createCatalogAttributeDefinition(input: CreateCatalogAttributeDefinitionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeDefinitionResponse }>> {
  if (!input.id.trim() || !input.verticalId.trim() || !input.code.trim() || !input.nameAr.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_IDEMPOTENCY_INVALID");
  return requestDshJson<CatalogAttributeDefinitionResponse>(dshOperationPaths.createCatalogAttributeDefinition.method, dshOperationPaths.createCatalogAttributeDefinition.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCatalogAttributeEnumOptions(attributeId: string, includeInactive: boolean, context: DshOperatorReadContext): Promise<CatalogAttributeEnumOptionListResponse> {
  if (!attributeId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_OPTION_READ_INPUT_INVALID");
  const params = new URLSearchParams();
  if (includeInactive) params.set("includeInactive", "true");
  const path = `${dshOperationPaths.listCatalogAttributeEnumOptions.path.replace("{attributeId}", encodeURIComponent(attributeId.trim()))}${params.size ? `?${params.toString()}` : ""}`;
  return (await requestDshJson<CatalogAttributeEnumOptionListResponse>(dshOperationPaths.listCatalogAttributeEnumOptions.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createCatalogAttributeEnumOption(attributeId: string, input: CreateCatalogAttributeEnumOptionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeEnumOptionResponse }>> {
  if (!attributeId.trim() || !input.optionValue.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_OPTION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_OPTION_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.createCatalogAttributeEnumOption.path.replace("{attributeId}", encodeURIComponent(attributeId.trim()));
  return requestDshJson<CatalogAttributeEnumOptionResponse>(dshOperationPaths.createCatalogAttributeEnumOption.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCatalogAttributeDefinition(attributeId: string, input: UpdateCatalogAttributeDefinitionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeDefinitionResponse }>> {
  if (!attributeId.trim() || !input.nameAr.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateCatalogAttributeDefinition.path.replace("{attributeId}", encodeURIComponent(attributeId.trim()));
  return requestDshJson<CatalogAttributeDefinitionResponse>(dshOperationPaths.updateCatalogAttributeDefinition.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCatalogAttributeEnumOption(attributeId: string, optionValue: string, input: UpdateCatalogAttributeEnumOptionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeEnumOptionResponse }>> {
  if (!attributeId.trim() || !optionValue.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_OPTION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_OPTION_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateCatalogAttributeEnumOption.path.replace("{attributeId}", encodeURIComponent(attributeId.trim())).replace("{optionValue}", encodeURIComponent(optionValue.trim()));
  return requestDshJson<CatalogAttributeEnumOptionResponse>(dshOperationPaths.updateCatalogAttributeEnumOption.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCatalogCategoryAttributeRules(categoryId: string, context: DshOperatorReadContext): Promise<CatalogAttributeRuleListResponse> {
  if (!categoryId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_RULE_READ_INPUT_INVALID");
  const path = dshOperationPaths.listCatalogCategoryAttributeRules.path.replace("{categoryId}", encodeURIComponent(categoryId.trim()));
  return (await requestDshJson<CatalogAttributeRuleListResponse>(dshOperationPaths.listCatalogCategoryAttributeRules.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function upsertCatalogCategoryAttributeRule(categoryId: string, attributeId: string, input: UpsertCatalogAttributeRuleRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeRuleListResponse }>> {
  if (!categoryId.trim() || !attributeId.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_RULE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_RULE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.upsertCatalogCategoryAttributeRule.path.replace("{categoryId}", encodeURIComponent(categoryId.trim())).replace("{attributeId}", encodeURIComponent(attributeId.trim()));
  return requestDshJson<CatalogAttributeRuleListResponse>(dshOperationPaths.upsertCatalogCategoryAttributeRule.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function uploadCatalogCategoryMedia(categoryId: string, file: File, reason: string, provenance: MediaProvenanceInput, context: JoiningCaseMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CatalogCategoryResponse }>> {
  const normalizedReason = reason.trim();
  if (!categoryId.trim() || file.size < 1 || file.size > 10 * 1024 * 1024 || normalizedReason.length < 5 || normalizedReason.length > 500 || !isMediaProvenanceInputValid(provenance)) throw new Error("DSH_CATEGORY_MEDIA_UPLOAD_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATEGORY_MEDIA_UPLOAD_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.uploadCatalogCategoryMedia.path.replace("{categoryId}", encodeURIComponent(categoryId.trim()));
  const body = new FormData();
  body.set("file", file, file.name || "category-image");
  body.set("reason", normalizedReason);
  appendMediaProvenance(body, provenance);
  return requestDshMultipart<CatalogCategoryResponse>(dshOperationPaths.uploadCatalogCategoryMedia.method, path, body, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function uploadCommerceVerticalMedia(verticalId: string, file: File, reason: string, provenance: MediaProvenanceInput, context: JoiningCaseMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CommerceVerticalResponse }>> {
  const normalizedReason = reason.trim();
  if (!verticalId.trim() || file.size < 1 || file.size > 10 * 1024 * 1024 || normalizedReason.length < 5 || normalizedReason.length > 500 || !isMediaProvenanceInputValid(provenance)) throw new Error("DSH_VERTICAL_MEDIA_UPLOAD_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_VERTICAL_MEDIA_UPLOAD_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.uploadCommerceVerticalMedia.path.replace("{verticalId}", encodeURIComponent(verticalId.trim()));
  const body = new FormData();
  body.set("file", file, file.name || "vertical-image");
  body.set("reason", normalizedReason);
  appendMediaProvenance(body, provenance);
  return requestDshMultipart<CommerceVerticalResponse>(dshOperationPaths.uploadCommerceVerticalMedia.method, path, body, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}
