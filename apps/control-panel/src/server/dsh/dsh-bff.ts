import { type BeneficiaryPayoutStateResponse, type CaptainAdmissionRequest, type CaptainAdmissionResponse, type CaptainAssignmentResponse, type CaptainOfferResponse, type CashLiabilityResponse, type CatalogCategoryListResponse, type CatalogCategoryResponse, type CatalogImportCommitResponse, type CatalogImportPreviewRequest, type CatalogImportPreviewResponse, type CatalogImportRunResponse, type CatalogProductListResponse, type CatalogProductProposalListResponse, type CatalogProductProposalResponse, type CatalogProductResponse, type CommerceVerticalListResponse, type CommerceVerticalResponse, type CreateCatalogCategoryRequest, type CreateCatalogProductRequest, type CreateCommerceVerticalRequest, type CreateDeliveryFeePolicyRequest, type CreateJoiningCaseRequest, type CreateServiceCityRequest, type DeliveryFeePolicyResponse, dshOperationPaths, type FieldAdmissionRequest, type FieldAdmissionResponse, type FieldCommissionPolicy, type FieldFinancialSummaryResponse, type JoiningCaseListResponse, type JoiningCaseResponse, type ManagedRoleMutationRequest, type OfficialWalletDestination, type OperatorOperationResponse, type OperatorOperationsResponse, type PartnerFinancialSummaryResponse, type PayoutRequest, type PublicationAction, type ReplaceCatalogProductMediaRequest, type ReviewCatalogProductProposalRequest, type ReviewJoiningCaseRequest, type ServiceCityListResponse, type ServiceCityResponse, type StorePublicationRequest, type StorePublicationResponse, type UpdateCatalogProductRequest, type UpdateServiceCityRequest } from "@bthwani/dsh";
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
}>;
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

export async function listOperatorOperations(state: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<OperatorOperationsResponse> {
	if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100 || cursor.trim().length > 512) {
		throw new Error("DSH_OPERATOR_OPERATIONS_INPUT_INVALID");
	}
	const params = new URLSearchParams({ limit: String(limit) });
	if (state.trim()) params.set("state", state.trim());
	if (cursor.trim()) params.set("cursor", cursor.trim());
	const path = `${dshOperationPaths.listOperatorOperations.path}?${params.toString()}`;
	return (await requestDshJson<OperatorOperationsResponse>(dshOperationPaths.listOperatorOperations.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorOperation(orderId: string, context: DshOperatorReadContext): Promise<OperatorOperationResponse> {
	if (!orderId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_OPERATION_READ_INPUT_INVALID");
	const path = dshOperationPaths.readOperatorOperation.path.replace("{orderId}", encodeURIComponent(orderId.trim()));
	return (await requestDshJson<OperatorOperationResponse>(dshOperationPaths.readOperatorOperation.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function listOperatorCashCustody(context: DshOperatorReadContext): Promise<CashLiabilityResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_OPERATOR_CASH_CUSTODY_INPUT_INVALID");
  return (await requestDshJson<CashLiabilityResponse>(dshOperationPaths.listOperatorCashCustody.method, dshOperationPaths.listOperatorCashCustody.path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorPartnerFinancialSummary(partnerActorId: string, context: DshOperatorReadContext): Promise<PartnerFinancialSummaryResponse> {
  if (!partnerActorId.trim() || partnerActorId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_PARTNER_FINANCIAL_SUMMARY_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPartnerFinancialSummary.path.replace("{partnerActorId}", encodeURIComponent(partnerActorId.trim()));
  return (await requestDshJson<PartnerFinancialSummaryResponse>(dshOperationPaths.readOperatorPartnerFinancialSummary.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorFieldFinancialSummary(fieldActorId: string, context: DshOperatorReadContext): Promise<FieldFinancialSummaryResponse> {
  if (!fieldActorId.trim() || fieldActorId.trim().length > 128 || !context.operatorActorId.trim()) throw new Error("DSH_FIELD_FINANCIAL_SUMMARY_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorFieldFinancialSummary.path.replace("{fieldActorId}", encodeURIComponent(fieldActorId.trim()));
  return (await requestDshJson<FieldFinancialSummaryResponse>(dshOperationPaths.readOperatorFieldFinancialSummary.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

type BeneficiaryActorType = "partner" | "captain" | "field";
type OperatorDestinationResponse = Readonly<{ destination: OfficialWalletDestination; idempotentReplay?: boolean }>;
export async function readOperatorPayoutState(actorType: BeneficiaryActorType, actorId: string, context: DshOperatorReadContext): Promise<BeneficiaryPayoutStateResponse> {
  if (!("partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_PAYOUT_STATE_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorPayoutState.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<BeneficiaryPayoutStateResponse>(dshOperationPaths.readOperatorPayoutState.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function readOperatorDestination(actorType: BeneficiaryActorType, actorId: string, context: DshOperatorReadContext): Promise<OperatorDestinationResponse> {
  if (!("partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !context.operatorActorId.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
  const path = dshOperationPaths.readOperatorOfficialWalletDestination.path.replace("{actorType}", encodeURIComponent(actorType)).replace("{actorId}", encodeURIComponent(actorId.trim()));
  return (await requestDshJson<OperatorDestinationResponse>(dshOperationPaths.readOperatorOfficialWalletDestination.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createOperatorDestination(actorType: BeneficiaryActorType, actorId: string, input: Readonly<{ providerKey: string; walletIdentifier: string; beneficiaryName: string; changeReason: string; verificationEvidenceReference: string; changeEvidenceReference: string }>, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: OperatorDestinationResponse }>> {
  if (!("partner" === actorType || "captain" === actorType || "field" === actorType) || !actorId.trim() || !input.providerKey.trim() || !input.walletIdentifier.trim() || !input.beneficiaryName.trim() || !input.changeReason.trim() || !input.verificationEvidenceReference.trim() || !input.changeEvidenceReference.trim()) throw new Error("DSH_DESTINATION_INPUT_INVALID");
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
  if (!Number.isInteger(input.baseFeeMinor) || input.baseFeeMinor < 0 || !Number.isInteger(input.distanceUnitMeters) || input.distanceUnitMeters < 1 || !Number.isInteger(input.distanceRateMinor) || input.distanceRateMinor < 0 || !Number.isInteger(input.orderSizeUnitBaseUnits) || input.orderSizeUnitBaseUnits < 1 || !Number.isInteger(input.orderSizeRateMinor) || input.orderSizeRateMinor < 0 || !Number.isInteger(input.zoneSurchargeMinor) || input.zoneSurchargeMinor < 0 || input.roundingUnitMinor !== 50 || (input.serviceCityId ?? "").trim().length > 128) throw new Error("DSH_DELIVERY_FEE_POLICY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_DELIVERY_FEE_POLICY_IDEMPOTENCY_INVALID");
  return requestDshJson<DeliveryFeePolicyResponse>(dshOperationPaths.createOperatorDeliveryFeePolicy.method, dshOperationPaths.createOperatorDeliveryFeePolicy.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function createOperatorFieldCommissionPolicy(input: CreateFieldCommissionPolicyRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldCommissionPolicyResponse }>> {
  if (!(["DEFAULT", "VERTICAL", "STORE"] as const).includes(input.scopeType) || (input.scopeType === "DEFAULT" && Boolean(input.scopeId?.trim())) || (input.scopeType !== "DEFAULT" && !input.scopeId?.trim()) || !Number.isInteger(input.rewardMinor) || input.rewardMinor < 50 || input.roundingUnitMinor !== 50) throw new Error("DSH_FIELD_COMMISSION_POLICY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FIELD_COMMISSION_POLICY_IDEMPOTENCY_INVALID");
  return requestDshJson<FieldCommissionPolicyResponse>(dshOperationPaths.createFieldCommissionPolicy.method, dshOperationPaths.createFieldCommissionPolicy.path, { ...input, scopeId: input.scopeId?.trim() || "" }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listJoiningCases(state: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<JoiningCaseListResponse> {
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("DSH_JOINING_CASE_QUEUE_INPUT_INVALID");
  const params = new URLSearchParams({ limit: String(limit) });
  if (state.trim()) params.set("state", state.trim());
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

export async function listCatalogVerticals(context: DshOperatorReadContext): Promise<CommerceVerticalListResponse> {
  if (!context.operatorActorId.trim()) throw new Error("DSH_CATALOG_VERTICAL_READ_INPUT_INVALID");
  return (await requestDshJson<CommerceVerticalListResponse>(dshOperationPaths.listCatalogVerticals.method, dshOperationPaths.listCatalogVerticals.path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function createCatalogVertical(input: CreateCommerceVerticalRequest, context: CatalogVerticalMutationContext): Promise<Readonly<{ status: number; payload: CommerceVerticalResponse }>> {
  if (!input.nameAr.trim() || !input.nameEn.trim()) throw new Error("DSH_CATALOG_VERTICAL_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_VERTICAL_IDEMPOTENCY_INVALID");
  return requestDshJson<CommerceVerticalResponse>(dshOperationPaths.createCatalogVertical.method, dshOperationPaths.createCatalogVertical.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function createCatalogCategory(input: CreateCatalogCategoryRequest, context: CatalogCategoryMutationContext): Promise<Readonly<{ status: number; payload: CatalogCategoryResponse }>> {
  if (!input.verticalId.trim() || !input.nameAr.trim() || !input.nameEn.trim()) throw new Error("DSH_CATALOG_CATEGORY_INPUT_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CATALOG_CATEGORY_IDEMPOTENCY_INVALID");
  return requestDshJson<CatalogCategoryResponse>(dshOperationPaths.createCatalogCategory.method, dshOperationPaths.createCatalogCategory.path, input, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function listCatalogCategories(verticalId: string): Promise<CatalogCategoryListResponse> {
  if (!verticalId.trim()) throw new Error("DSH_CATALOG_CATEGORY_READ_INPUT_INVALID");
  const path = `${dshOperationPaths.listCatalogCategories.path}?${new URLSearchParams({ verticalId: verticalId.trim() }).toString()}`;
  return (await requestDshJson<CatalogCategoryListResponse>(dshOperationPaths.listCatalogCategories.method, path, undefined, {})).payload;
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

export async function listCatalogProposalReviewQueue(state: string, limit: number, cursor: string, context: DshOperatorReadContext): Promise<CatalogProductProposalListResponse> {
  if (!context.operatorActorId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_CATALOG_PROPOSAL_QUEUE_INPUT_INVALID");
  const params = new URLSearchParams({ limit: String(limit) });
  if (state.trim()) params.set("state", state.trim());
  if (cursor.trim()) params.set("cursor", cursor.trim());
  const path = dshOperationPaths.listCatalogProductProposalReviewQueue.path + "?" + params.toString();
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
  if (!input.canonicalName.trim() || !input.verticalId.trim() || !input.scope.trim() || !input.measurementKind || !input.baseUnit || input.categoryIds.length < 1) throw new Error("DSH_PRODUCT_INPUT_INVALID");
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

export async function setDshFieldRoleEnabled(actorId: string, input: ManagedRoleMutationRequest, context: DshManagedRoleMutationContext): Promise<void> {
  const normalized = actorId.trim();
  if (!normalized) throw new Error("DSH_MANAGED_ROLE_ACTOR_REQUIRED");
  await setDshManagedRoleEnabled(dshOperationPaths.setFieldIdentityRoleEnabled.path.replace("{actorId}", encodeURIComponent(normalized)), input, context);
}

export async function admitCaptain(input: CaptainAdmissionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: CaptainAdmissionResponse }>> {
  if (!/^\+[1-9][0-9]{7,14}$/.test(input.contactPhoneE164.trim())) throw new Error("DSH_CAPTAIN_PHONE_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_CAPTAIN_IDEMPOTENCY_INVALID");
  return requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.admitCaptain.method, dshOperationPaths.admitCaptain.path, { contactPhoneE164: input.contactPhoneE164.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readCaptainAdmissionByActor(actorId: string, context: DshOperatorReadContext): Promise<CaptainAdmissionResponse> {
  const normalized = actorId.trim();
  if (!normalized || !context.operatorActorId.trim()) throw new Error("DSH_CAPTAIN_ADMISSION_READ_INPUT_INVALID");
  const path = dshOperationPaths.readCaptainAdmissionForOperatorActor.path.replace("{actorId}", encodeURIComponent(normalized));
  return (await requestDshJson<CaptainAdmissionResponse>(dshOperationPaths.readCaptainAdmissionForOperatorActor.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
}

export async function admitField(input: FieldAdmissionRequest, context: JoiningCaseMutationContext): Promise<Readonly<{ status: number; payload: FieldAdmissionResponse }>> {
  if (!/^\+[1-9][0-9]{7,14}$/.test(input.contactPhoneE164.trim())) throw new Error("DSH_FIELD_PHONE_INVALID");
  validateAttributedMutationContext(context);
  if (!context.idempotencyKey.trim()) throw new Error("DSH_FIELD_IDEMPOTENCY_INVALID");
  return requestDshJson<FieldAdmissionResponse>(dshOperationPaths.admitField.method, dshOperationPaths.admitField.path, { contactPhoneE164: input.contactPhoneE164.trim() }, { "X-Acting-Actor-ID": context.operatorActorId.trim(), "X-Correlation-ID": context.correlationId.trim(), "Idempotency-Key": context.idempotencyKey.trim() });
}

export async function readFieldAdmissionByActor(actorId: string, context: DshOperatorReadContext): Promise<FieldAdmissionResponse> {
  const normalized = actorId.trim();
  if (!normalized || !context.operatorActorId.trim()) throw new Error("DSH_FIELD_ADMISSION_READ_INPUT_INVALID");
  const path = dshOperationPaths.readFieldAdmissionForOperatorActor.path.replace("{actorId}", encodeURIComponent(normalized));
  return (await requestDshJson<FieldAdmissionResponse>(dshOperationPaths.readFieldAdmissionForOperatorActor.method, path, undefined, { "X-Acting-Actor-ID": context.operatorActorId.trim() })).payload;
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
