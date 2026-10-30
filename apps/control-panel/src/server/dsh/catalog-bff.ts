import { appendMediaProvenance } from "./dsh-transport";
import { type UpdateCatalogAttributeDefinitionRequest, type UpdateCatalogAttributeEnumOptionRequest, type CatalogAttributeDefinitionListResponse, type CatalogAttributeDefinitionResponse, type CatalogAttributeEnumOptionListResponse, type CatalogAttributeEnumOptionResponse, type CatalogAttributeRuleListResponse, type CatalogCategoryDetailResponse, type CatalogCategoryListResponse, type CatalogCategoryResponse, type CatalogImportCommitResponse, type CatalogImportPreviewRequest, type CatalogImportPreviewResponse, type CatalogImportRunResponse, type CatalogProduct, type CatalogProductListResponse, type CatalogProductProposalListResponse, type CatalogProductProposalResponse, type CatalogProductRegistryResponse, type CatalogProductResponse, type CommerceVerticalListResponse, type CommerceVerticalResponse, type CommercialStoreTypeListResponse, type CommercialStoreTypeResponse, type CreateCatalogAttributeDefinitionRequest, type CreateCatalogAttributeEnumOptionRequest, type CreateCatalogCategoryRequest, type CreateCatalogProductRequest, type CreateCommerceVerticalRequest, type CreateCommercialStoreTypeRequest, dshOperationPaths, isMediaProvenanceInputValid, type MediaProvenanceInput, type ReplaceCatalogProductMediaRequest, type ReviewCatalogProductProposalRequest, type UpdateCatalogCategoryRequest, type UpdateCatalogProductRequest, type UpdateCommerceVerticalRequest, type UpdateCommercialStoreTypeRequest, type UpsertCatalogAttributeRuleRequest } from "@bthwani/dsh";
import { requestDshJson, requestDshMultipart, validateAttributedMutationContext, validateVersionedMutationContext, type DshOperatorReadContext, type DshVersionedMutationContext, type JoiningCaseMutationContext } from "./dsh-transport";

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

export type StoreTrashItem = Readonly<{ id: string; name: string; partnerActorId: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
export type StoreTrashPage = Readonly<{ stores: ReadonlyArray<StoreTrashItem>; nextCursor: string }>;
export async function listArchivedStores(cursor: string, context: DshOperatorReadContext): Promise<StoreTrashPage> {
  if (!context.operatorActorId.trim() || cursor.length > 512) throw new Error("DSH_STORE_TRASH_READ_INVALID");
  const params = new URLSearchParams({ limit: "25" });
  if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<StoreTrashPage>("GET", "/dsh/operator/stores/trash?" + params.toString(), undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function mutateStoreTrash(storeId: string, action: "trash" | "restore", expectedVersion: number, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: { store: StoreTrashItem; idempotentReplay: boolean } }>> {
  if (!storeId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("DSH_STORE_TRASH_INPUT_INVALID");
  validateVersionedMutationContext({ ...context, expectedVersion });
  return requestDshJson("POST", "/dsh/operator/stores/" + encodeURIComponent(storeId) + "/" + action, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}
export type CatalogTrashCategory = Readonly<{ id: string; verticalId: string; nameAr: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
export type CatalogTrashCategoryPage = Readonly<{ categories: ReadonlyArray<CatalogTrashCategory>; nextCursor: string }>;
export async function listDeletedCatalogCategories(cursor: string, context: DshOperatorReadContext): Promise<CatalogTrashCategoryPage> {
  if (!context.operatorActorId.trim() || cursor.length > 512) throw new Error("DSH_CATEGORY_TRASH_READ_INVALID");
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<CatalogTrashCategoryPage>("GET", "/dsh/catalog/category-trash?" + params.toString(), undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function mutateCatalogCategoryTrash(categoryId: string, action: "trash" | "restore", expectedVersion: number, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: { category: CatalogTrashCategory; idempotentReplay: boolean } }>> {
  if (!categoryId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("DSH_CATEGORY_TRASH_INPUT_INVALID");
  validateVersionedMutationContext({ ...context, expectedVersion });
  return requestDshJson("POST", "/dsh/catalog/categories/" + encodeURIComponent(categoryId) + "/" + action, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}
export type CatalogTrashProduct = Readonly<{ id: string; canonicalName: string; version: number; deletedAt?: string; deletedBy?: string; deletionReason?: string }>;
export type CatalogTrashPage = Readonly<{ products: ReadonlyArray<CatalogTrashProduct>; nextCursor: string }>;
export async function listDeletedCatalogProducts(cursor: string, context: DshOperatorReadContext): Promise<CatalogTrashPage> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_TRASH_READ_INPUT_INVALID");
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<CatalogTrashPage>("GET", "/dsh/catalog/trash?" + params.toString(), undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}
export async function mutateCatalogProductTrash(productId: string, action: "trash" | "restore", expectedVersion: number, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: { product: CatalogTrashProduct; idempotentReplay: boolean } }>> {
  if (!productId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("DSH_TRASH_INPUT_INVALID");
  validateVersionedMutationContext({ ...context, expectedVersion });
  return requestDshJson("POST", "/dsh/catalog/products/" + encodeURIComponent(productId) + "/" + action, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCatalogProducts(query: string, verticalId: string, cursor: string, context: DshOperatorReadContext): Promise<CatalogProductListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_PRODUCT_READ_INPUT_INVALID");
  const params = new URLSearchParams({ limit: "50" });
  if (query.trim()) params.set("q", query.trim());
  if (verticalId.trim()) params.set("verticalId", verticalId.trim());
  if (cursor.trim()) params.set("cursor", cursor.trim());
  const path = `${dshOperationPaths.listCatalogProducts.path}?${params.toString()}`;
  return (await requestDshJson<CatalogProductListResponse>(dshOperationPaths.listCatalogProducts.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listCatalogProductRegistry(filters: Readonly<{ query: string; verticalId: string; categoryId: string; active: string; sort: string; minVariantCount: string; minStoreCount: string; cursor: string }>, context: DshOperatorReadContext): Promise<CatalogProductRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_PRODUCT_REGISTRY_READ_INPUT_INVALID");
  const params = new URLSearchParams({ limit: "50" });
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.verticalId.trim()) params.set("verticalId", filters.verticalId.trim());
  if (filters.categoryId.trim()) params.set("categoryId", filters.categoryId.trim());
  if (filters.active !== "all") params.set("active", filters.active);
  if (filters.sort !== "name_asc") params.set("sort", filters.sort);
  if (filters.minVariantCount !== "0") params.set("minVariantCount", filters.minVariantCount);
  if (filters.minStoreCount !== "0") params.set("minStoreCount", filters.minStoreCount);
  if (filters.cursor.trim()) params.set("cursor", filters.cursor.trim());
  const path = `${dshOperationPaths.listCatalogProductRegistry.path}?${params.toString()}`;
  return (await requestDshJson<CatalogProductRegistryResponse>(dshOperationPaths.listCatalogProductRegistry.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readCatalogProduct(productId: string, context: DshOperatorReadContext): Promise<CatalogProduct> {
  if (!productId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_PRODUCT_DETAIL_READ_INPUT_INVALID");
  const path = dshOperationPaths.readCatalogProduct.path.replace("{productId}", encodeURIComponent(productId.trim()));
  return (await requestDshJson<CatalogProduct>(dshOperationPaths.readCatalogProduct.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listCatalogProposalReviewQueue(state: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<CatalogProductProposalListResponse> {
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_CATALOG_PROPOSAL_QUEUE_INPUT_INVALID");
  const params = new URLSearchParams({ limit: String(limit) });
  if (state.trim()) params.set("state", state.trim());
  if (cursor.trim()) params.set("cursor", cursor.trim());
  const path = `${dshOperationPaths.listCatalogProductProposalReviewQueue.path}?${params.toString()}`;
  return (await requestDshJson<CatalogProductProposalListResponse>(dshOperationPaths.listCatalogProductProposalReviewQueue.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function reviewCatalogProposal(proposalId: string, input: ReviewCatalogProductProposalRequest, context: DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>): Promise<Readonly<{ status: number; payload: CatalogProductProposalResponse }>> {
  if (!proposalId.trim() || !input.state) throw new Error("DSH_CATALOG_PROPOSAL_REVIEW_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_PROPOSAL_REVIEW_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.reviewCatalogProductProposal.path.replace("{proposalId}", encodeURIComponent(proposalId.trim()));
  return requestDshJson<CatalogProductProposalResponse>(dshOperationPaths.reviewCatalogProductProposal.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function previewCatalogImport(input: CatalogImportPreviewRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogImportPreviewResponse }>> {
  if (!input.runId.trim() || !input.sourceSha256.trim() || input.rows.length < 1 || input.rows.length > 5000) throw new Error("DSH_CATALOG_IMPORT_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_IMPORT_IDEMPOTENCY_INVALID");
  return requestDshJson<CatalogImportPreviewResponse>(dshOperationPaths.previewCatalogImport.method, dshOperationPaths.previewCatalogImport.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readCatalogImportRun(runId: string, context: DshOperatorReadContext): Promise<CatalogImportRunResponse> {
  if (!runId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_CATALOG_IMPORT_READ_INPUT_INVALID");
  const path = dshOperationPaths.readCatalogImportRun.path.replace("{runId}", encodeURIComponent(runId.trim()));
  return (await requestDshJson<CatalogImportRunResponse>(dshOperationPaths.readCatalogImportRun.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function commitCatalogImport(runId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogImportCommitResponse }>> {
  if (!runId.trim()) throw new Error("DSH_CATALOG_IMPORT_COMMIT_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_IMPORT_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.commitCatalogImport.path.replace("{runId}", encodeURIComponent(runId.trim()));
  return requestDshJson<CatalogImportCommitResponse>(dshOperationPaths.commitCatalogImport.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function previewOperatorStoreCatalogImport(storeId: string, file: File, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogImportPreviewResponse }>> {
  const normalizedStoreID = storeId.trim();
  const filename = file.name.trim();
  if (!normalizedStoreID || normalizedStoreID.length > 128 || file.size < 1 || file.size > 20 * 1024 * 1024 || !/\.(csv|xlsx)$/i.test(filename)) throw new Error("DSH_STORE_CATALOG_IMPORT_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_CATALOG_IMPORT_IDEMPOTENCY_INVALID");
  const body = new FormData();
  body.append("storeId", normalizedStoreID);
  body.append("file", file, filename);
  return requestDshMultipart<CatalogImportPreviewResponse>(dshOperationPaths.previewOperatorStoreCatalogImport.method, dshOperationPaths.previewOperatorStoreCatalogImport.path, body, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readOperatorStoreCatalogImport(runId: string, context: DshOperatorReadContext): Promise<CatalogImportRunResponse> {
  if (!runId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_STORE_CATALOG_IMPORT_READ_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorStoreCatalogImport.path.replace("{runId}", encodeURIComponent(runId.trim()));
  return (await requestDshJson<CatalogImportRunResponse>(dshOperationPaths.readOperatorStoreCatalogImport.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function commitOperatorStoreCatalogImport(runId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogImportCommitResponse }>> {
  if (!runId.trim()) throw new Error("DSH_STORE_CATALOG_IMPORT_COMMIT_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_CATALOG_IMPORT_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.commitOperatorStoreCatalogImport.path.replace("{runId}", encodeURIComponent(runId.trim()));
  return requestDshJson<CatalogImportCommitResponse>(dshOperationPaths.commitOperatorStoreCatalogImport.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function createCatalogProduct(input: CreateCatalogProductRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogProductResponse }>> {
  if (!input.canonicalName.trim() || !input.verticalId.trim() || !input.scope.trim() || !input.measurementKind || !input.baseUnit || (input.categoryIds?.length ?? 0) < 1) throw new Error("DSH_PRODUCT_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PRODUCT_IDEMPOTENCY_INVALID");
  return requestDshJson<CatalogProductResponse>(dshOperationPaths.createCatalogProduct.method, dshOperationPaths.createCatalogProduct.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCatalogProduct(productId: string, input: UpdateCatalogProductRequest, context: JoiningCaseMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CatalogProductResponse }>> {
  if (!productId.trim() || !input.canonicalName.trim()) throw new Error("DSH_PRODUCT_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PRODUCT_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateCatalogProduct.path.replace("{productId}", encodeURIComponent(productId.trim()));
  return requestDshJson<CatalogProductResponse>(dshOperationPaths.updateCatalogProduct.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function replaceCatalogProductMedia(productId: string, input: ReplaceCatalogProductMediaRequest, context: JoiningCaseMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CatalogProductResponse }>> {
  if (!productId.trim() || input.media.length > 21) throw new Error("DSH_PRODUCT_MEDIA_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PRODUCT_MEDIA_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.replaceCatalogProductMedia.path.replace("{productId}", encodeURIComponent(productId.trim()));
  return requestDshJson<CatalogProductResponse>(dshOperationPaths.replaceCatalogProductMedia.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export function readMediaProvenanceInput(form: FormData): MediaProvenanceInput | null {
  const creator = form.get("creator");
  const sourceDescription = form.get("sourceDescription");
  const sourceUri = form.get("sourceUri");
  const rightsStatement = form.get("rightsStatement");
  const rightsUri = form.get("rightsUri");
  if (typeof creator !== "string" || typeof sourceDescription !== "string" || (sourceUri !== null && typeof sourceUri !== "string") || typeof rightsStatement !== "string" || (rightsUri !== null && typeof rightsUri !== "string") || form.get("rightsAttested") !== "true") return null;
  const value: MediaProvenanceInput = { creator, sourceDescription, ...(sourceUri ? { sourceUri } : {}), rightsStatement, ...(rightsUri ? { rightsUri } : {}), rightsAttested: true };
  return isMediaProvenanceInputValid(value) ? value : null;
}

export async function uploadCatalogProductMedia(productId: string, file: File, role: "primary" | "gallery", provenance: MediaProvenanceInput, context: JoiningCaseMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CatalogProductResponse }>> {
  if (!productId.trim() || file.size < 1 || file.size > 10 * 1024 * 1024 || (role !== "primary" && role !== "gallery") || !isMediaProvenanceInputValid(provenance)) throw new Error("DSH_PRODUCT_MEDIA_UPLOAD_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PRODUCT_MEDIA_UPLOAD_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.uploadCatalogProductMedia.path.replace("{productId}", encodeURIComponent(productId.trim()));
  const body = new FormData();
  body.set("role", role);
  body.set("file", file, file.name || "product-image");
  appendMediaProvenance(body, provenance);
  return requestDshMultipart<CatalogProductResponse>(dshOperationPaths.uploadCatalogProductMedia.method, path, body, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
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
