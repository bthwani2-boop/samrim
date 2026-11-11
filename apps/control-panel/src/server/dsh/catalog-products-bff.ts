import { type CatalogActivityPage, type CatalogImportCommitResponse, type CatalogImportPreviewRequest, type CatalogImportPreviewResponse, type CatalogImportRunResponse, type CatalogInventorySummaryResponse, type CatalogProduct, type CatalogProductListResponse, type CatalogProductProposalListResponse, type CatalogProductProposalResponse, type CatalogProductRegistryResponse, type CatalogProductResponse, type CatalogStoreOfferListResponse, type CatalogStoreOfferResponse, type CreateCatalogProductRequest, type CreateStoreOfferRequest, dshOperationPaths, isMediaProvenanceInputValid, type MediaProvenanceInput, type ReplaceCatalogProductMediaRequest, type ReviewCatalogProductProposalRequest, type ShoppingShortcutListResponse, type ShoppingShortcutMutationRequest, type ShoppingShortcutMutationResponse, type UpdateCatalogProductRequest, type UpdateStoreOfferRequest } from "@bthwani/dsh";
import { appendMediaProvenance, type DshOperatorReadContext, type DshVersionedMutationContext, type JoiningCaseMutationContext, requestDshJson, requestDshMultipart, type StorePublicationMutationContext, validateAttributedMutationContext, validateVersionedMutationContext } from "./dsh-transport";



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

export function readOperatorStoreProduct(storeId: string, productId: string, context: DshOperatorReadContext): Promise<CatalogProduct> {
  const path=dshOperationPaths.readOperatorStoreProduct.path.replace("{storeId}",encodeURIComponent(storeId)).replace("{productId}",encodeURIComponent(productId));
  return requestDshJson<CatalogProduct>("GET",path,undefined,{"X-Acting-Actor-ID":context.operatorActorId}).then(r=>r.payload);
}
export function updateOperatorStoreProduct(storeId:string,productId:string,input:UpdateCatalogProductRequest,context:StorePublicationMutationContext){
  validateVersionedMutationContext(context);
  const path=dshOperationPaths.updateOperatorStoreProduct.path.replace("{storeId}",encodeURIComponent(storeId)).replace("{productId}",encodeURIComponent(productId));
  return requestDshJson<CatalogProductResponse>("PATCH",path,input,{"X-Acting-Actor-ID":context.operatorActorId,"X-Correlation-ID":context.correlationId,"Idempotency-Key":context.idempotencyKey,"X-Expected-Version":String(context.expectedVersion)});
}
export function uploadOperatorStoreProductMedia(storeId:string,productId:string,file:File,provenance:MediaProvenanceInput,context:StorePublicationMutationContext){
  validateVersionedMutationContext(context);
  if(!isMediaProvenanceInputValid(provenance))throw new Error("PRODUCT_MEDIA_PROVENANCE_REQUIRED");
  const path=dshOperationPaths.uploadOperatorStoreProductMedia.path.replace("{storeId}",encodeURIComponent(storeId)).replace("{productId}",encodeURIComponent(productId));
  const body=new FormData();body.set("role","primary");body.set("file",file,file.name);appendMediaProvenance(body,provenance);
  return requestDshMultipart<CatalogProductResponse>("POST",path,body,{"X-Acting-Actor-ID":context.operatorActorId,"X-Correlation-ID":context.correlationId,"Idempotency-Key":context.idempotencyKey,"X-Expected-Version":String(context.expectedVersion)});
}

export function listOperatorStoreCatalogProducts(storeId: string, q: string, cursor: string, context: DshOperatorReadContext): Promise<CatalogProductListResponse> {
  const query = new URLSearchParams({ q, cursor, limit: "30" });
  return requestDshJson<CatalogProductListResponse>("GET", `/dsh/operator/stores/${encodeURIComponent(storeId)}/products?${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId }).then((r) => r.payload);
}
export function createOperatorStoreCatalogProduct(storeId: string, input: CreateCatalogProductRequest, context: JoiningCaseMutationContext) {
  validateAttributedMutationContext(context);
  return requestDshJson<CatalogProductResponse>("POST", `/dsh/operator/stores/${encodeURIComponent(storeId)}/products`, input, { "X-Acting-Actor-ID": context.operatorActorId, "X-Correlation-ID": context.correlationId, "Idempotency-Key": context.idempotencyKey });
}
export function createOperatorStoreCatalogOffer(storeId: string, input: CreateStoreOfferRequest, context: JoiningCaseMutationContext) {
  validateAttributedMutationContext(context);
  return requestDshJson<CatalogStoreOfferResponse>("POST", `/dsh/operator/stores/${encodeURIComponent(storeId)}/offers`, input, { "X-Acting-Actor-ID": context.operatorActorId, "X-Correlation-ID": context.correlationId, "Idempotency-Key": context.idempotencyKey });
}
export function updateOperatorStoreCatalogOffer(storeId: string, offerId: string, input: UpdateStoreOfferRequest, context: StorePublicationMutationContext) {
  validateVersionedMutationContext(context);
  return requestDshJson<CatalogStoreOfferResponse>("PATCH", `/dsh/operator/stores/${encodeURIComponent(storeId)}/offers/${encodeURIComponent(offerId)}`, input, { "X-Acting-Actor-ID": context.operatorActorId, "X-Correlation-ID": context.correlationId, "Idempotency-Key": context.idempotencyKey, "X-Expected-Version": String(context.expectedVersion) });
}

/** Store-scoped list, authorized by Identity partners in DSH as well as the Control Panel route. */
export async function listOperatorStoreOffers(storeId: string, cursor: string, context: DshOperatorReadContext, limit = 8): Promise<CatalogStoreOfferListResponse> {
  if (!storeId.trim() || storeId.length > 128 || cursor.length > 2048 || limit < 1 || limit > 100) throw new Error("DSH_OPERATOR_STORE_OFFERS_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return (await requestDshJson<CatalogStoreOfferListResponse>("GET", `/dsh/operator/stores/${encodeURIComponent(storeId.trim())}/offers?${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorStoreInventorySummary(storeId: string, context: DshOperatorReadContext): Promise<CatalogInventorySummaryResponse> {
 const id=storeId.trim();
 const actor=context.operatorActorId.trim();
 if (!id || id.length>128 || !actor) throw new Error("DSH_STORE_INVENTORY_SCOPE_INVALID");
 return (await requestDshJson<CatalogInventorySummaryResponse>("GET", "/dsh/operator/stores/"+encodeURIComponent(id)+"/inventory-summary", undefined, {"X-Acting-Actor-ID":actor})).payload;
}

export type CatalogActivityQuery = Readonly<{
  q?: string; kind?: string; action?: string; storeId?: string;
  from?: string; to?: string; cursor?: string; limit?: string;
}>;

export async function listOperatorCatalogActivity(filters: CatalogActivityQuery, context: DshOperatorReadContext): Promise<CatalogActivityPage> {
  if (!context.operatorActorId.trim()) throw new Error("CATALOG_ACTIVITY_ACTOR_REQUIRED");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value?.trim()) params.set(key, value.trim());
  }
  return (await requestDshJson<CatalogActivityPage>(
    "GET", `/dsh/operator/catalog-activity?${params}`, undefined,
    { "X-Acting-Actor-ID": context.operatorActorId.trim() },
  )).payload;
}

// Shopping shortcuts are catalog-owned presentation definitions, not commercial types.



export async function listShoppingShortcuts(context: DshOperatorReadContext, verticalId: string): Promise<ShoppingShortcutListResponse> {
  if (!context.operatorActorId.trim() || !verticalId.trim()) throw new Error("DSH_SHOPPING_SHORTCUT_READ_INVALID");
  const q = new URLSearchParams({ verticalId: verticalId.trim() });
  return (await requestDshJson<ShoppingShortcutListResponse>(dshOperationPaths.listShoppingShortcuts.method,
    `${dshOperationPaths.listShoppingShortcuts.path}?${q}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function mutateShoppingShortcut(input: ShoppingShortcutMutationRequest, context: JoiningCaseMutationContext, id = ""): Promise<Readonly<{ status: number; payload: ShoppingShortcutMutationResponse }>> {
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_SHOPPING_SHORTCUT_IDEMPOTENCY_INVALID");
  const update = Boolean(id);
  const operation = update ? dshOperationPaths.updateShoppingShortcut : dshOperationPaths.createShoppingShortcut;
  const path = update ? operation.path.replace("{shortcutId}", encodeURIComponent(id.trim())) : operation.path;
  return requestDshJson<ShoppingShortcutMutationResponse>(operation.method, path, input, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(),
  });
}
