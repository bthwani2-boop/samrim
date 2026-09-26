import type { ActorLegalName, CatalogAttributeDefinitionListResponse, CatalogAttributeDefinitionResponse, CatalogAttributeEnumOptionListResponse, CatalogAttributeEnumOptionResponse, CatalogAttributeRuleListResponse, CatalogProduct, CatalogProductRegistryResponse, CreateCatalogAttributeDefinitionRequest, CreateCatalogAttributeEnumOptionRequest, CreateCustomerWithdrawalIntakeRequest, CustomerWithdrawalDecisionRequest, CustomerWithdrawalIntakeListResponse, CustomerWithdrawalIntakeResponse, ManagedCaptainAvailabilityRequest, PartnerStoreListResponse, SubmitActorLegalNameRequest, UpsertCatalogAttributeRuleRequest, VerifyActorLegalNameRequest } from "@bthwani/dsh";
import { type BeneficiaryPayoutState, type BeneficiaryPayoutStateResponse, type CaptainAdmissionListResponse, type CaptainAdmissionRequest, type CaptainAdmissionResponse, type CaptainAssignmentResponse, type CaptainOfferResponse, type CashCustodyRegistryResponse, type CatalogCategoryDetailResponse, type CatalogCategoryListResponse, type CatalogCategoryResponse, type CatalogImportCommitResponse, type CatalogImportPreviewRequest, type CatalogImportPreviewResponse, type CatalogImportRunResponse, type CatalogProductListResponse, type CatalogProductProposalListResponse, type CatalogProductProposalResponse, type CatalogProductResponse, type CommerceVerticalListResponse, type CommerceVerticalResponse, type CreateCatalogCategoryRequest, type CreateCatalogProductRequest, type CreateCommerceVerticalRequest, type CreateDeliveryFeePolicyRequest, type CreateJoiningCaseRequest, type CreatePartnerFinancialTermsPolicyRequest, type CreatePromotionRequest, type CreateServiceCityRequest, type DeliveryFeePolicyResponse, type DiscoveryContentAnalyticsListResponse, type DiscoveryContentResponse, dshOperationPaths, type FieldAdmissionListResponse, type FieldAdmissionRequest, type FieldAdmissionResponse, type FieldCommissionPolicy, type FieldReenrollmentRequest, type FinanceEvidenceDocument, type JoiningCaseListResponse, type JoiningCaseResponse, type ManagedRoleMutationRequest, type MarketingPublicationRequest, type NotificationListResponse, type NotificationReadResponse, type OfficialWalletDestination, type OperatorDiscoveryContentRegistryResponse, type OperatorOperationResponse, type OperatorOperationsResponse, type OperatorPromotionRegistryResponse, type OperatorStoreListResponse, type PartnerCommissionReceivableRegistryResponse, type PartnerCommissionRemittanceRequest, type PartnerCommissionRemittanceResponse, type PartnerFinancialSummaryResponse, type PartnerFinancialTermsPolicyResponse, type PartnerStoreCommissionPoliciesResponse, type PartnerStoreCommissionPolicyUpdateRequest, type PartnerStoreCommissionPolicyUpdateResponse, type PayoutRequest, type PromotionResponse, type PublicationAction, type ReplaceCatalogProductMediaRequest, type ReviewCatalogProductProposalRequest, type ReviewJoiningCaseRequest, type ServiceCityListResponse, type ServiceCityResponse, type SetStoreFulfillmentModesRequest, type SettlementBatch, type SettlementBatchExport, type StoreFulfillmentModesResponse, type StorePublicationRequest, type StorePublicationResponse, type UpdateCatalogCategoryRequest, type UpdateCatalogProductRequest, type UpdateCommerceVerticalRequest, type UpdateServiceCityRequest } from "@bthwani/dsh";
import { validateServiceUrl } from "@bthwani/identity";

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
export type CatalogProductMutationContext = JoiningCaseMutationContext;
export type CatalogVerticalMutationContext = JoiningCaseMutationContext;
export type CatalogCategoryMutationContext = JoiningCaseMutationContext;

export type CreateFieldCommissionPolicyRequest = Readonly<{
  scopeType: "DEFAULT" | "VERTICAL" | "STORE";
  scopeId?: string;
  rewardMinor: number;
  roundingUnitMinor: 50;
  expectedVersion: number;
  reason: string;
}>;
type FieldCommissionPolicyScope = Readonly<{ scopeType: "DEFAULT" | "VERTICAL" | "STORE"; scopeId?: string }>;
type FieldCommissionPolicyResponse = Readonly<{ policy: FieldCommissionPolicy; idempotentReplay: boolean }>;

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

export async function readOperatorPartnerFinancialSummary(partnerActorId: string, context: DshOperatorReadContext): Promise<PartnerFinancialSummaryResponse> {
  if (!partnerActorId.trim() || partnerActorId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_PARTNER_FINANCIAL_SUMMARY_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPartnerFinancialSummary.path.replace("{partnerActorId}", encodeURIComponent(partnerActorId.trim()));
  return (await requestDshJson<PartnerFinancialSummaryResponse>(dshOperationPaths.readOperatorPartnerFinancialSummary.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
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
  if (!normalizedPartnerActorID || normalizedPartnerActorID.length > 128 || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1 || input.remittanceReference.trim().length < 1 || input.remittanceReference.trim().length > 128 || input.evidenceReference.trim().length < 1 || input.evidenceReference.trim().length > 512) {
    throw new Error("DSH_PARTNER_COMMISSION_REMITTANCE_INPUT_INVALID");
  }
  validateAttributedMutationContext(context);
  if (context.idempotencyKey.trim().length < 8 || context.idempotencyKey.trim().length > 128) throw new Error("DSH_PARTNER_COMMISSION_REMITTANCE_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.recordPartnerCommissionRemittance.path.replace("{partnerActorId}", encodeURIComponent(normalizedPartnerActorID));
  return requestDshJson<PartnerCommissionRemittanceResponse>(dshOperationPaths.recordPartnerCommissionRemittance.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

type BeneficiaryActorType = "customer" | "partner" | "captain" | "field";
type OperatorDestinationResponse = Readonly<{ destination: OfficialWalletDestination; idempotentReplay?: boolean }>;
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

export async function createOperatorDestination(actorType: BeneficiaryActorType, actorId: string, input: Readonly<{ providerKey: string; walletIdentifier: string; changeReason: string; verificationEvidenceReference: string; changeEvidenceReference: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: OperatorDestinationResponse }>> {
	if (!("partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !input.providerKey.trim() || !input.walletIdentifier.trim() || !input.changeReason.trim() || !input.verificationEvidenceReference.trim() || !input.changeEvidenceReference.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
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
  return (await requestDshJson<CustomerWithdrawalIntakeResponse>(dshOperationPaths.createOperatorCustomerWithdrawalIntake.method, dshOperationPaths.createOperatorCustomerWithdrawalIntake.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() })).payload;
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
  summaries: ReadonlyArray<Readonly<{ actorType: string; actorId: string; currency: "YER"; openingBalanceMinor: number; creditsMinor: number; debitsMinor: number; closingBalanceMinor: number; currentBalanceMinor: number; heldMinor: number; availableMinor: number }>>;
  nextCursor?: string;
  limit: number;
}>;

export async function listOperatorFinancialStatementSummaries(actorType: OperatorFinancialStatementSummaryRegistry["actorType"], from: string, to: string, cursor: string, context: DshOperatorReadContext): Promise<OperatorFinancialStatementSummaryRegistry> {
  if (!context.operatorActorId.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new Error("DSH_FINANCIAL_STATEMENT_INPUT_INVALID");
  const query = new URLSearchParams({ actorType, from, to, limit: "200" });
  if (cursor.trim()) query.set("cursor", cursor.trim());
  return (await requestDshJson<OperatorFinancialStatementSummaryRegistry>(dshOperationPaths.listOperatorFinancialStatementSummaries.method, `${dshOperationPaths.listOperatorFinancialStatementSummaries.path}?${query.toString()}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
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
  if (!Number.isInteger(input.commissionRateBps) || input.commissionRateBps < 0 || input.commissionRateBps > 10000 || !["DAILY", "WEEKLY", "MONTHLY"].includes(input.settlementPeriod) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_PARTNER_FINANCIAL_TERMS_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PARTNER_FINANCIAL_TERMS_IDEMPOTENCY_INVALID");
  return requestDshJson<PartnerFinancialTermsPolicyResponse>(dshOperationPaths.createOperatorPartnerFinancialTermsPolicy.method, dshOperationPaths.createOperatorPartnerFinancialTermsPolicy.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function createOperatorFieldCommissionPolicy(input: CreateFieldCommissionPolicyRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldCommissionPolicyResponse }>> {
  if (!(["DEFAULT", "VERTICAL", "STORE"] as const).includes(input.scopeType) || (input.scopeType === "DEFAULT" && Boolean(input.scopeId?.trim())) || (input.scopeType !== "DEFAULT" && !input.scopeId?.trim()) || !Number.isInteger(input.rewardMinor) || input.rewardMinor < 50 || input.roundingUnitMinor !== 50 || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_FIELD_COMMISSION_POLICY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FIELD_COMMISSION_POLICY_IDEMPOTENCY_INVALID");
  return requestDshJson<FieldCommissionPolicyResponse>(dshOperationPaths.createFieldCommissionPolicy.method, dshOperationPaths.createFieldCommissionPolicy.path, { ...input, scopeId: input.scopeId?.trim() || "" }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readOperatorFieldCommissionPolicyByScope(scope: FieldCommissionPolicyScope, context: DshOperatorReadContext): Promise<FieldCommissionPolicyResponse> {
  const scopeId = scope.scopeId?.trim() ?? "";
  if (!context.operatorActorId.trim() || (scope.scopeType === "DEFAULT" ? scopeId !== "" : scopeId.length === 0 || scopeId.length > 128)) throw new Error("DSH_FIELD_COMMISSION_POLICY_READ_INPUT_INVALID");
  const query = new URLSearchParams({ scopeType: scope.scopeType, scopeId });
  const path = `${dshOperationPaths.readFieldCommissionPolicyByScope.path}?${query.toString()}`;
  return (await requestDshJson<FieldCommissionPolicyResponse>(dshOperationPaths.readFieldCommissionPolicyByScope.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorPartnerStoreCommissionPolicies(storeId: string, context: DshOperatorReadContext): Promise<PartnerStoreCommissionPoliciesResponse> {
  const normalizedStoreId = storeId.trim();
  if (!context.operatorActorId.trim() || !normalizedStoreId || normalizedStoreId.length > 128) throw new Error("DSH_PARTNER_STORE_COMMISSION_POLICY_READ_INPUT_INVALID");
  const path = `${dshOperationPaths.readOperatorPartnerStoreCommissionPolicies.path}?storeId=${encodeURIComponent(normalizedStoreId)}`;
  return (await requestDshJson<PartnerStoreCommissionPoliciesResponse>(dshOperationPaths.readOperatorPartnerStoreCommissionPolicies.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function updateOperatorPartnerStoreCommissionPolicy(input: PartnerStoreCommissionPolicyUpdateRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: PartnerStoreCommissionPolicyUpdateResponse }>> {
  const validMode = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"].includes(input.fulfillmentMode);
  const reasonLength = Array.from(input.reason.trim()).length;
  if (!input.storeId.trim() || input.storeId.trim().length > 128 || !validMode || !Number.isInteger(input.commissionRateBps) || input.commissionRateBps < 0 || input.commissionRateBps > 10000 || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || reasonLength < 8 || reasonLength > 500) throw new Error("DSH_PARTNER_STORE_COMMISSION_POLICY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PARTNER_STORE_COMMISSION_POLICY_IDEMPOTENCY_INVALID");
  return requestDshJson<PartnerStoreCommissionPolicyUpdateResponse>(dshOperationPaths.updateOperatorPartnerStoreCommissionPolicy.method, dshOperationPaths.updateOperatorPartnerStoreCommissionPolicy.path, { ...input, storeId: input.storeId.trim(), reason: input.reason.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
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

export async function createJoiningCase(input: CreateJoiningCaseRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: JoiningCaseResponse }>> {
  if (!phoneE164Pattern.test(input.contactPhoneE164.replace(/\s+/g, "")) || input.businessName.trim().length < 2 || input.firstStoreName.trim().length < 2 || !input.serviceCityId.trim() || !input.firstStoreVerticalId.trim() || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude)) {
    throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
  }
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_JOINING_CASE_IDEMPOTENCY_INVALID");
  return requestDshJson<JoiningCaseResponse>(dshOperationPaths.createJoiningCase.method, dshOperationPaths.createJoiningCase.path, { ...input, contactPhoneE164: input.contactPhoneE164.replace(/\s+/g, "") }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCatalogVerticals(context: DshOperatorReadContext, includeInactive = false): Promise<CommerceVerticalListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_CATALOG_VERTICAL_READ_INPUT_INVALID");
  const path = includeInactive ? `${dshOperationPaths.listCatalogVerticals.path}?includeInactive=true` : dshOperationPaths.listCatalogVerticals.path;
  return (await requestDshJson<CommerceVerticalListResponse>(dshOperationPaths.listCatalogVerticals.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createCatalogVertical(input: CreateCommerceVerticalRequest, context: CatalogVerticalMutationContext): Promise<Readonly<{ status: number; payload: CommerceVerticalResponse }>> {
  if (!input.nameAr.trim() || !input.nameEn.trim() || (input.catalogModel !== "SHARED_CATALOG" && input.catalogModel !== "STORE_LOCAL_CATALOG") || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_CATALOG_VERTICAL_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_VERTICAL_IDEMPOTENCY_INVALID");
  return requestDshJson<CommerceVerticalResponse>(dshOperationPaths.createCatalogVertical.method, dshOperationPaths.createCatalogVertical.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCatalogVertical(verticalId: string, input: UpdateCommerceVerticalRequest, context: CatalogVerticalMutationContext): Promise<Readonly<{ status: number; payload: CommerceVerticalResponse }>> {
  const normalizedId = verticalId.trim();
  if (!normalizedId || !input.nameAr.trim() || !input.nameEn.trim() || (input.catalogModel !== "SHARED_CATALOG" && input.catalogModel !== "STORE_LOCAL_CATALOG") || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_CATALOG_VERTICAL_UPDATE_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_VERTICAL_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateCatalogVertical.path.replace("{verticalId}", encodeURIComponent(normalizedId));
  return requestDshJson<CommerceVerticalResponse>(dshOperationPaths.updateCatalogVertical.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function createCatalogCategory(input: CreateCatalogCategoryRequest, context: CatalogCategoryMutationContext): Promise<Readonly<{ status: number; payload: CatalogCategoryResponse }>> {
  if (!input.verticalId.trim() || !input.nameAr.trim() || !input.nameEn.trim() || input.reason.trim().length < 5 || input.reason.trim().length > 500) throw new Error("DSH_CATALOG_CATEGORY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_CATEGORY_IDEMPOTENCY_INVALID");
  return requestDshJson<CatalogCategoryResponse>(dshOperationPaths.createCatalogCategory.method, dshOperationPaths.createCatalogCategory.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCatalogCategory(categoryId: string, input: UpdateCatalogCategoryRequest, context: CatalogCategoryMutationContext): Promise<Readonly<{ status: number; payload: CatalogCategoryResponse }>> {
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

export async function createCatalogAttributeDefinition(input: CreateCatalogAttributeDefinitionRequest, context: CatalogCategoryMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeDefinitionResponse }>> {
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

export async function createCatalogAttributeEnumOption(attributeId: string, input: CreateCatalogAttributeEnumOptionRequest, context: CatalogCategoryMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeEnumOptionResponse }>> {
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

export async function upsertCatalogCategoryAttributeRule(categoryId: string, attributeId: string, input: UpsertCatalogAttributeRuleRequest, context: CatalogCategoryMutationContext): Promise<Readonly<{ status: number; payload: CatalogAttributeRuleListResponse }>> {
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
  if (!input.runId.trim() || !input.sourceSha256.trim() || input.rows.length < 1 || input.rows.length > 1000) throw new Error("DSH_CATALOG_IMPORT_INPUT_INVALID");
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

export async function createCatalogProduct(input: CreateCatalogProductRequest, context: CatalogProductMutationContext): Promise<Readonly<{ status: number; payload: CatalogProductResponse }>> {
  if (!input.canonicalName.trim() || !input.verticalId.trim() || !input.scope.trim() || !input.measurementKind || !input.baseUnit || (input.categoryIds?.length ?? 0) < 1) throw new Error("DSH_PRODUCT_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PRODUCT_IDEMPOTENCY_INVALID");
  return requestDshJson<CatalogProductResponse>(dshOperationPaths.createCatalogProduct.method, dshOperationPaths.createCatalogProduct.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCatalogProduct(productId: string, input: UpdateCatalogProductRequest, context: CatalogProductMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CatalogProductResponse }>> {
  if (!productId.trim() || !input.canonicalName.trim()) throw new Error("DSH_PRODUCT_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PRODUCT_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.updateCatalogProduct.path.replace("{productId}", encodeURIComponent(productId.trim()));
  return requestDshJson<CatalogProductResponse>(dshOperationPaths.updateCatalogProduct.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function replaceCatalogProductMedia(productId: string, input: ReplaceCatalogProductMediaRequest, context: CatalogProductMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CatalogProductResponse }>> {
  if (!productId.trim() || input.media.length > 21) throw new Error("DSH_PRODUCT_MEDIA_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PRODUCT_MEDIA_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.replaceCatalogProductMedia.path.replace("{productId}", encodeURIComponent(productId.trim()));
  return requestDshJson<CatalogProductResponse>(dshOperationPaths.replaceCatalogProductMedia.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function uploadCatalogProductMedia(productId: string, file: File, role: "primary" | "gallery", context: CatalogProductMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CatalogProductResponse }>> {
  if (!productId.trim() || file.size < 1 || file.size > 10 * 1024 * 1024 || (role !== "primary" && role !== "gallery")) throw new Error("DSH_PRODUCT_MEDIA_UPLOAD_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_PRODUCT_MEDIA_UPLOAD_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.uploadCatalogProductMedia.path.replace("{productId}", encodeURIComponent(productId.trim()));
  const body = new FormData();
  body.set("role", role);
  body.set("file", file, file.name || "product-image");
  return requestDshMultipart<CatalogProductResponse>(dshOperationPaths.uploadCatalogProductMedia.method, path, body, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function uploadCatalogCategoryMedia(categoryId: string, file: File, reason: string, context: CatalogProductMutationContext & Readonly<{ expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CatalogCategoryResponse }>> {
  const normalizedReason = reason.trim();
  if (!categoryId.trim() || file.size < 1 || file.size > 10 * 1024 * 1024 || normalizedReason.length < 5 || normalizedReason.length > 500) throw new Error("DSH_CATEGORY_MEDIA_UPLOAD_INPUT_INVALID");
  validateVersionedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATEGORY_MEDIA_UPLOAD_IDEMPOTENCY_INVALID");
  const path = dshOperationPaths.uploadCatalogCategoryMedia.path.replace("{categoryId}", encodeURIComponent(categoryId.trim()));
  const body = new FormData();
  body.set("file", file, file.name || "category-image");
  body.set("reason", normalizedReason);
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
  if (!/^\+[1-9][0-9]{7,14}$/.test(input.contactPhoneE164.trim())) throw new Error("DSH_CAPTAIN_PHONE_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_IDEMPOTENCY_INVALID");
  return requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.admitCaptain.method, dshOperationPaths.admitCaptain.path, { fullNameAr: input.fullNameAr.trim(), contactPhoneE164: input.contactPhoneE164.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCaptainAdmissions(query: string, state: string, sort: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<CaptainAdmissionListResponse> {
  const params = new URLSearchParams({ q: query.trim(), state, sort, limit: String(limit) }); if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<CaptainAdmissionListResponse>("GET", `${dshOperationPaths.listCaptainAdmissions.path}?${params}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function approveCaptainAdmission(admissionId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.approveCaptainAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function provisionCaptainAdmission(admissionId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.provisionCaptainAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateCaptainAdmissionProfile(admissionId: string, fullNameAr: string, context: DshOperatorReadContext & Readonly<{ correlationId: string; idempotencyKey: string; expectedVersion: number }>): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  const path = dshOperationPaths.updateCaptainAdmissionProfile.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<CaptainAdmissionResponse>("PATCH", path, { fullNameAr: fullNameAr.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readCaptainAdmissionByActor(actorId: string, context: DshOperatorReadContext): Promise<CaptainAdmissionResponse> {
  const normalized = actorId.trim();
  if (!normalized || !context.operatorActorId.trim()) throw new Error("DSH_CAPTAIN_ADMISSION_READ_INPUT_INVALID");
  const path = dshOperationPaths.readCaptainAdmissionForOperatorActor.path.replace("{actorId}", encodeURIComponent(normalized));
  return (await requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.readCaptainAdmissionForOperatorActor.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function admitField(input: FieldAdmissionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  if (Array.from(input.fullNameAr.trim()).length < 2 || Array.from(input.fullNameAr.trim()).length > 120) throw new Error("DSH_FIELD_NAME_INVALID");
  if (!/^\+[1-9][0-9]{7,14}$/.test(input.contactPhoneE164.trim())) throw new Error("DSH_FIELD_PHONE_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FIELD_IDEMPOTENCY_INVALID");
  return requestDshJson<FieldAdmissionResponse>(dshOperationPaths.admitField.method, dshOperationPaths.admitField.path, { fullNameAr: input.fullNameAr.trim(), contactPhoneE164: input.contactPhoneE164.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listFieldAdmissions(query: string, state: string, sort: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<FieldAdmissionListResponse> {
  const params = new URLSearchParams({ q: query.trim(), state, sort, limit: String(limit) }); if (cursor) params.set("cursor", cursor);
  return (await requestDshJson<FieldAdmissionListResponse>("GET", `${dshOperationPaths.listFieldAdmissions.path}?${params}`, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function approveFieldAdmission(admissionId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  const path = dshOperationPaths.approveFieldAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<FieldAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function provisionFieldAdmission(admissionId: string, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  const path = dshOperationPaths.provisionFieldAdmission.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<FieldAdmissionResponse>("POST", path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function updateFieldAdmissionProfile(admissionId: string, fullNameAr: string, context: DshOperatorReadContext & Readonly<{ correlationId: string; idempotencyKey: string; expectedVersion: number }>): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  const path = dshOperationPaths.updateFieldAdmissionProfile.path.replace("{admissionId}", encodeURIComponent(admissionId.trim()));
  return requestDshJson<FieldAdmissionResponse>("PATCH", path, { fullNameAr: fullNameAr.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedVersion), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readFieldAdmissionByActor(actorId: string, context: DshOperatorReadContext): Promise<FieldAdmissionResponse> {
  const normalized = actorId.trim();
  if (!normalized || !context.operatorActorId.trim()) throw new Error("DSH_FIELD_ADMISSION_READ_INPUT_INVALID");
  const path = dshOperationPaths.readFieldAdmissionForOperatorActor.path.replace("{actorId}", encodeURIComponent(normalized));
  return (await requestDshJson<FieldAdmissionResponse>(dshOperationPaths.readFieldAdmissionForOperatorActor.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function authorizeDshFieldReenrollment(actorId: string, input: FieldReenrollmentRequest, context: DshAttributedMutationContext & Readonly<{ expectedAdmissionVersion: number }>): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized || !context.operatorActorId.trim() || context.correlationId.trim().length < 8 || !Number.isSafeInteger(context.expectedAdmissionVersion) || context.expectedAdmissionVersion < 1) throw new Error("DSH_FIELD_REENROLLMENT_CONTEXT_INVALID");
  const reasonLength = Array.from(input.reason.trim()).length;
  if (!Number.isSafeInteger(input.expectedActorVersion) || input.expectedActorVersion < 1 || !Number.isSafeInteger(input.expectedRoleVersion) || input.expectedRoleVersion < 1 || reasonLength < 5 || reasonLength > 500) throw new Error("DSH_FIELD_REENROLLMENT_INPUT_INVALID");
  const path = dshOperationPaths.authorizeFieldReenrollment.path.replace("{actorId}", encodeURIComponent(normalized));
  await requestDshJson<void>(dshOperationPaths.authorizeFieldReenrollment.method, path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "X-Expected-Version": String(context.expectedAdmissionVersion) });
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

export type OperatorPromotionRegistryQuery = Readonly<{ search: string; state: string; sort: "starts_desc" | "starts_asc"; cursor: string; limit: number }>;
export type OperatorDiscoveryContentRegistryQuery = Readonly<{ search: string; state: string; kind: string; sort: "priority" | "created_desc"; cursor: string; limit: number }>;

export async function listMarketingPromotions(query: OperatorPromotionRegistryQuery, context: DshOperatorReadContext): Promise<OperatorPromotionRegistryResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_MARKETING_READ_INPUT_INVALID");
  if (query.search.trim().length > 128 || query.cursor.length > 2048 || !["starts_desc", "starts_asc"].includes(query.sort) || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error("DSH_MARKETING_PROMOTION_REGISTRY_INPUT_INVALID");
  const params = new URLSearchParams({ search: query.search.trim(), sort: query.sort, limit: String(query.limit) });
  if (query.state) params.set("state", query.state);
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
