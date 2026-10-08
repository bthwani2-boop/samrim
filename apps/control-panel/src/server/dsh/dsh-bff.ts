import { isMediaProvenanceInputValid, type ActorLegalName, type CatalogAttributeDefinitionListResponse, type CatalogAttributeDefinitionResponse, type CatalogAttributeEnumOptionListResponse, type CatalogAttributeEnumOptionResponse, type CatalogAttributeRuleListResponse, type CatalogProduct, type CatalogProductRegistryResponse, type CreateCatalogAttributeDefinitionRequest, type CreateCatalogAttributeEnumOptionRequest, type CreateCustomerWithdrawalIntakeRequest, type CustomerWithdrawalDecisionRequest, type CustomerWithdrawalIntakeListResponse, type CustomerWithdrawalIntakeResponse, type ManagedCaptainAvailabilityRequest, type MediaProvenanceInput, type PartnerStoreListResponse, type SubmitActorLegalNameRequest, type UpsertCatalogAttributeRuleRequest, type VerifyActorLegalNameRequest, type BeneficiaryPayoutState, type BeneficiaryPayoutStateResponse, type CaptainAdmissionListResponse, type CaptainAdmissionRequest, type CaptainAdmissionResponse, type CaptainAssignmentResponse, type CaptainOfferResponse, type CashCustodyRegistryResponse, type CatalogCategoryDetailResponse, type CatalogCategoryListResponse, type CatalogCategoryResponse, type CatalogImportCommitResponse, type CatalogImportPreviewRequest, type CatalogImportPreviewResponse, type CatalogImportRunResponse, type CatalogProductListResponse, type CatalogProductProposalListResponse, type CatalogProductProposalResponse, type CatalogProductResponse, type CommerceVerticalListResponse, type CommerceVerticalResponse, type CreateCatalogCategoryRequest, type CreateCatalogProductRequest, type CreateCommerceVerticalRequest, type CreateDeliveryFeePolicyRequest, type CreateJoiningCaseRequest, type CreatePartnerFinancialTermsPolicyRequest, type CreatePromotionRequest, type CreateServiceCityRequest, type DeliveryFeePolicyResponse, type DiscoveryContentAnalyticsListResponse, type DiscoveryContentResponse, dshOperationPaths, type FieldAdmissionListResponse, type FieldAdmissionRequest, type FieldAdmissionResponse, type FieldAcquisitionRewardPolicy, type ManagedRoleReenrollmentRequest, type FinanceEvidenceDocument, type JoiningCaseListResponse, type JoiningCaseResponse, type ManagedRoleMutationRequest, type MarketingPublicationRequest, type NotificationListResponse, type NotificationReadResponse, type OfficialWalletDestination, type OperatorDiscoveryContentRegistryResponse, type OperatorOperationResponse, type OperatorOperationsResponse, type OperatorPromotionRegistryResponse, type OperatorStoreListResponse, type PartnerCommissionReceivableRegistryResponse, type PartnerCommissionRemittanceRequest, type PartnerCommissionRemittanceResponse, type PartnerFinancialSummaryResponse, type PartnerFinancialTermsPolicyResponse, type StoreTypeCommissionDefaultsResponse, type UpdateStoreTypeCommissionDefaultRequest, type StoreTypeCommissionDefaultUpdateResponse, type PayoutRequest, type PromotionResponse, type PublicationAction, type ReplaceCatalogProductMediaRequest, type ReviewCatalogProductProposalRequest, type ReviewJoiningCaseRequest, type ServiceCityListResponse, type ServiceCityResponse, type SetStoreFulfillmentModesRequest, type SettlementBatch, type SettlementBatchExport, type StoreFulfillmentModesResponse, type StorePublicationRequest, type StorePublicationResponse, type UpdateCatalogCategoryRequest, type UpdateCatalogProductRequest, type UpdateCommerceVerticalRequest, type UpdateServiceCityRequest, type CommercialStoreTypeListResponse, type CommercialStoreTypeResponse, type CreateCommercialStoreTypeRequest, type UpdateCommercialStoreTypeRequest, type SetStoreCommercialTypeRequest, type SetStoreCommercialTypeResponse } from "@bthwani/dsh";
import { validateServiceUrl } from "@bthwani/identity";
import { normalizeYemenPhoneE164 } from "@bthwani/design-system";
import type { StoreAccessGrantListResponse, StoreAccessGrantMutationResponse, StorePayoutRecipientListResponse } from "@bthwani/dsh";
import type { JoiningCaseProofDetailsResponse } from "@bthwani/dsh";
import type { FinanceStoreCommercialAgreementQueueResponse, StoreCommercialAgreementListResponse, StoreCommercialAgreementMutationResponse, StoreTypeCommissionDefaultsResponse as DshStoreTypeCommissionDefaultsResponse } from "@bthwani/dsh";

type DshClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>
  | Readonly<{ kind: "config"; message: string }>;

const phoneE164Pattern = /^\+[1-9][0-9]{7,14}$/;

type DshAttributedMutationContext = Readonly<{
  operatorActorId: string;
  correlationId: string;
}>;
export type DshVersionedMutationContext = DshAttributedMutationContext & Readonly<{
  expectedVersion: number;
}>;
export type JoiningCaseMutationContext = DshAttributedMutationContext & Readonly<{
  idempotencyKey: string;
}>;
export type StorePublicationMutationContext = DshVersionedMutationContext & Readonly<{
  idempotencyKey: string;
}>;
export type DshOperatorReadContext = Readonly<{
  operatorActorId: string;
}>;

export type CreateFieldAcquisitionRewardPolicyRequest = Readonly<{
  scopeType: "STORE_TYPE";
  scopeId: string;
  rewardMinor: number;
  roundingUnitMinor: 50;
  expectedVersion: number;
  reason: string;
}>;
type FieldAcquisitionRewardPolicyScope = Readonly<{ scopeType: "STORE_TYPE"; scopeId: string }>;
type FieldAcquisitionRewardPolicyResponse = Readonly<{ policy: FieldAcquisitionRewardPolicy; idempotentReplay: boolean }>;

function dshBaseUrl(): string {
  const explicit = process.env.DSH_API_BASE_URL?.trim();
  if (explicit) {
    try {
      return validateServiceUrl(explicit, "DSH_API_BASE_URL");
    } catch {
      throw { kind: "config", message: "dsh service must use HTTPS" } satisfies DshClientError;
    }
  }
  throw { kind: "config", message: "dsh service configuration is incomplete" } satisfies DshClientError;
}

function dshToken(): string {
  const token = process.env.CONTROL_PANEL_SERVICE_TOKEN?.trim();
  if (!token || token.length < 24) throw { kind: "config", message: "dsh service configuration is incomplete" } satisfies DshClientError;
  return token;
}

function validateAttributedMutationContext(context: DshAttributedMutationContext): void {
  if (!context.operatorActorId.trim() || !context.correlationId.trim()) {
    throw { kind: "config", message: "dsh mutation context is incomplete" } satisfies DshClientError;
  }
}

function validateVersionedMutationContext(context: DshVersionedMutationContext): void {
  validateAttributedMutationContext(context);
  if (!Number.isInteger(context.expectedVersion) || context.expectedVersion < 1) {
    throw { kind: "config", message: "dsh expected version is invalid" } satisfies DshClientError;
  }
}

function parseErrorPayload(value: unknown): { code: string; message: string } {
  if (!value || typeof value !== "object") return { code: "DSH_ERROR", message: "dsh request failed" };
  const nested = (value as { error?: unknown }).error;
  if (!nested || typeof nested !== "object") return { code: "DSH_ERROR", message: "dsh request failed" };
  const code = (nested as { code?: unknown }).code;
  const message = (nested as { message?: unknown }).message;
  return {
    code: typeof code === "string" && code.trim() ? code : "DSH_ERROR",
    message: typeof message === "string" && message.trim() ? message : "dsh request failed",
  };
}

export function isDshClientError(value: unknown): value is DshClientError {
  return Boolean(value && typeof value === "object" && (["http", "network", "config"] as const).includes((value as { kind?: unknown }).kind as "http" | "network" | "config"));
}

export function dshErrorPayload(error: unknown): Readonly<{ code: string; message: string }> {
  if (!isDshClientError(error)) return { code: "DSH_INTERNAL_ERROR", message: "dsh request failed" };
  if (error.kind === "network") return { code: "DSH_UNAVAILABLE", message: "dsh service is unavailable" };
  if (error.kind === "config") return { code: "DSH_CONFIG_ERROR", message: "dsh service configuration is incomplete" };
  return { code: error.code, message: error.message };
}

export function dshHttpStatus(error: unknown): number {
  if (!isDshClientError(error)) return 502;
  return error.kind === "network" ? 502 : error.kind === "config" ? 500 : error.status;
}

async function requestDshJson<T>(method: string, path: string, body: unknown | undefined, headers: Record<string, string>): Promise<Readonly<{ status: number; payload: T }>> {
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return { status: response.status, payload: response.status === 204 ? undefined as T : await response.json() as T };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestDshMultipart<T>(method: string, path: string, body: FormData, headers: Record<string, string>): Promise<Readonly<{ status: number; payload: T }>> {
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method, headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...headers }, body, signal: controller.signal });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    return { status: response.status, payload: await response.json() as T };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestDshFile(path: string, headers: Record<string, string>): Promise<Readonly<{ content: Uint8Array; contentType: string; contentDisposition: string }>> {
  const baseUrl = dshBaseUrl();
  const token = dshToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, { method: "GET", headers: { Accept: "application/octet-stream", Authorization: `Bearer ${token}`, ...headers }, cache: "no-store", signal: controller.signal });
    } catch (error) {
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshClientError;
    }
    if (!response.ok) {
      const parsed = parseErrorPayload(await response.json().catch(() => null));
      throw { kind: "http", status: response.status, code: parsed.code, message: parsed.message } satisfies DshClientError;
    }
    const content = new Uint8Array(await response.arrayBuffer());
    if (content.byteLength > 10 * 1024 * 1024) throw { kind: "http", status: 502, code: "INVALID_EVIDENCE_RESPONSE", message: "evidence response exceeds the supported size" } satisfies DshClientError;
    return { content, contentType: response.headers.get("content-type") ?? "application/octet-stream", contentDisposition: response.headers.get("content-disposition") ?? "" };
  } finally {
    clearTimeout(timeout);
  }
}

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

export async function listOperatorOperations(state: string, search: string, sort: string, limit: number, cursor: string, actionableOnly: boolean, context: DshOperatorReadContext): Promise<OperatorOperationsResponse> {
	if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor.trim().length > 512 || search.trim().length > 128 || (sort !== "updated_desc" && sort !== "updated_asc")) {
		throw new Error("DSH_OPERATOR_OPERATIONS_INPUT_INVALID");
	}
	const params = new URLSearchParams({ limit: String(limit) });
	if (state.trim()) params.set("state", state.trim());
	if (search.trim()) params.set("q", search.trim());
	if (sort !== "updated_desc") params.set("sort", sort);
	if (cursor.trim()) params.set("cursor", cursor.trim());
	if (actionableOnly) params.set("actionableOnly", "true");
	const path = `${dshOperationPaths.listOperatorOperations.path}?${params.toString()}`;
	return (await requestDshJson<OperatorOperationsResponse>(dshOperationPaths.listOperatorOperations.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listOperatorNotifications(limit: number, context: DshOperatorReadContext): Promise<NotificationListResponse> {
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("DSH_OPERATOR_NOTIFICATIONS_INPUT_INVALID");
  }
  const path = `${dshOperationPaths.listNotifications.path}?limit=${limit}`;
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

export async function listOperatorCashCustody(search: string, sort: "collected_asc" | "collected_desc", cursor: string, limit: number, context: DshOperatorReadContext): Promise<CashCustodyRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_CASH_CUSTODY_INPUT_INVALID");
  if (search.trim().length > 128 || cursor.length > 1024 || !["collected_asc", "collected_desc"].includes(sort) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_CASH_CUSTODY_REGISTRY_INPUT_INVALID");
  const query = new URLSearchParams({ search: search.trim(), sort, limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  const path = `${dshOperationPaths.listOperatorCashCustody.path}?${query.toString()}`;
  return (await requestDshJson<CashCustodyRegistryResponse>(dshOperationPaths.listOperatorCashCustody.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function reconcileOperatorCashRemittance(remittanceId: string, evidenceDocumentId: string, context: JoiningCaseMutationContext): Promise<import("@bthwani/dsh").CaptainCashRemittanceResponse> {
  if (!remittanceId.trim() || remittanceId.trim().length > 128 || !evidenceDocumentId.trim() || evidenceDocumentId.trim().length > 128) throw new Error("DSH_CASH_REMITTANCE_RECONCILIATION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.reconcileOperatorCashRemittance.path.replace("{remittanceId}", encodeURIComponent(remittanceId.trim()));
  return (await requestDshJson<import("@bthwani/dsh").CaptainCashRemittanceResponse>(dshOperationPaths.reconcileOperatorCashRemittance.method, path, { evidenceDocumentId: evidenceDocumentId.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function readOperatorPartnerFinancialSummary(partnerActorId: string, context: DshOperatorReadContext): Promise<PartnerFinancialSummaryResponse> {
  if (!partnerActorId.trim() || partnerActorId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_PARTNER_FINANCIAL_SUMMARY_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPartnerFinancialSummary.path.replace("{partnerActorId}", encodeURIComponent(partnerActorId.trim()));
  return (await requestDshJson<PartnerFinancialSummaryResponse>(dshOperationPaths.readOperatorPartnerFinancialSummary.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorPartnerStorePayoutRecipients(partnerActorId: string, context: DshOperatorReadContext): Promise<StorePayoutRecipientListResponse> {
  if (!partnerActorId.trim() || partnerActorId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_PARTNER_PAYOUT_RECIPIENTS_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPartnerStorePayoutRecipients.path.replace("{partnerActorId}", encodeURIComponent(partnerActorId.trim()));
  return (await requestDshJson<StorePayoutRecipientListResponse>(dshOperationPaths.readOperatorPartnerStorePayoutRecipients.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listOperatorPartnerCommissionReceivables(search: string, sort: "actor_asc" | "actor_desc", cursor: string, limit: number, context: DshOperatorReadContext): Promise<PartnerCommissionReceivableRegistryResponse> {
  if (!context.operatorActorId.trim() || search.trim().length > 128 || cursor.length > 1024 || !["actor_asc", "actor_desc"].includes(sort) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("DSH_PARTNER_COMMISSION_REGISTRY_INPUT_INVALID");
  }
  const query = new URLSearchParams({ sort, limit: String(limit) });
  if (search.trim()) query.set("search", search.trim());
  if (cursor.trim()) query.set("cursor", cursor.trim());
  const path = `${dshOperationPaths.listOperatorPartnerCommissionReceivables.path}?${query.toString()}`;
  return (await requestDshJson<PartnerCommissionReceivableRegistryResponse>(dshOperationPaths.listOperatorPartnerCommissionReceivables.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function recordOperatorPartnerCommissionRemittance(partnerActorId: string, input: PartnerCommissionRemittanceRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PartnerCommissionRemittanceResponse }>> {
  const normalizedPartnerActorID = partnerActorId.trim();
  if (!normalizedPartnerActorID || normalizedPartnerActorID.length > 128 || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1 || input.remittanceReference.trim().length < 1 || input.remittanceReference.trim().length > 128 || input.evidenceDocumentId.trim().length < 1 || input.evidenceDocumentId.trim().length > 128) {
    throw new Error("DSH_PARTNER_COMMISSION_REMITTANCE_INPUT_INVALID");
  }
  validateAttributedMutationContext(context);
  if (context.idempotencyKey.trim().length < 8 || context.idempotencyKey.trim().length > 128) throw new Error("DSH_PARTNER_COMMISSION_REMITTANCE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.recordPartnerCommissionRemittance.path.replace("{partnerActorId}", encodeURIComponent(normalizedPartnerActorID));
  return requestDshJson<PartnerCommissionRemittanceResponse>(dshOperationPaths.recordPartnerCommissionRemittance.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

type BeneficiaryActorType = "customer" | "partner" | "captain" | "field";
type OperatorDestinationResponse = Readonly<{ destination: OfficialWalletDestination; idempotentReplay?: boolean }>;
type OperatorWalletProviderIntentResponse = Readonly<{ intent: Readonly<{ actorType: "partner" | "captain" | "field"; actorId: string; providerKey: string; sourceId: string }> }>;
export async function readOperatorPayoutState(actorType: BeneficiaryActorType, actorId: string, context: DshOperatorReadContext): Promise<BeneficiaryPayoutStateResponse> {
  if (!("customer" === actorType || "partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_PAYOUT_STATE_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPayoutState.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<BeneficiaryPayoutStateResponse>(dshOperationPaths.readOperatorPayoutState.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorBeneficiaryRegistryResponse = Readonly<{ beneficiaries: ReadonlyArray<BeneficiaryPayoutState>; nextCursor?: string; limit: number }>;
type BeneficiaryRegistryActorType = "partner" | "captain" | "field";
export type BeneficiaryRegistrySort = "actor_asc" | "actor_desc" | "available_asc" | "available_desc" | "held_asc" | "held_desc" | "payout_amount_asc" | "payout_amount_desc";
export async function listOperatorBeneficiaryPayoutStates(actorType: BeneficiaryRegistryActorType | "", search: string, status: string, sort: BeneficiaryRegistrySort, cursor: string, limit: number, context: DshOperatorReadContext): Promise<OperatorBeneficiaryRegistryResponse> {
  if (!context.operatorActorId.trim() || (actorType && !(actorType === "partner" || actorType === "captain" || actorType === "field")) || search.trim().length > 128 || cursor.length > 512 || !Number.isInteger(limit) || limit < 1 || limit > 100 || status.length > 32 || !["actor_asc", "actor_desc", "available_asc", "available_desc", "held_asc", "held_desc", "payout_amount_asc", "payout_amount_desc"].includes(sort)) throw new Error("DSH_BENEFICIARY_REGISTRY_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (actorType) query.set("actorType", actorType);
  if (search.trim()) query.set("search", search.trim());
  if (status.trim()) query.set("status", status.trim());
  query.set("sort", sort);
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<OperatorBeneficiaryRegistryResponse>(dshOperationPaths.listOperatorBeneficiaryPayoutStates.method, `${dshOperationPaths.listOperatorBeneficiaryPayoutStates.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorDestination(actorType: BeneficiaryActorType, actorId: string, context: DshOperatorReadContext): Promise<OperatorDestinationResponse> {
	if (!("customer" === actorType || "partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<OperatorDestinationResponse>(dshOperationPaths.readOperatorOfficialWalletDestination.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorWalletProviderIntent(actorType: "partner" | "captain" | "field", actorId: string, context: DshOperatorReadContext): Promise<OperatorWalletProviderIntentResponse> {
  if (!actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_WALLET_PROVIDER_INTENT_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorWalletProviderIntent.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<OperatorWalletProviderIntentResponse>(dshOperationPaths.readOperatorWalletProviderIntent.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorPendingActorLegalName(actorId: string, context: DshOperatorReadContext): Promise<Readonly<{ legalName: ActorLegalName }>> {
  if (!actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_LEGAL_NAME_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPendingActorLegalName.path.replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<Readonly<{ legalName: ActorLegalName }>>(dshOperationPaths.readOperatorPendingActorLegalName.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function submitOperatorActorLegalName(actorId: string, input: SubmitActorLegalNameRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ legalName: ActorLegalName }>> {
  if (!actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_LEGAL_NAME_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.submitOperatorActorLegalName.path.replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<Readonly<{ legalName: ActorLegalName }>>(dshOperationPaths.submitOperatorActorLegalName.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function verifyOperatorActorLegalName(actorId: string, version: number, input: VerifyActorLegalNameRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ legalName: ActorLegalName }>> {
  if (!actorId.trim() || !Number.isInteger(version) || version < 1 || !context.operatorActorId.trim()) throw new Error("DSH_LEGAL_NAME_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.verifyOperatorActorLegalName.path.replace("{actorId}", encodeURIComponent(actorId.trim())).replace("{version}", String(version));
  return (await requestDshJson<Readonly<{ legalName: ActorLegalName }>>(dshOperationPaths.verifyOperatorActorLegalName.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function createOperatorDestination(actorType: "partner" | "captain" | "field", actorId: string, input: Readonly<{ changeReason: string; verificationEvidenceReference: string; changeEvidenceReference: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: OperatorDestinationResponse }>> {
	if (!actorId.trim() || !input.changeReason.trim() || !input.verificationEvidenceReference.trim() || !input.changeEvidenceReference.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.createOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return requestDshJson<OperatorDestinationResponse>(dshOperationPaths.createOperatorOfficialWalletDestination.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function verifyOperatorDestination(actorType: BeneficiaryActorType, actorId: string, destinationId: string, evidenceReference: string, context: JoiningCaseMutationContext): Promise<OperatorDestinationResponse> {
  if (!("partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !destinationId.trim() || !evidenceReference.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.verifyOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim())).replace("{destinationId}", encodeURIComponent(destinationId.trim()));
  return (await requestDshJson<OperatorDestinationResponse>(dshOperationPaths.verifyOperatorOfficialWalletDestination.method, path, { evidenceReference }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function activateOperatorDestination(actorType: BeneficiaryActorType, actorId: string, destinationId: string, context: JoiningCaseMutationContext): Promise<OperatorDestinationResponse> {
  if (!("partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !destinationId.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.activateOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim())).replace("{destinationId}", encodeURIComponent(destinationId.trim()));
  return (await requestDshJson<OperatorDestinationResponse>(dshOperationPaths.activateOperatorOfficialWalletDestination.method, path, {}, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

type OperatorPayoutListResponse = Readonly<{ payouts: ReadonlyArray<PayoutRequest> }>;
type OperatorPayoutResponse = Readonly<{ payout: PayoutRequest }>;

export async function listOperatorPayoutRequests(status: string, context: DshOperatorReadContext): Promise<OperatorPayoutListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_PAYOUT_QUEUE_INPUT_INVALID");
  const query = status.trim() ? `?status=${encodeURIComponent(status.trim())}` : "";
  return (await requestDshJson<OperatorPayoutListResponse>(dshOperationPaths.listOperatorPayoutRequests.method, `${dshOperationPaths.listOperatorPayoutRequests.path}${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type FinanceEvidencePurpose = "TRANSFER_RECEIPT" | "SETTLEMENT_STATEMENT" | "CUSTOMER_WITHDRAWAL_REQUEST";
export type OperatorFinanceEvidenceResponse = Readonly<{ document: FinanceEvidenceDocument }>;
export type OperatorSettlementStatement = Readonly<{ id: string; batchId?: string | null; providerKey: string; currency: "YER"; periodStart: string; periodEnd: string; evidenceDocumentId: string; filename: string; artifactSHA256: string; uploadedBy: string; createdAt: string }>;
export type OperatorSettlementStatementRow = Readonly<{ id: string; statementId: string; rowSequence: number; externalTransferReference: string; amountMinor: number; currency: "YER"; transactionAt: string; recordedBy: string; matchedTransferId?: string | null }>;

export async function uploadOperatorFinanceEvidence(purpose: FinanceEvidencePurpose, file: File, context: JoiningCaseMutationContext): Promise<OperatorFinanceEvidenceResponse> {
  if (!(purpose === "TRANSFER_RECEIPT" || purpose === "SETTLEMENT_STATEMENT" || purpose === "CUSTOMER_WITHDRAWAL_REQUEST") || !file.size || file.size > 10 * 1024 * 1024 || !file.name.trim()) throw new Error("DSH_FINANCE_EVIDENCE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FINANCE_EVIDENCE_IDEMPOTENCY_INVALID");
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", file, file.name);
  return (await requestDshMultipart<OperatorFinanceEvidenceResponse>(dshOperationPaths.uploadOperatorFinanceEvidence.method, dshOperationPaths.uploadOperatorFinanceEvidence.path, form, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function uploadCustomerWithdrawalRequestEvidence(file: File, context: JoiningCaseMutationContext): Promise<OperatorFinanceEvidenceResponse> {
  if (!file.size || file.size > 10 * 1024 * 1024 || !file.name.trim()) throw new Error("DSH_FINANCE_EVIDENCE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const form = new FormData();
  form.set("file", file, file.name);
  return (await requestDshMultipart<OperatorFinanceEvidenceResponse>(dshOperationPaths.uploadCustomerWithdrawalRequestEvidence.method, dshOperationPaths.uploadCustomerWithdrawalRequestEvidence.path, form, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function listOperatorCustomerWithdrawalIntakes(status: string, search: string, sort: string, cursor: string, limit: number, context: DshOperatorReadContext): Promise<CustomerWithdrawalIntakeListResponse> {
  const normalizedStatus = status.trim();
  const normalizedSearch = search.trim();
  const normalizedSort = sort.trim() || "requested_desc";
  const normalizedCursor = cursor.trim();
  if (!context.operatorActorId.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || normalizedStatus.length > 32 || normalizedSearch.length > 128 || normalizedCursor.length > 1024 || (normalizedSort !== "requested_desc" && normalizedSort !== "requested_asc")) throw new Error("DSH_CUSTOMER_WITHDRAWAL_REGISTRY_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (normalizedStatus) query.set("status", normalizedStatus);
  if (normalizedSearch) query.set("search", normalizedSearch);
  query.set("sort", normalizedSort);
  if (normalizedCursor) query.set("cursor", normalizedCursor);
  return (await requestDshJson<CustomerWithdrawalIntakeListResponse>(dshOperationPaths.listOperatorCustomerWithdrawalIntakes.method, `${dshOperationPaths.listOperatorCustomerWithdrawalIntakes.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorCustomerWithdrawalIntake(intakeId: string, context: DshOperatorReadContext): Promise<CustomerWithdrawalIntakeResponse> {
  const normalized = intakeId.trim();
  if (!normalized || normalized.length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_CUSTOMER_WITHDRAWAL_READ_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorCustomerWithdrawalIntake.path.replace("{intakeId}", encodeURIComponent(normalized));
  return (await requestDshJson<CustomerWithdrawalIntakeResponse>(dshOperationPaths.readOperatorCustomerWithdrawalIntake.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorCustomerWithdrawalIntake(input: CreateCustomerWithdrawalIntakeRequest, context: JoiningCaseMutationContext): Promise<CustomerWithdrawalIntakeResponse> {
	const request: CreateCustomerWithdrawalIntakeRequest = { customerActorId: input.customerActorId.trim(), providerKey: input.providerKey.trim(), requestReason: input.requestReason.trim(), requestEvidenceDocumentId: input.requestEvidenceDocumentId.trim() };
	return (await requestDshJson<CustomerWithdrawalIntakeResponse>(dshOperationPaths.createOperatorCustomerWithdrawalIntake.method, dshOperationPaths.createOperatorCustomerWithdrawalIntake.path, request, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

async function customerWithdrawalDecision(operation: "prepareOperatorCustomerWithdrawalDestination" | "verifyOperatorCustomerWithdrawalDestination" | "activateOperatorCustomerWithdrawalDestination" | "acceptOperatorCustomerWithdrawal" | "rejectOperatorCustomerWithdrawal", intakeId: string, input: Readonly<Record<string, string>>, context: JoiningCaseMutationContext): Promise<Readonly<Record<string, unknown>>> {
  if (!intakeId.trim()) throw new Error("DSH_CUSTOMER_WITHDRAWAL_INPUT_INVALID");
  const path = dshOperationPaths[operation].path.replace("{intakeId}", encodeURIComponent(intakeId.trim()));
  return (await requestDshJson<Readonly<Record<string, unknown>>>(dshOperationPaths[operation].method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export const prepareOperatorCustomerWithdrawalDestination = (intakeId: string, input: CustomerWithdrawalDecisionRequest, context: JoiningCaseMutationContext) => customerWithdrawalDecision("prepareOperatorCustomerWithdrawalDestination", intakeId, input, context);
export const verifyOperatorCustomerWithdrawalDestination = (intakeId: string, evidenceReference: string, context: JoiningCaseMutationContext) => customerWithdrawalDecision("verifyOperatorCustomerWithdrawalDestination", intakeId, { evidenceReference }, context);
export const activateOperatorCustomerWithdrawalDestination = (intakeId: string, context: JoiningCaseMutationContext) => customerWithdrawalDecision("activateOperatorCustomerWithdrawalDestination", intakeId, {}, context);
export const acceptOperatorCustomerWithdrawal = (intakeId: string, input: CustomerWithdrawalDecisionRequest, context: JoiningCaseMutationContext) => customerWithdrawalDecision("acceptOperatorCustomerWithdrawal", intakeId, input, context);
export const rejectOperatorCustomerWithdrawal = (intakeId: string, input: CustomerWithdrawalDecisionRequest, context: JoiningCaseMutationContext) => customerWithdrawalDecision("rejectOperatorCustomerWithdrawal", intakeId, input, context);

export async function readOperatorFinanceEvidence(documentId: string, context: DshOperatorReadContext) {
  if (!documentId.trim() || documentId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_FINANCE_EVIDENCE_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorFinanceEvidence.path.replace("{documentId}", encodeURIComponent(documentId.trim()));
  return requestDshFile(path, { "X-Acting-Actor-ID": context.operatorActorId.trim() });
}

export async function registerOperatorSettlementStatement(input: Readonly<{ batchId?: string; providerKey: string; currency: "YER"; periodStart: string; periodEnd: string; evidenceDocumentId: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ statement: OperatorSettlementStatement }>> {
  if (!input.providerKey.trim() || !input.evidenceDocumentId.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd) || input.periodEnd < input.periodStart) throw new Error("DSH_SETTLEMENT_STATEMENT_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.registerOperatorSettlementStatement.path;
  return (await requestDshJson<Readonly<{ statement: OperatorSettlementStatement }>>(dshOperationPaths.registerOperatorSettlementStatement.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function recordOperatorSettlementStatementRow(statementId: string, input: Readonly<{ rowSequence: number; externalTransferReference: string; walletIdentifier: string; amountMinor: number; currency: "YER"; transactionAt: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ row: OperatorSettlementStatementRow }>> {
  if (!statementId.trim() || !Number.isSafeInteger(input.rowSequence) || input.rowSequence < 1 || !input.externalTransferReference.trim() || !input.walletIdentifier.trim() || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1 || !Number.isFinite(Date.parse(input.transactionAt))) throw new Error("DSH_SETTLEMENT_STATEMENT_ROW_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.recordOperatorStatementRow.path.replace("{statementId}", encodeURIComponent(statementId.trim()));
  return (await requestDshJson<Readonly<{ row: OperatorSettlementStatementRow }>>(dshOperationPaths.recordOperatorStatementRow.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export type OperatorSettlementBatchExport = SettlementBatchExport;

export async function exportOperatorSettlementBatch(batchId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ export: OperatorSettlementBatchExport }>> {
  if (!batchId.trim()) throw new Error("DSH_SETTLEMENT_BATCH_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.exportOperatorSettlementBatch.path.replace("{batchId}", encodeURIComponent(batchId.trim()));
  return (await requestDshJson<Readonly<{ export: OperatorSettlementBatchExport }>>(dshOperationPaths.exportOperatorSettlementBatch.method, path, {}, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function readOperatorSettlementBatch(batchId: string, context: DshOperatorReadContext): Promise<Readonly<{ batch: SettlementBatch }>> {
  if (!batchId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_SETTLEMENT_BATCH_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorSettlementBatch.path.replace("{batchId}", encodeURIComponent(batchId.trim()));
  return (await requestDshJson<Readonly<{ batch: SettlementBatch }>>(dshOperationPaths.readOperatorSettlementBatch.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorFinancialStatement = Readonly<{
  actorType: "customer" | "partner" | "captain" | "field";
  actorId: string;
  currency: "YER";
  periodStart: string;
  periodEnd: string;
  openingBalanceMinor: number;
  creditsMinor: number;
  debitsMinor: number;
  closingBalanceMinor: number;
  currentBalanceMinor: number;
  nextCursor?: string;
  limit: number;
  entries: ReadonlyArray<Readonly<{
    transactionId: string;
    transactionType: string;
    sourceType: string;
    sourceId: string;
    direction: "CREDIT" | "DEBIT";
    amountMinor: number;
    currency: "YER";
    createdAt: string;
    balanceAfterMinor: number;
    order?: Readonly<{
      orderId: string;
      storeName: string;
      state: string;
      fulfillmentMode: string;
      subtotalAmountMinor: number;
      discountMinor: number;
      totalAmountMinor: number;
      currency: "YER";
      createdAt: string;
      lines: ReadonlyArray<Readonly<{ productName: string; variantTitle: string; quantityBaseUnits: number; unitPriceMinor: number; lineAmountMinor: number; currency: "YER" }>>;
    }>;
  }>>;
}>;

export async function readOperatorBeneficiaryFinancialStatement(actorType: "customer" | "partner" | "captain" | "field", actorId: string, from: string, to: string, cursor: string, context: DshOperatorReadContext): Promise<Readonly<{ statement: OperatorFinancialStatement }>> {
  if (!actorId.trim() || actorId.length > 128 || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || !context.operatorActorId.trim()) throw new Error("DSH_FINANCIAL_STATEMENT_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorBeneficiaryFinancialStatement.path
    .replace("{actorType}", encodeURIComponent(actorType))
    .replace("{actorId}", encodeURIComponent(actorId.trim()));
  const query = new URLSearchParams({ from, to });
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<Readonly<{ statement: OperatorFinancialStatement }>>(dshOperationPaths.readOperatorBeneficiaryFinancialStatement.method, `${path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export type OperatorFinancialStatementSummaryRegistry = Readonly<{
  actorType: "customer" | "partner" | "captain" | "field";
  periodStart: string;
  periodEnd: string;
  summaries: ReadonlyArray<Readonly<{ actorType: string; actorId: string; displayName?: string; phoneMasked?: string; beneficiaryName?: string; walletIdentifierMasked?: string; currency: "YER"; openingBalanceMinor: number; creditsMinor: number; debitsMinor: number; closingBalanceMinor: number; currentBalanceMinor: number; heldMinor: number; availableMinor: number }>>;
  nextCursor?: string;
  limit: number;
}>;

export async function listOperatorFinancialStatementSummaries(actorType: OperatorFinancialStatementSummaryRegistry["actorType"], from: string, to: string, cursor: string, context: DshOperatorReadContext): Promise<OperatorFinancialStatementSummaryRegistry> {
  if (!context.operatorActorId.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new Error("DSH_FINANCIAL_STATEMENT_INPUT_INVALID");
  const query = new URLSearchParams({ actorType, from, to, limit: "200" });
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<OperatorFinancialStatementSummaryRegistry>(dshOperationPaths.listOperatorFinancialStatementSummaries.method, `${dshOperationPaths.listOperatorFinancialStatementSummaries.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listOperatorFieldAcquisitionCases(fieldActorId: string, queryText: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<JoiningCaseListResponse> {
  if (!fieldActorId.trim() || fieldActorId.length > 128 || queryText.trim().length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 512 || !context.operatorActorId.trim()) throw new Error("DSH_FIELD_ACQUISITION_QUERY_INVALID");
  const path = dshOperationPaths.listOperatorFieldAcquisitionCases.path.replace("{fieldActorId}", encodeURIComponent(fieldActorId.trim()));
  const query = new URLSearchParams({ limit: String(limit) });
  if (queryText.trim()) query.set("q", queryText.trim());
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<JoiningCaseListResponse>(dshOperationPaths.listOperatorFieldAcquisitionCases.method, `${path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorSettlementBatch(payoutIds: readonly string[], context: JoiningCaseMutationContext): Promise<Readonly<{ batch: SettlementBatch }>> {
  if (!payoutIds.length || payoutIds.length > 100 || payoutIds.some((id) => !id.trim())) throw new Error("DSH_SETTLEMENT_BATCH_INPUT_INVALID");
  validateAttributedMutationContext(context);
  return (await requestDshJson<Readonly<{ batch: SettlementBatch }>>(dshOperationPaths.createOperatorSettlementBatch.method, dshOperationPaths.createOperatorSettlementBatch.path, { payoutIds }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export type OperatorSettlementBatchRegistryResponse = Readonly<{ batches: ReadonlyArray<SettlementBatch>; nextCursor?: string; limit: number }>;
export async function listOperatorSettlementBatches(status: string, cursor: string, limit: number, context: DshOperatorReadContext): Promise<OperatorSettlementBatchRegistryResponse> {
  if (!context.operatorActorId.trim() || status.length > 32 || cursor.length > 512 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_SETTLEMENT_BATCH_REGISTRY_INPUT_INVALID");
  const query = new URLSearchParams({ limit: String(limit) });
  if (status.trim()) query.set("status", status.trim());
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<OperatorSettlementBatchRegistryResponse>(dshOperationPaths.listOperatorSettlementBatches.method, `${dshOperationPaths.listOperatorSettlementBatches.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function transitionOperatorSettlementBatch(batchId: string, action: "approve" | "freeze", reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ batch: SettlementBatch }>> {
  if (!batchId.trim() || !reason.trim()) throw new Error("DSH_SETTLEMENT_BATCH_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const operation = action === "approve" ? dshOperationPaths.approveOperatorSettlementBatch : dshOperationPaths.freezeOperatorSettlementBatch;
  const path = operation.path.replace("{batchId}", encodeURIComponent(batchId.trim()));
  return (await requestDshJson<Readonly<{ batch: SettlementBatch }>>(operation.method, path, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function recordOperatorManualTransfer(batchId: string, payoutId: string, externalTransferReference: string, receiptDocumentId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ transfer: unknown }>> {
  if (!batchId.trim() || !payoutId.trim() || !externalTransferReference.trim() || !receiptDocumentId.trim()) throw new Error("DSH_MANUAL_TRANSFER_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.recordOperatorManualTransfer.path.replace("{batchId}", encodeURIComponent(batchId.trim()));
  return (await requestDshJson<Readonly<{ transfer: unknown }>>(dshOperationPaths.recordOperatorManualTransfer.method, path, { payoutId, externalTransferReference, receiptDocumentId }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function transitionOperatorManualTransfer(transferId: string, action: "verify" | "reconcile", statementRowId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ transfer: unknown }>> {
  if (!transferId.trim() || (action === "reconcile" && !statementRowId.trim())) throw new Error("DSH_MANUAL_TRANSFER_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const operation = action === "verify" ? dshOperationPaths.verifyOperatorManualTransfer : dshOperationPaths.reconcileOperatorManualTransfer;
  const path = operation.path.replace("{transferId}", encodeURIComponent(transferId.trim()));
  return (await requestDshJson<Readonly<{ transfer: unknown }>>(operation.method, path, action === "verify" ? {} : { statementRowId }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function prepareOperatorPayout(payoutId: string, input: Readonly<{ reason: string; evidenceReference: string }>, context: JoiningCaseMutationContext): Promise<OperatorPayoutResponse> {
  if (!payoutId.trim() || !input.reason.trim() || !input.evidenceReference.trim()) throw new Error("DSH_PAYOUT_PREPARE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.prepareOperatorPayout.path.replace("{payoutId}", encodeURIComponent(payoutId.trim()));
  return (await requestDshJson<OperatorPayoutResponse>(dshOperationPaths.prepareOperatorPayout.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function approveOperatorPayout(payoutId: string, reason: string, context: JoiningCaseMutationContext): Promise<OperatorPayoutResponse> {
  if (!payoutId.trim() || !reason.trim()) throw new Error("DSH_PAYOUT_APPROVE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.approveOperatorPayout.path.replace("{payoutId}", encodeURIComponent(payoutId.trim()));
  return (await requestDshJson<OperatorPayoutResponse>(dshOperationPaths.approveOperatorPayout.method, path, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function cancelOperatorPayout(payoutId: string, reason: string, context: JoiningCaseMutationContext): Promise<OperatorPayoutResponse> {
  if (!payoutId.trim() || !reason.trim()) throw new Error("DSH_PAYOUT_CANCEL_INPUT_INVALID");
  validateAttributedMutationContext(context);
  const path = dshOperationPaths.cancelOperatorPayout.path.replace("{payoutId}", encodeURIComponent(payoutId.trim()));
  return (await requestDshJson<OperatorPayoutResponse>(dshOperationPaths.cancelOperatorPayout.method, path, { reason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
}

export async function readOperatorDeliveryFeePolicy(serviceCityId: string, context: DshOperatorReadContext): Promise<DeliveryFeePolicyResponse> {
  if (!context.operatorActorId.trim() || serviceCityId.trim().length > 128) throw new Error("DSH_DELIVERY_FEE_POLICY_READ_INPUT_INVALID");
  const query = serviceCityId.trim() ? `?serviceCityId=${encodeURIComponent(serviceCityId.trim())}` : "";
  const path = `${dshOperationPaths.readOperatorDeliveryFeePolicy.path}${query}`;
  return (await requestDshJson<DeliveryFeePolicyResponse>(dshOperationPaths.readOperatorDeliveryFeePolicy.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorDeliveryFeePolicy(input: CreateDeliveryFeePolicyRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: DeliveryFeePolicyResponse }>> {
  if (!Number.isInteger(input.baseFeeMinor) || input.baseFeeMinor < 0 || !Number.isInteger(input.distanceUnitMeters) || input.distanceUnitMeters < 1 || !Number.isInteger(input.distanceRateMinor) || input.distanceRateMinor < 0 || !Number.isInteger(input.orderSizeUnitBaseUnits) || input.orderSizeUnitBaseUnits < 1 || !Number.isInteger(input.orderSizeRateMinor) || input.orderSizeRateMinor < 0 || !Number.isInteger(input.zoneSurchargeMinor) || input.zoneSurchargeMinor < 0 || input.roundingUnitMinor !== 50 || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.reason.trim().length < 5 || input.reason.trim().length > 500 || (input.serviceCityId ?? "").trim().length > 128) throw new Error("DSH_DELIVERY_FEE_POLICY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_DELIVERY_FEE_POLICY_IDEMPOTENCY_INVALID");
  return requestDshJson<DeliveryFeePolicyResponse>(dshOperationPaths.createOperatorDeliveryFeePolicy.method, dshOperationPaths.createOperatorDeliveryFeePolicy.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readOperatorPartnerFinancialTermsPolicy(context: DshOperatorReadContext): Promise<PartnerFinancialTermsPolicyResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_PARTNER_FINANCIAL_TERMS_READ_INPUT_INVALID");
  return (await requestDshJson<PartnerFinancialTermsPolicyResponse>(dshOperationPaths.readOperatorPartnerFinancialTermsPolicy.method, dshOperationPaths.readOperatorPartnerFinancialTermsPolicy.path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorPartnerFinancialTermsPolicy(input: CreatePartnerFinancialTermsPolicyRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PartnerFinancialTermsPolicyResponse }>> {
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(input.settlementPeriod) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_PARTNER_FINANCIAL_TERMS_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PARTNER_FINANCIAL_TERMS_IDEMPOTENCY_INVALID");
  return requestDshJson<PartnerFinancialTermsPolicyResponse>(dshOperationPaths.createOperatorPartnerFinancialTermsPolicy.method, dshOperationPaths.createOperatorPartnerFinancialTermsPolicy.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function createOperatorFieldAcquisitionRewardPolicy(input: CreateFieldAcquisitionRewardPolicyRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldAcquisitionRewardPolicyResponse }>> {
  if (!input.scopeId.trim() || input.scopeId.length > 128 || !Number.isInteger(input.rewardMinor) || input.rewardMinor < 50 || input.roundingUnitMinor !== 50 || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_FIELD_ACQUISITION_REWARD_POLICY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FIELD_ACQUISITION_REWARD_POLICY_IDEMPOTENCY_INVALID");
  return requestDshJson<FieldAcquisitionRewardPolicyResponse>(dshOperationPaths.createFieldAcquisitionRewardPolicy.method, dshOperationPaths.createFieldAcquisitionRewardPolicy.path, { ...input, scopeId: input.scopeId.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readOperatorFieldAcquisitionRewardPolicyByScope(scope: FieldAcquisitionRewardPolicyScope, context: DshOperatorReadContext): Promise<FieldAcquisitionRewardPolicyResponse> {
  const scopeId = scope.scopeId.trim();
  if (!context.operatorActorId.trim() || !scopeId || scopeId.length > 128) throw new Error("DSH_FIELD_ACQUISITION_REWARD_POLICY_READ_INPUT_INVALID");
  const query = new URLSearchParams({ scopeType: scope.scopeType, scopeId });
  const path = `${dshOperationPaths.readFieldAcquisitionRewardPolicyByScope.path}?${query.toString()}`;
  return (await requestDshJson<FieldAcquisitionRewardPolicyResponse>(dshOperationPaths.readFieldAcquisitionRewardPolicyByScope.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorStoreCommercialAgreementQueue(limit: number, cursor: string, context: DshOperatorReadContext): Promise<FinanceStoreCommercialAgreementQueueResponse> {
  const normalizedCursor = cursor.trim();
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 50 || normalizedCursor.length > 2048) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_QUEUE_INPUT_INVALID");
  const query = new URLSearchParams({ status: "PARTNER_ACCEPTED", limit: String(limit) });
  if (normalizedCursor) query.set("cursor", normalizedCursor);
  const operation = dshOperationPaths.listFinanceStoreCommercialAgreements;
  return (await requestDshJson<FinanceStoreCommercialAgreementQueueResponse>(operation.method, `${operation.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorStoreCommercialAgreementsForFinance(storeId: string, context: DshOperatorReadContext): Promise<StoreCommercialAgreementListResponse> {
  const normalizedStoreId = storeId.trim();
  if (!context.operatorActorId.trim() || !normalizedStoreId || normalizedStoreId.length > 128) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_READ_INPUT_INVALID");
  const operation = dshOperationPaths.readFinanceStoreCommercialAgreements;
  const path = operation.path.replace("{storeId}", encodeURIComponent(normalizedStoreId));
  return (await requestDshJson<StoreCommercialAgreementListResponse>(operation.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorStoreTypeCommissionDefaults(commercialStoreTypeId: string, context: DshOperatorReadContext): Promise<DshStoreTypeCommissionDefaultsResponse> {
  const normalizedTypeId = commercialStoreTypeId.trim();
  if (!context.operatorActorId.trim() || !normalizedTypeId || normalizedTypeId.length > 128) throw new Error("DSH_STORE_TYPE_COMMISSION_DEFAULTS_INPUT_INVALID");
  const operation = dshOperationPaths.readFinanceStoreTypeCommissionDefaults;
  const path = operation.path.replace("{commercialStoreTypeId}", encodeURIComponent(normalizedTypeId));
  return (await requestDshJson<DshStoreTypeCommissionDefaultsResponse>(operation.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function updateOperatorStoreTypeCommissionDefault(commercialStoreTypeId: string, input: UpdateStoreTypeCommissionDefaultRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: StoreTypeCommissionDefaultUpdateResponse }>> {
  const normalizedTypeId = commercialStoreTypeId.trim();
  const validMode = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"].includes(input.fulfillmentMode);
  const reasonLength = Array.from(input.reason.trim()).length;
  if (!normalizedTypeId || normalizedTypeId.length > 128 || !validMode || !Number.isInteger(input.suggestedCommissionRateBps) || input.suggestedCommissionRateBps < 0 || input.suggestedCommissionRateBps > 10000 || !Number.isInteger(input.expectedDefaultVersion) || input.expectedDefaultVersion < 0 || reasonLength < 8 || reasonLength > 500) {
    throw new Error("DSH_STORE_TYPE_COMMISSION_DEFAULT_INPUT_INVALID");
  }
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_TYPE_COMMISSION_DEFAULT_IDEMPOTENCY_INVALID");
  const operation = dshOperationPaths.updateFinanceStoreTypeCommissionDefault;
  const path = operation.path.replace("{commercialStoreTypeId}", encodeURIComponent(normalizedTypeId));
  return requestDshJson<StoreTypeCommissionDefaultUpdateResponse>(operation.method, path, { ...input, reason: input.reason.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function decideOperatorStoreCommercialAgreement(storeId: string, agreementId: string, decision: "APPROVE" | "REJECT", expectedAgreementVersion: number, reason: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: StoreCommercialAgreementMutationResponse }>> {
  const normalizedStoreId = storeId.trim();
  const normalizedAgreementId = agreementId.trim();
  const normalizedReason = reason.trim();
  if (!normalizedStoreId || normalizedStoreId.length > 128 || !normalizedAgreementId || normalizedAgreementId.length > 128 || (decision !== "APPROVE" && decision !== "REJECT") || !Number.isInteger(expectedAgreementVersion) || expectedAgreementVersion < 1 || Array.from(normalizedReason).length < 8 || Array.from(normalizedReason).length > 500) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_DECISION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_IDEMPOTENCY_INVALID");
  const operation = dshOperationPaths.decideFinanceStoreCommercialAgreement;
  const path = operation.path.replace("{storeId}", encodeURIComponent(normalizedStoreId)).replace("{agreementId}", encodeURIComponent(normalizedAgreementId));
  return requestDshJson<StoreCommercialAgreementMutationResponse>(operation.method, path, { expectedAgreementVersion, decision, reason: normalizedReason }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
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

export async function listStoreAccessRoleAdmissionsForOperator(context: DshOperatorReadContext): Promise<StoreAccessGrantListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_STORE_ACCESS_OPERATOR_REQUIRED");
  return (await requestDshJson<StoreAccessGrantListResponse>(dshOperationPaths.listStoreAccessRoleAdmissionsForOperator.method, dshOperationPaths.listStoreAccessRoleAdmissionsForOperator.path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
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

export async function uploadOperatorJoiningCaseProofImage(caseId: string, file: File, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  const normalizedCaseId = caseId.trim();
  if (!normalizedCaseId || file.size < 1 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type)) throw new Error("DSH_JOINING_CASE_PROOF_IMAGE_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_PROOF_IMAGE_IDEMPOTENCY_INVALID");
  const form = new FormData();
  form.append("file", file, file.name || "joining-case-proof");
  const path = dshOperationPaths.uploadOperatorJoiningCaseProofImage.path.replace("{caseId}", encodeURIComponent(normalizedCaseId));
  return requestDshMultipart<JoiningCaseResponse>(dshOperationPaths.uploadOperatorJoiningCaseProofImage.method, path, form, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function uploadOperatorJoiningCaseStoreImage(caseId: string, file: File, provenance: MediaProvenanceInput, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  const normalizedCaseId = caseId.trim();
  if (!normalizedCaseId || file.size < 1 || file.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type) || !isMediaProvenanceInputValid(provenance)) throw new Error("DSH_JOINING_CASE_STORE_IMAGE_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_STORE_IMAGE_IDEMPOTENCY_INVALID");
  const form = new FormData();
  form.append("file", file, file.name || "storefront-image");
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
	if (!verticalId.trim() || verticalId.trim().length > 128) throw new Error("DSH_CATALOG_CATEGORY_READ_INPUT_INVALID");
	const normalizedStatus = status || "active";
	const needsOperator = normalizedStatus === "all" || normalizedStatus === "inactive";
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

export async function listCatalogAttributeEnumOptions(attributeId: string, context: DshOperatorReadContext): Promise<CatalogAttributeEnumOptionListResponse> {
  if (!attributeId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_OPTION_READ_INPUT_INVALID");
  const path = dshOperationPaths.listCatalogAttributeEnumOptions.path.replace("{attributeId}", encodeURIComponent(attributeId.trim()));
  return (await requestDshJson<CatalogAttributeEnumOptionListResponse>(dshOperationPaths.listCatalogAttributeEnumOptions.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createCatalogAttributeEnumOption(attributeId: string, input: CreateCatalogAttributeEnumOptionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeEnumOptionResponse }>> {
  if (!attributeId.trim() || !input.optionValue.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_OPTION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_ATTRIBUTE_OPTION_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.createCatalogAttributeEnumOption.path.replace("{attributeId}", encodeURIComponent(attributeId.trim()));
  return requestDshJson<CatalogAttributeEnumOptionResponse>(dshOperationPaths.createCatalogAttributeEnumOption.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
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

export async function listCatalogProducts(query: string, verticalId: string, cursor: string, context: DshOperatorReadContext): Promise<CatalogProductListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_PRODUCT_READ_INPUT_INVALID");
  const params = new URLSearchParams({ limit: "50" });
  if (query.trim()) params.set("q", query.trim());
  if (verticalId.trim()) params.set("verticalId", verticalId.trim());
  if (cursor.trim()) params.set("cursor", cursor.trim());
  const path = `${dshOperationPaths.listCatalogProducts.path}?${params.toString()}`;
  return (await requestDshJson<CatalogProductListResponse>(dshOperationPaths.listCatalogProducts.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listCatalogProductRegistry(filters: Readonly<{ query: string; verticalId: string; categoryId: string; active: string; sort: string; cursor: string }>, context: DshOperatorReadContext): Promise<CatalogProductRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_PRODUCT_REGISTRY_READ_INPUT_INVALID");
  const params = new URLSearchParams({ limit: "50" });
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.verticalId.trim()) params.set("verticalId", filters.verticalId.trim());
  if (filters.categoryId.trim()) params.set("categoryId", filters.categoryId.trim());
  if (filters.active !== "all") params.set("active", filters.active);
  if (filters.sort !== "name_asc") params.set("sort", filters.sort);
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

function appendMediaProvenance(body: FormData, provenance: MediaProvenanceInput): void {
  body.set("creator", provenance.creator.trim());
  body.set("sourceDescription", provenance.sourceDescription.trim());
  body.set("sourceUri", provenance.sourceUri?.trim() ?? "");
  body.set("rightsStatement", provenance.rightsStatement.trim());
  body.set("rightsUri", provenance.rightsUri?.trim() ?? "");
  body.set("rightsAttested", String(provenance.rightsAttested));
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

type DshManagedRoleMutationContext = DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>;

async function setDshManagedRoleEnabled(path: string, input: ManagedRoleMutationRequest, context: DshManagedRoleMutationContext): Promise<void> {
	validateVersionedMutationContext(context);
	if (!context.idempotencyKey.trim()) throw new Error("DSH_MANAGED_ROLE_IDEMPOTENCY_INVALID");
	if (input.reason !== undefined && input.reason.trim().length > 500) throw new Error("DSH_MANAGED_ROLE_REASON_INVALID");
	await requestDshJson<undefined>("POST", path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(), "X-Expected-Version": String(context.expectedVersion) });
}

export async function setDshPartnerRoleEnabled(actorId: string, input: ManagedRoleMutationRequest, context: DshManagedRoleMutationContext): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized) throw new Error("DSH_MANAGED_ROLE_ACTOR_REQUIRED");
  await setDshManagedRoleEnabled(dshOperationPaths.setPartnerManagedRoleEnabled.path.replace("{actorId}", encodeURIComponent(normalized)), input, context);
}

export async function setDshCaptainRoleEnabled(actorId: string, input: ManagedRoleMutationRequest, context: DshManagedRoleMutationContext): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized) throw new Error("DSH_MANAGED_ROLE_ACTOR_REQUIRED");
  await setDshManagedRoleEnabled(dshOperationPaths.setCaptainManagedRoleEnabled.path.replace("{actorId}", encodeURIComponent(normalized)), input, context);
}

export async function setDshCaptainAvailability(actorId: string, input: ManagedCaptainAvailabilityRequest, context: DshManagedRoleMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const normalized = actorId.trim();
  if (!normalized || !Number.isSafeInteger(context.expectedVersion) || context.expectedVersion < 1) throw new Error("DSH_CAPTAIN_AVAILABILITY_INPUT_INVALID");
  const reasonLength = Array.from(input.reason.trim()).length;
  if (reasonLength < 5 || reasonLength > 500) throw new Error("DSH_CAPTAIN_AVAILABILITY_REASON_INVALID");
  const path = dshOperationPaths.setOperatorCaptainAvailability.path.replace("{actorId}", encodeURIComponent(normalized));
  return requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.setOperatorCaptainAvailability.method, path, input, {
    "X-Acting-Actor-ID": context.operatorActorId.trim(),
    "X-Correlation-ID": context.correlationId.trim(),
    "X-Expected-Version": String(context.expectedVersion),
    "Idempotency-Key": context.idempotencyKey.trim(),
  });
}

export async function setDshFieldRoleEnabled(actorId: string, input: ManagedRoleMutationRequest, context: DshManagedRoleMutationContext): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized) throw new Error("DSH_MANAGED_ROLE_ACTOR_REQUIRED");
  await setDshManagedRoleEnabled(dshOperationPaths.setFieldIdentityRoleEnabled.path.replace("{actorId}", encodeURIComponent(normalized)), input, context);
}

export async function admitCaptain(input: CaptainAdmissionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  if (Array.from(input.fullNameAr.trim()).length < 2 || Array.from(input.fullNameAr.trim()).length > 120) throw new Error("DSH_CAPTAIN_NAME_INVALID");
  const contactPhoneE164 = normalizeYemenPhoneE164(input.contactPhoneE164);
  if (!/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164)) throw new Error("DSH_CAPTAIN_PHONE_INVALID");
  const walletProviderKey = input.walletProviderKey.trim();
  if (Array.from(walletProviderKey).length < 1 || Array.from(walletProviderKey).length > 64 || /\p{Cc}/u.test(walletProviderKey)) throw new Error("DSH_CAPTAIN_WALLET_PROVIDER_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_IDEMPOTENCY_INVALID");
  return requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.admitCaptain.method, dshOperationPaths.admitCaptain.path, { fullNameAr: input.fullNameAr.trim(), contactPhoneE164, walletProviderKey }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCaptainAdmissions(query: string, state: string, sort: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<CaptainAdmissionListResponse> {
  const params = new URLSearchParams({ q: query.trim(), state, sort, limit: String(limit) }); if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<CaptainAdmissionListResponse>("GET", `${dshOperationPaths.listCaptainAdmissions.path}?${params}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function approveCaptainAdmission(admissionId: string, expectedVersion: number, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.approveCaptainAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(), "X-Expected-Version": String(expectedVersion) });
}

export async function provisionCaptainAdmission(admissionId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.provisionCaptainAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCaptainAdmissionProfile(admissionId: string, fullNameAr: string, context: DshOperatorReadContext & Readonly<{ correlationId: string; idempotencyKey: string; expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.updateCaptainAdmissionProfile.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("PATCH", path, { fullNameAr: fullNameAr.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function reviewCaptainAdmissionProfile(admissionId: string, context: DshOperatorReadContext & Readonly<{ correlationId: string; idempotencyKey: string; expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
	const path = dshOperationPaths.reviewCaptainAdmissionProfile.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
	return requestDshJson<CaptainAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readCaptainAdmissionByActor(actorId: string, context: DshOperatorReadContext): Promise<CaptainAdmissionResponse> {
  const normalized = actorId.trim();
  if (!normalized || !context.operatorActorId.trim()) throw new Error("DSH_CAPTAIN_ADMISSION_READ_INPUT_INVALID");
  const path = dshOperationPaths.readCaptainAdmissionForOperatorActor.path.replace("{actorId}", encodeURIComponent(normalized));
  return (await requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.readCaptainAdmissionForOperatorActor.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function admitField(input: FieldAdmissionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  if (Array.from(input.fullNameAr.trim()).length < 2 || Array.from(input.fullNameAr.trim()).length > 120) throw new Error("DSH_FIELD_NAME_INVALID");
  const contactPhoneE164 = normalizeYemenPhoneE164(input.contactPhoneE164);
  if (!/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164)) throw new Error("DSH_FIELD_PHONE_INVALID");
  const serviceCityIds = Array.from(new Set((input.serviceCityIds ?? []).map((value) => value.trim()).filter(Boolean))).sort();
  if ((!input.allServiceCities && serviceCityIds.length === 0 && !input.serviceCityId?.trim()) || serviceCityIds.some((value) => value.length > 128)) throw new Error("DSH_FIELD_SERVICE_CITY_INVALID");
  const walletProviderKey = input.walletProviderKey.trim();
  if (Array.from(walletProviderKey).length < 1 || Array.from(walletProviderKey).length > 64 || /\p{Cc}/u.test(walletProviderKey)) throw new Error("DSH_FIELD_WALLET_PROVIDER_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FIELD_IDEMPOTENCY_INVALID");
  return requestDshJson<FieldAdmissionResponse>(dshOperationPaths.admitField.method, dshOperationPaths.admitField.path, { fullNameAr: input.fullNameAr.trim(), contactPhoneE164, serviceCityId: input.serviceCityId?.trim(), allServiceCities: input.allServiceCities, serviceCityIds, walletProviderKey }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listFieldAdmissions(query: string, state: string, sort: string, limit: number, cursor: string, context: DshOperatorReadContext, serviceCityId = ""): Promise<FieldAdmissionListResponse> {
  const params = new URLSearchParams({ q: query.trim(), state, sort, limit: String(limit) }); if (cursor) params.set("cursor", cursor); if (serviceCityId.trim()) params.set("serviceCityId", serviceCityId.trim());
  return (await requestDshJson<FieldAdmissionListResponse>("GET", `${dshOperationPaths.listFieldAdmissions.path}?${params}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function approveFieldAdmission(admissionId: string, expectedVersion: number, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  const path = dshOperationPaths.approveFieldAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<FieldAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(), "X-Expected-Version": String(expectedVersion) });
}

export async function provisionFieldAdmission(admissionId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  const path = dshOperationPaths.provisionFieldAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<FieldAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateFieldAdmissionProfile(admissionId: string, profile: Pick<FieldAdmissionRequest, "fullNameAr" | "walletProviderKey" | "allServiceCities" | "serviceCityIds">, context: DshOperatorReadContext & Readonly<{ correlationId: string; idempotencyKey: string; expectedVersion: number }>): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  const path = dshOperationPaths.updateFieldAdmissionProfile.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  const serviceCityIds = Array.from(new Set(profile.serviceCityIds.map((value) => value.trim()).filter(Boolean))).sort();
  if (!profile.allServiceCities && !serviceCityIds.length) throw new Error("DSH_FIELD_SERVICE_CITY_INVALID");
  return requestDshJson<FieldAdmissionResponse>("PATCH", path, { ...profile, fullNameAr: profile.fullNameAr.trim(), walletProviderKey: profile.walletProviderKey.trim(), serviceCityIds }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function reviewFieldAdmissionProfile(admissionId: string, context: DshOperatorReadContext & Readonly<{ correlationId: string; idempotencyKey: string; expectedVersion: number }>): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
	const path = dshOperationPaths.reviewFieldAdmissionProfile.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
	return requestDshJson<FieldAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readFieldAdmissionByActor(actorId: string, context: DshOperatorReadContext): Promise<FieldAdmissionResponse> {
  const normalized = actorId.trim();
  if (!normalized || !context.operatorActorId.trim()) throw new Error("DSH_FIELD_ADMISSION_READ_INPUT_INVALID");
  const path = dshOperationPaths.readFieldAdmissionForOperatorActor.path.replace("{actorId}", encodeURIComponent(normalized));
  return (await requestDshJson<FieldAdmissionResponse>(dshOperationPaths.readFieldAdmissionForOperatorActor.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

type DshManagedRoleReenrollmentContext = DshAttributedMutationContext & Readonly<{ expectedDomainVersion: number }>;

async function authorizeDshManagedRoleReenrollment(path: string, actorId: string, input: ManagedRoleReenrollmentRequest, context: DshManagedRoleReenrollmentContext): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized || normalized.length > 128 || !context.operatorActorId.trim() || context.correlationId.trim().length < 8 || !Number.isSafeInteger(context.expectedDomainVersion) || context.expectedDomainVersion < 1) throw new Error("DSH_MANAGED_ROLE_REENROLLMENT_CONTEXT_INVALID");
  const reasonLength = Array.from(input.reason.trim()).length;
  if (!Number.isSafeInteger(input.expectedActorVersion) || input.expectedActorVersion < 1 || !Number.isSafeInteger(input.expectedRoleVersion) || input.expectedRoleVersion < 1 || reasonLength < 5 || reasonLength > 500) throw new Error("DSH_MANAGED_ROLE_REENROLLMENT_INPUT_INVALID");
  await requestDshJson<void>("POST", path.replace("{actorId}", encodeURIComponent(normalized)), input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedDomainVersion) });
}

export async function authorizeDshPartnerReenrollment(actorId: string, input: ManagedRoleReenrollmentRequest, context: DshManagedRoleReenrollmentContext): Promise<void> {
  await authorizeDshManagedRoleReenrollment(dshOperationPaths.authorizePartnerReenrollment.path, actorId, input, context);
}

export async function authorizeDshCaptainReenrollment(actorId: string, input: ManagedRoleReenrollmentRequest, context: DshManagedRoleReenrollmentContext): Promise<void> {
  await authorizeDshManagedRoleReenrollment(dshOperationPaths.authorizeCaptainReenrollment.path, actorId, input, context);
}

export async function authorizeDshFieldReenrollment(actorId: string, input: ManagedRoleReenrollmentRequest, context: DshAttributedMutationContext & Readonly<{ expectedAdmissionVersion: number }>): Promise<void> {
  await authorizeDshManagedRoleReenrollment(dshOperationPaths.authorizeFieldReenrollment.path, actorId, input, { ...context, expectedDomainVersion: context.expectedAdmissionVersion });
}

export async function dispatchCaptainOffer(orderId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainOfferResponse }>> {
  if (!orderId.trim()) throw new Error("DSH_CAPTAIN_ORDER_REQUIRED");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.dispatchCaptainOffer.path.replace("{orderId}", encodeURIComponent(orderId.trim()));
  return requestDshJson<CaptainOfferResponse>(dshOperationPaths.dispatchCaptainOffer.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function reassignCaptainOffer(orderId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainOfferResponse }>> {
  if (!orderId.trim()) throw new Error("DSH_CAPTAIN_ORDER_REQUIRED");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.reassignCaptainOffer.path.replace("{orderId}", encodeURIComponent(orderId.trim()));
  return requestDshJson<CaptainOfferResponse>(dshOperationPaths.reassignCaptainOffer.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function recoverCaptainDelivery(assignmentId: string, context: DshVersionedMutationContext & Readonly<{ idempotencyKey: string }>): Promise<Readonly<{ status: number; payload: CaptainAssignmentResponse }>> {
  if (!assignmentId.trim()) throw new Error("DSH_CAPTAIN_ASSIGNMENT_REQUIRED");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_RECOVERY_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.recoverCaptainDelivery.path.replace("{assignmentId}", encodeURIComponent(assignmentId.trim()));
  return requestDshJson<CaptainAssignmentResponse>(dshOperationPaths.recoverCaptainDelivery.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim(), "X-Expected-Version": String(context.expectedVersion) });
}

export type OperatorPromotionRegistryQuery = Readonly<{ search: string; state: string; serviceCityId?: string; sort: "starts_desc" | "starts_asc"; cursor: string; limit: number }>;
export type OperatorDiscoveryContentRegistryQuery = Readonly<{ search: string; state: string; kind: string; sort: "priority" | "created_desc"; cursor: string; limit: number }>;

export async function listMarketingPromotions(query: OperatorPromotionRegistryQuery, context: DshOperatorReadContext): Promise<OperatorPromotionRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_MARKETING_READ_INPUT_INVALID");
  const serviceCityId = query.serviceCityId?.trim() ?? "";
  if (query.search.trim().length > 128 || serviceCityId.length > 128 || query.cursor.length > 2048 || !["starts_desc", "starts_asc"].includes(query.sort) || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error("DSH_MARKETING_PROMOTION_REGISTRY_INPUT_INVALID");
  const params = new URLSearchParams({ search: query.search.trim(), sort: query.sort, limit: String(query.limit) });
  if (query.state) params.set("state", query.state);
  if (serviceCityId) params.set("serviceCityId", serviceCityId);
  if (query.cursor) params.set("cursor", query.cursor);
  const path = `${dshOperationPaths.listOperatorPromotions.path}?${params.toString()}`;
  return (await requestDshJson<OperatorPromotionRegistryResponse>(dshOperationPaths.listOperatorPromotions.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createMarketingPromotion(input: CreatePromotionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PromotionResponse }>> {
  if (!input.id.trim() || !input.code.trim() || !input.nameAr.trim() || !input.startsAt.trim()) throw new Error("DSH_MARKETING_PROMOTION_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_MARKETING_PROMOTION_IDEMPOTENCY_INVALID");
  return requestDshJson<PromotionResponse>(dshOperationPaths.createOperatorPromotion.method, dshOperationPaths.createOperatorPromotion.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function setMarketingPromotionPublication(promotionId: string, input: MarketingPublicationRequest, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: PromotionResponse }>> {
  if (!promotionId.trim() || !input.state) throw new Error("DSH_MARKETING_PROMOTION_PUBLICATION_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_MARKETING_PROMOTION_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.setOperatorPromotionPublication.path.replace("{promotionId}", encodeURIComponent(promotionId.trim()));
  return requestDshJson<PromotionResponse>(dshOperationPaths.setOperatorPromotionPublication.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listMarketingContent(query: OperatorDiscoveryContentRegistryQuery, context: DshOperatorReadContext): Promise<OperatorDiscoveryContentRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_MARKETING_READ_INPUT_INVALID");
  if (query.search.trim().length > 128 || query.cursor.length > 2048 || !["priority", "created_desc"].includes(query.sort) || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error("DSH_MARKETING_CONTENT_REGISTRY_INPUT_INVALID");
  const params = new URLSearchParams({ search: query.search.trim(), sort: query.sort, limit: String(query.limit) });
  if (query.state) params.set("state", query.state);
  if (query.kind) params.set("kind", query.kind);
  if (query.cursor) params.set("cursor", query.cursor);
  const path = `${dshOperationPaths.listOperatorDiscoveryContent.path}?${params.toString()}`;
  return (await requestDshJson<OperatorDiscoveryContentRegistryResponse>(dshOperationPaths.listOperatorDiscoveryContent.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createMarketingContentWithMedia(formData: FormData, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: DiscoveryContentResponse }>> {
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_MARKETING_CONTENT_IDEMPOTENCY_INVALID");
  return requestDshMultipart<DiscoveryContentResponse>(dshOperationPaths.createOperatorDiscoveryContent.method, dshOperationPaths.createOperatorDiscoveryContent.path, formData, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listMarketingAnalytics(contentId: string, context: DshOperatorReadContext): Promise<DiscoveryContentAnalyticsListResponse> {
  if (!context.operatorActorId.trim() || !contentId.trim() || contentId.trim().length > 128) throw new Error("DSH_MARKETING_ANALYTICS_READ_INPUT_INVALID");
  const query = `?contentId=${encodeURIComponent(contentId.trim())}`;
  return (await requestDshJson<DiscoveryContentAnalyticsListResponse>(dshOperationPaths.listOperatorDiscoveryContentAnalytics.method, `${dshOperationPaths.listOperatorDiscoveryContentAnalytics.path}${query}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function setMarketingContentPublication(contentId: string, input: MarketingPublicationRequest, context: StorePublicationMutationContext): Promise<Readonly<{ status: number; payload: DiscoveryContentResponse }>> {
  if (!contentId.trim() || !input.state) throw new Error("DSH_MARKETING_CONTENT_PUBLICATION_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_MARKETING_CONTENT_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.setOperatorDiscoveryContentPublication.path.replace("{contentId}", encodeURIComponent(contentId.trim()));
  return requestDshJson<DiscoveryContentResponse>(dshOperationPaths.setOperatorDiscoveryContentPublication.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}
