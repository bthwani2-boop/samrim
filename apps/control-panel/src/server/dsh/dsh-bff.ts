import { appendMediaProvenance } from "./dsh-transport";

import type { StoreOrderRatingListResponse, PartnerStoreOrderSummaryResponse } from "@bthwani/dsh";

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

import type { CatalogStoreOfferResponse, CreateStoreOfferRequest, UpdateStoreOfferRequest } from "@bthwani/dsh";

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

import { normalizeYemenPhoneE164 } from "@bthwani/identity/phone";
import type { OperatorMarketingSummary, PromotionSettlementSummary } from "@bthwani/dsh";
import type { CatalogStoreOfferListResponse, HRAccessRequest as DshHRAccessRequest, HRAccessRequestInput as DshHRAccessRequestInput, HRAccessRequestMutationResponse as DshHRAccessRequestMutationResponse, HRAccessRequestPage as DshHRAccessRequestPage, HRAccessRequestReadResponse as DshHRAccessRequestReadResponse, HREmployee as DshHREmployee, HREmployeePage as DshHREmployeePage, HRUpdateEmployeeRequest as DshHRUpdateEmployeeRequest, HRUpdateEmployeeResponse as DshHRUpdateEmployeeResponse, StoreTypeCommissionDefaultsResponse as DshStoreTypeCommissionDefaultsResponse, FinanceStoreCommercialAgreementQueueResponse, HRCreateEmployeeRequest, JoiningCaseProofDetailsResponse, StoreAccessGrantListResponse, StoreAccessGrantMutationResponse, StoreCommercialAgreementListResponse, StoreCommercialAgreementMutationResponse, StoreImagesResponse, StorePayoutRecipientListResponse, UpdateCatalogAttributeDefinitionRequest, UpdateCatalogAttributeEnumOptionRequest } from "@bthwani/dsh";
import { type ActorLegalName, type BeneficiaryPayoutState, type BeneficiaryPayoutStateResponse, type CaptainAdmissionListResponse, type CaptainAdmissionRequest, type CaptainAdmissionResponse, type CaptainAssignmentResponse, type CaptainOfferResponse, type CashCustodyRegistryResponse, type CatalogAttributeDefinitionListResponse, type CatalogAttributeDefinitionResponse, type CatalogAttributeEnumOptionListResponse, type CatalogAttributeEnumOptionResponse, type CatalogAttributeRuleListResponse, type CatalogCategoryDetailResponse, type CatalogCategoryListResponse, type CatalogCategoryResponse, type CatalogImportCommitResponse, type CatalogImportPreviewRequest, type CatalogImportPreviewResponse, type CatalogImportRunResponse, type CatalogProduct, type CatalogProductListResponse, type CatalogProductProposalListResponse, type CatalogProductProposalResponse, type CatalogProductRegistryResponse, type CatalogProductResponse, type CommerceVerticalListResponse, type CommerceVerticalResponse, type CommercialStoreTypeListResponse, type CommercialStoreTypeResponse, type CreateCatalogAttributeDefinitionRequest, type CreateCatalogAttributeEnumOptionRequest, type CreateCatalogCategoryRequest, type CreateCatalogProductRequest, type CreateCommerceVerticalRequest, type CreateCommercialStoreTypeRequest, type CreateCustomerWithdrawalIntakeRequest, type CreateDeliveryFeePolicyRequest, type CreateJoiningCaseRequest, type CreatePartnerFinancialTermsPolicyRequest, type CreatePromotionRequest, type CreateServiceCityRequest, type CustomerWithdrawalDecisionRequest, type CustomerWithdrawalIntakeListResponse, type CustomerWithdrawalIntakeResponse, type DeliveryFeePolicyResponse, type DiscoveryContentAnalyticsListResponse, type DiscoveryContentResponse, dshOperationPaths, type FinanceEvidenceDocument, isMediaProvenanceInputValid, type JoiningCaseListResponse, type JoiningCaseResponse, type ManagedCaptainAvailabilityRequest, type ManagedRoleMutationRequest, type ManagedRoleReenrollmentRequest, type MarketingPublicationRequest, type MediaProvenanceInput, type NotificationListResponse, type NotificationReadResponse, type OfficialWalletDestination, type OperatorDiscoveryContentRegistryResponse, type OperatorFieldFinanceRosterResponse, type OperatorOperationResponse, type OperatorOperationsResponse, type OperatorPromotionRegistryResponse, type OperatorStoreListResponse, type PartnerCommissionReceivableRegistryResponse, type PartnerCommissionRemittanceRequest, type PartnerCommissionRemittanceResponse, type PartnerFinancialSummaryResponse, type PartnerFinancialTermsPolicyResponse, type PartnerStoreListResponse, type PayoutRequest, type PromotionResponse, type PublicationAction, type ReplaceCatalogProductMediaRequest, type ReviewCatalogProductProposalRequest, type ReviewJoiningCaseRequest, type ServiceCityListResponse, type ServiceCityResponse, type SetStoreCommercialTypeRequest, type SetStoreCommercialTypeResponse, type SetStoreFulfillmentModesRequest, type SettlementBatch, type SettlementBatchExport, type StoreFulfillmentModesResponse, type StorePublicationRequest, type StorePublicationResponse, type StoreTypeCommissionDefaultsResponse, type StoreTypeCommissionDefaultUpdateResponse, type SubmitActorLegalNameRequest, type UpdateCatalogCategoryRequest, type UpdateCatalogProductRequest, type UpdateCommerceVerticalRequest, type UpdateCommercialStoreTypeRequest, type UpdateServiceCityRequest, type UpdateStoreTypeCommissionDefaultRequest, type UpsertCatalogAttributeRuleRequest, type VerifyActorLegalNameRequest } from "@bthwani/dsh";

import { dshBaseUrl, dshToken, parseErrorPayload, requestDshJson, requestDshMultipart, requestDshFile, validateAttributedMutationContext, validateVersionedMutationContext } from "./dsh-transport";
import type { DshAttributedMutationContext, DshClientError, DshOperatorReadContext, DshVersionedMutationContext, JoiningCaseMutationContext, StorePublicationMutationContext } from "./dsh-transport";
export { requestDshJson, isDshClientError, dshErrorPayload, dshHttpStatus } from "./dsh-transport";
export type { DshOperatorReadContext, DshVersionedMutationContext, JoiningCaseMutationContext, StorePublicationMutationContext } from "./dsh-transport";

const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;

export type WalletProvider = Readonly<{ key: string; displayNameAr: string; active: boolean; version: number; logoUri: string }>;
export type WalletProviderListResponse = Readonly<{ walletProviders: ReadonlyArray<WalletProvider> }>;
type WalletProviderResponse = Readonly<{ walletProvider: WalletProvider }>;

/** Store-scoped list, authorized by Identity partners in DSH as well as the Control Panel route. */
export async function listOperatorStoreOffers(storeId: string, cursor: string, context: DshOperatorReadContext, limit = 8): Promise<CatalogStoreOfferListResponse> {
  if (!storeId.trim() || storeId.length > 128 || cursor.length > 2048 || limit < 1 || limit > 100) throw new Error("DSH_OPERATOR_STORE_OFFERS_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return (await requestDshJson<CatalogStoreOfferListResponse>("GET", `/dsh/operator/stores/${encodeURIComponent(storeId.trim())}/offers?${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listOperatorWalletProviders(includeInactive: boolean, context: DshOperatorReadContext): Promise<WalletProviderListResponse> {
  const query = includeInactive ? "?includeInactive=true" : "";
  return (await requestDshJson<WalletProviderListResponse>("GET", `/dsh/wallet-providers${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorWalletProvider(input: Readonly<{ displayNameAr: string; active: boolean }>, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: WalletProviderResponse }>> {
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_IDEMPOTENCY_KEY_MISSING");
  return requestDshJson<WalletProviderResponse>("POST", "/dsh/wallet-providers", input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateOperatorWalletProvider(providerKey: string, input: Readonly<{ displayNameAr: string; active: boolean }>, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: WalletProviderResponse }>> {
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_IDEMPOTENCY_KEY_MISSING");
  const key = providerKey.trim();
  if (!key || key.length > 128) throw new Error("DSH_WALLET_PROVIDER_KEY_INVALID");
  return requestDshJson<WalletProviderResponse>("PATCH", `/dsh/wallet-providers/${encodeURIComponent(key)}`, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function uploadOperatorWalletProviderLogo(providerKey: string,file: File,provenance: MediaProvenanceInput,context: JoiningCaseMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{status:number;payload:WalletProviderResponse}>> {
 if(!providerKey.trim() || file.size<1 || file.size>10*1024*1024 || !["image/jpeg","image/png"].includes(file.type) || !isMediaProvenanceInputValid(provenance)) throw new Error("WALLET_PROVIDER_LOGO_INVALID");
 validateVersionedMutationContext(context);
 const body=new FormData();
 body.set("file",file,file.name || "wallet-logo");
 appendMediaProvenance(body,provenance);
 return requestDshMultipart<WalletProviderResponse>("POST","/dsh/wallet-providers/"+encodeURIComponent(providerKey.trim())+"/logo/upload",body,{"X-Acting-Actor-ID":context.operatorActorId.trim(),"X-Correlation-ID":context.correlationId.trim(),"X-Expected-Version":String(context.expectedVersion),"Idempotency-Key":context.idempotencyKey.trim()});
}

export * from "./hr-bff";

export async function listServiceCities(includeInactive: boolean, context: DshOperatorReadContext): Promise<ServiceCityListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_SERVICE_CITY_READ_INPUT_INVALID");
  const query = includeInactive ? "?includeInactive=true" : "";
  return (await requestDshJson<ServiceCityListResponse>(dshOperationPaths.listServiceCities.method, `${dshOperationPaths.listServiceCities.path}${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readServiceCity(cityId: string, context: DshOperatorReadContext): Promise<ServiceCityResponse> {
  if (!cityId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_SERVICE_CITY_READ_INPUT_INVALID");
  const path = dshOperationPaths.readServiceCity.path.replace("{cityId}", encodeURIComponent(cityId.trim()));
  return (await requestDshJson<ServiceCityResponse>(dshOperationPaths.readServiceCity.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createServiceCity(input: CreateServiceCityRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: ServiceCityResponse }>> {
  if (!input.displayNameAr.trim()) throw new Error("DSH_SERVICE_CITY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_SERVICE_CITY_IDEMPOTENCY_INVALID");
  return requestDshJson<ServiceCityResponse>(dshOperationPaths.createServiceCity.method, dshOperationPaths.createServiceCity.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateServiceCity(cityId: string, input: UpdateServiceCityRequest, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: ServiceCityResponse }>> {
  if (!cityId.trim() || !input.displayNameAr.trim()) throw new Error("DSH_SERVICE_CITY_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_SERVICE_CITY_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateServiceCity.path.replace("{cityId}", encodeURIComponent(cityId.trim()));
  return requestDshJson<ServiceCityResponse>(dshOperationPaths.updateServiceCity.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

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

export async function listOperatorStores(state: string, search: string, serviceCityId: string, searchMode: string, sort: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<OperatorStoreListResponse> {
	const normalizedState = state.trim();
	const normalizedSearch = search.trim();
	const normalizedCityId = serviceCityId.trim();
	const normalizedSearchMode = searchMode.trim() || "contains";
	const normalizedSort = sort.trim() || "updated_desc";
	const normalizedCursor = cursor.trim();
	const namePrefixSearch = normalizedSearchMode === "name_prefix";
	if (!context.operatorActorId.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || normalizedCursor.length > 1024 || Array.from(normalizedSearch).length > 128 || normalizedCityId.length > 128 || (normalizedState !== "" && normalizedState !== "unpublished" && normalizedState !== "published" && normalizedState !== "hidden") || (normalizedSearchMode !== "contains" && !namePrefixSearch) || (normalizedSort !== "updated_desc" && normalizedSort !== "updated_asc" && normalizedSort !== "name_asc") || (namePrefixSearch && (normalizedState !== "published" || Array.from(normalizedSearch).length < 2 || !normalizedCityId || normalizedSort !== "name_asc")) || (!namePrefixSearch && normalizedSort === "name_asc")) {
		throw new Error("DSH_OPERATOR_STORES_INPUT_INVALID");
	}
	const query = new URLSearchParams({ limit: String(limit) });
	if (normalizedState) query.set("state", normalizedState);
	if (normalizedSearch) query.set("q", normalizedSearch);
	if (normalizedCityId) query.set("serviceCityId", normalizedCityId);
	if (namePrefixSearch) query.set("searchMode", normalizedSearchMode);
	if (normalizedSort !== "updated_desc") query.set("sort", normalizedSort);
	if (normalizedCursor) query.set("cursor", normalizedCursor);
	const path = `${dshOperationPaths.listOperatorStores.path}?${query.toString()}`;
	return (await requestDshJson<OperatorStoreListResponse>(dshOperationPaths.listOperatorStores.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorHomeAnalytics(context: DshOperatorReadContext, period: "7d" | "30d" = "7d"): Promise<import("@bthwani/dsh").OperatorHomeAnalytics> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_ANALYTICS_ACTOR_REQUIRED");
  return (await requestDshJson<import("@bthwani/dsh").OperatorHomeAnalytics>(
    dshOperationPaths.readOperatorHomeAnalytics.method,
    `${dshOperationPaths.readOperatorHomeAnalytics.path}?period=${period}`,
    undefined,
    { "X-Acting-Actor-ID": context.operatorActorId.trim() },
  )).payload;
}

export type OperatorOperationsFilters = Readonly<{
  storeName?: string;
  fromDate?: string;
  toDate?: string;
  paymentSource?: string;
  fulfillmentMode?: string;
}>;

export async function listOperatorOperations(state: string, search: string, sort: string, limit: number, cursor: string, actionableOnly: boolean, context: DshOperatorReadContext, storeId = "", filters: OperatorOperationsFilters = {}): Promise<OperatorOperationsResponse> {
	if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor.trim().length > 2048 || search.trim().length > 128 || (sort !== "updated_desc" && sort !== "updated_asc") || storeId.length > 128) {
		throw new Error("DSH_OPERATOR_OPERATIONS_INPUT_INVALID");
	}
	const params = new URLSearchParams({ limit: String(limit) });
	if (state.trim()) params.set("state", state.trim());
	if (search.trim()) params.set("q", search.trim());
	if (sort !== "updated_desc") params.set("sort", sort);
	if (cursor.trim()) params.set("cursor", cursor.trim());
	if (actionableOnly) params.set("actionableOnly", "true");
	if (storeId.trim()) params.set("storeId", storeId.trim());
	for (const key of ["storeName", "fromDate", "toDate", "paymentSource", "fulfillmentMode"] as const) {
		const value = filters[key]?.trim();
		if (value) params.set(key, value);
	}
	const path = `${dshOperationPaths.listOperatorOperations.path}?${params.toString()}`;
	const payload = (await requestDshJson<OperatorOperationsResponse>(dshOperationPaths.listOperatorOperations.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
	if (Object.values(filters).some(value => Boolean(value?.trim())) && payload.filterEngineVersion !== 1) {
		throw new Error("DSH_OPERATOR_FILTER_ENGINE_UPGRADE_REQUIRED");
	}
	return payload;
}

export async function listOperatorNotifications(limit: number, context: DshOperatorReadContext, cursor = ""): Promise<NotificationListResponse> {
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor.length > 1024) {
    throw new Error("DSH_OPERATOR_NOTIFICATIONS_INPUT_INVALID");
  }
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const path = `${dshOperationPaths.listNotifications.path}?${params.toString()}`;
  return (await requestDshJson<NotificationListResponse>(dshOperationPaths.listNotifications.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function markOperatorNotificationRead(notificationId: string, context: DshOperatorReadContext): Promise<NotificationReadResponse> {
  if (!notificationId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_NOTIFICATION_READ_INPUT_INVALID");
  const path = dshOperationPaths.markNotificationRead.path.replace("{notificationId}", encodeURIComponent(notificationId.trim()));
  return (await requestDshJson<NotificationReadResponse>(dshOperationPaths.markNotificationRead.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorOperation(orderId: string, context: DshOperatorReadContext): Promise<OperatorOperationResponse> {
	if (!orderId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_OPERATION_READ_INPUT_INVALID");
	const path = dshOperationPaths.readOperatorOperation.path.replace("{orderId}", encodeURIComponent(orderId.trim()));
	return (await requestDshJson<OperatorOperationResponse>(dshOperationPaths.readOperatorOperation.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export * from "./finance-bff";

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

export * from "./catalog-bff";

export * from "./joining-bff";

export * from "./captain-bff";

export * from "./marketing-bff";

export async function readOperatorStoreImages(storeId: string,context: DshOperatorReadContext): Promise<StoreImagesResponse> {
 const result=await requestDshJson<StoreImagesResponse>("GET",dshOperationPaths.readOperatorStoreImages.path.replace("{storeId}",encodeURIComponent(storeId.trim())),undefined,{"X-Acting-Actor-ID":context.operatorActorId.trim()});
 return result.payload;
}

export * from "./policy-bff";

export * from "./store-operations-bff";

// Operator and Captain see the same coarse, privacy-filtered Store-origin signal.
import type { CaptainOpportunityHeatmap } from "@bthwani/dsh";

export async function readOperatorOpportunities(context: DshOperatorReadContext): Promise<CaptainOpportunityHeatmap> {
  const response = await requestDshJson<CaptainOpportunityHeatmap>("GET", "/dsh/operator/opportunities", undefined, {
    "X-Acting-Actor-ID": context.operatorActorId,
  });
  return response.payload;
}
