import { dshOperationPaths } from "./generated/dsh-operations";
import type { StoreAccessGrantActivationRequest, StoreAccessGrantPermissionsRequest } from "./generated/dsh-types";
import type { StorePayoutRecipientListResponse, StorePayoutRecipientMutationResponse, StorePayoutRecipientRevertRequest, StorePayoutRecipientRevertResponse, StorePayoutRecipientSelectRequest } from "./generated/dsh-types";
import type { CreatePromotionRequest, MarketingPublicationRequest, OperatorPromotionRegistryResponse, PromotionResponse } from "./generated/dsh-types";
import type { CatalogQuickPriceCommitRequest, CatalogQuickPriceCommitResponse } from "./generated/dsh-types";
import type { CatalogImportCommitResponse, CatalogImportPreviewResponse, CatalogImportRunResponse } from "./generated/dsh-types";
import type { StoreCommercialAgreementListResponse, StoreCommercialAgreementMutationResponse, StoreCommercialAgreementProposalRequest, StoreTypeCommissionDefaultsResponse } from "./generated/dsh-types";
import type { CatalogIdentifierResolveResponse, CatalogProductResponse, CreateFieldCatalogProductRequest, CreateStoreOfferRequest, FieldCatalogReadResponse, UpdateStoreOfferRequest } from "./generated/dsh-types";
import type { AcceptStoreCaptainInvitationRequest, BeneficiaryFundingIntentResponse, BeneficiaryPayoutStateResponse, BeneficiaryWalletResponse, CaptainAdmissionResponse, CaptainAssignmentListResponse, CaptainAssignmentResponse, CaptainAvailabilityRequest, CaptainCashRemittanceRequest, CaptainCashRemittanceResponse, CaptainCompletionRequest, CaptainDeliveryTaskResponse, CaptainLocationResponse, CaptainOfferDecisionRequest, CaptainOfferListResponse, CaptainOfferResponse, CartResponse, CashInFundingIntent, CashLiabilityResponse, CatalogAttributeEnumOptionListResponse, CatalogAttributeRuleListResponse, CatalogCategoryListResponse, CatalogModifierGroupResponse, CatalogModifierOptionResponse, CatalogProduct, CatalogProductListResponse, CatalogProductProposal, CatalogProductProposalListResponse, CatalogProductProposalResponse, CatalogStorefrontSectionResponse, CatalogStoreOfferListResponse, CatalogStoreOfferResponse, CatalogVariantResponse, CheckoutQuoteResponse, CheckoutRequest, ClientOpenCartListResponse, CommerceVerticalListResponse, CommercialStoreTypeListResponse, CorrectJoiningCaseRequest, CreateCatalogModifierGroupRequest, CreateCatalogModifierOptionRequest, CreateCatalogProductProposalRequest, CreateCatalogProductRequest, CreateCatalogStorefrontSectionRequest, CreateCatalogVariantRequest, CreateDeliveryAddressRequest, CreateJoiningCaseRequest, CreateOrderConversationMessageRequest, CreateOrderRatingRequest, DeliveryAddressListResponse, DeliveryAddressResponse, DeliveryProofResponse, DiscoveryContentEventRequest, DiscoveryContentListResponse, DiscoveryContentTargetResolution, FavoriteStoreListResponse, FavoriteStoreOfferListResponse, FavoriteStoreOfferResponse, FavoriteStoreResponse, FieldAcquisitionEntitlementPage, FieldAdmissionResponse, FieldFinancialSummaryResponse, JoiningCaseListResponse, JoiningCaseResponse, MarkOrderConversationReadRequest, MediaProvenanceInput, MultiStoreCheckoutRequest, MultiStoreCheckoutResponse, NotificationListResponse, NotificationReadResponse, OrderAdjustmentDecisionRequest, OrderAdjustmentProposalRequest, OrderConversationMessageResponse, OrderConversationReadResponse, OrderConversationResponse, OrderListResponse, OrderRatingResponse, OrderResponse, OrderTrackingResponse, OrderTransitionRequest, PartnerAccessibleStorePage, PartnerFinancialSummaryResponse, PartnerOrdersResponse, PartnerStoreOperationalAvailabilityMutationResponse, PartnerStoreOperationalAvailabilityResponse, PayoutRequest, PromotionListResponse, PublicCatalogResponse, PublicCatalogSearchResponse, PublicStoreOrderabilityResponse, PublicStoreView, PublishedStoreListResponse, ReplaceCatalogProductMediaRequest, ServiceabilityResponse, ServiceCity, ServiceCityListResponse, SetStoreFulfillmentModesRequest, StoreAccessGrantListResponse, StoreAccessGrantMutationResponse, StoreAccessGrantTransitionRequest, StoreAccessInvitationCreateRequest, StoreAccessInvitationDecisionRequest, StoreAccessPermission, StoreCaptainDispatchRequest, StoreCaptainInvitationResponse, StoreCaptainMembershipListResponse, StoreCaptainMembershipResponse, StoreCaptainMembershipTransitionRequest, StoreDeliveryOriginResponse, StoreFulfillmentModesResponse, StoreOperationalAvailabilityRequest, UpdateCartLineRequest, UpdateCatalogProductProposalRequest, UpdateCatalogProductRequest, UpdateCatalogVariantRequest, UpdateDeliveryAddressRequest, UpsertCartLineRequest } from "./generated/dsh-types";

export type DshMobileClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

export function isDefinitiveDshMobileClientRejection(value: unknown): value is Extract<DshMobileClientError, { kind: "http" }> {
  return isDshMobileClientError(value) && value.kind === "http" && value.status >= 400 && value.status < 500;
}

export type DshMobileClientOptions = Readonly<{
  timeoutMs?: number;
  cryptoRandomUUID?: () => string;
}>;

export type PayoutIntentResponse = Readonly<{ payout: PayoutRequest; idempotentReplay: boolean }>;

export type DshNativeMultipartUpload = (request: Readonly<{
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  fieldName: string;
  fileName: string;
  mimeType: string;
  parameters: Readonly<Record<string, string>>;
  signal: AbortSignal;
}>) => Promise<Readonly<{ status: number; body: string }>>;

export type DshImageUploadInput = Readonly<{
  uri: string;
  name?: string;
  type?: string;
  blob?: Blob;
  nativeMultipartUpload?: DshNativeMultipartUpload;
}>;

export type DshCatalogImportFileInput = Readonly<{
  uri: string;
  name: string;
  type?: string;
  blob?: Blob;
  nativeMultipartUpload?: DshNativeMultipartUpload;
}>;

function mediaProvenanceParameters(value: MediaProvenanceInput): Readonly<Record<string, string>> {
  return {
    creator: value.creator.trim(),
    sourceDescription: value.sourceDescription.trim(),
    sourceUri: value.sourceUri?.trim() ?? "",
    rightsStatement: value.rightsStatement.trim(),
    rightsUri: value.rightsUri?.trim() ?? "",
    rightsAttested: String(value.rightsAttested),
  };
}

export function isMediaProvenanceInputValid(value: MediaProvenanceInput): boolean {
  const length = (input: string) => Array.from(input.trim()).length;
  const validURI = (raw: string | undefined) => {
    const candidate = raw?.trim() ?? "";
    if (!candidate) return true;
    if (length(candidate) > 2048) return false;
    try {
      const parsed = new URL(candidate);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  };
  return length(value.creator) >= 2 && length(value.creator) <= 200 &&
    length(value.sourceDescription) >= 3 && length(value.sourceDescription) <= 1000 &&
    length(value.rightsStatement) >= 5 && length(value.rightsStatement) <= 2000 && value.rightsAttested &&
    validURI(value.sourceUri) && validURI(value.rightsUri);
}

function appendMediaProvenance(form: FormData, value: MediaProvenanceInput): void {
  for (const [key, item] of Object.entries(mediaProvenanceParameters(value))) form.append(key, item);
}

function isDshMobileClientError(value: unknown): value is DshMobileClientError {
  return Boolean(value && typeof value === "object" && ((value as { kind?: unknown }).kind === "http" || (value as { kind?: unknown }).kind === "network"));
}

async function requestWithTimeout<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request(controller.signal),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("dsh request timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function createDshMobileClient(rawBaseUrl: string, options: DshMobileClientOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  let baseUrl = rawBaseUrl.trim();
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === "/") end -= 1;
  baseUrl = baseUrl.slice(0, end);
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("DSH_BASE_URL_INVALID");

  async function publicRequest<T>(path: string): Promise<T> {
    try {
      return await requestWithTimeout(async (signal) => {
        const response = await fetch(`${baseUrl}${path}`, { method: "GET", headers: { Accept: "application/json" }, signal });
        if (!response.ok) {
          const raw = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
          const nested = raw?.error;
          throw {
            kind: "http",
            status: response.status,
            code: typeof nested?.code === "string" ? nested.code : "DSH_ERROR",
            message: typeof nested?.message === "string" ? nested.message : "dsh request failed",
          } satisfies DshMobileClientError;
        }
        return await response.json() as T;
      }, timeoutMs);
    } catch (error) {
      if (isDshMobileClientError(error)) throw error;
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshMobileClientError;
    }
  }

  async function publicMutationRequest<T>(path: string, method: string, body: unknown): Promise<T> {
    try {
      return await requestWithTimeout(async (signal) => {
        const response = await fetch(`${baseUrl}${path}`, { method, headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
        if (!response.ok) {
          const raw = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
          const nested = raw?.error;
          throw { kind: "http", status: response.status, code: typeof nested?.code === "string" ? nested.code : "DSH_ERROR", message: typeof nested?.message === "string" ? nested.message : "dsh request failed" } satisfies DshMobileClientError;
        }
        return response.status === 204 ? undefined as T : await response.json() as T;
      }, timeoutMs);
    } catch (error) {
      if (isDshMobileClientError(error)) throw error;
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshMobileClientError;
    }
  }

  async function userRequest<T>(accessToken: string, path: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = accessToken.trim();
    if (!token) throw new Error("DSH_ACCESS_TOKEN_REQUIRED");
    try {
      const result = await requestWithTimeout(async (signal) => {
        const response = await fetch(`${baseUrl}${path}`, { method, headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
        if (!response.ok) {
          const raw = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
          const nested = raw?.error;
          throw { kind: "http", status: response.status, code: typeof nested?.code === "string" ? nested.code : "DSH_ERROR", message: typeof nested?.message === "string" ? nested.message : "dsh request failed" } satisfies DshMobileClientError;
        }
        return await response.json() as T;
      }, timeoutMs);
      return result;
    } catch (error) {
      if (isDshMobileClientError(error)) throw error;
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshMobileClientError;
    }
  }

  async function userMultipartRequest<T>(accessToken: string, path: string, method: string, body: FormData | undefined, headers: Record<string, string> = {}, nativeUpload?: DshNativeMultipartUpload, uploadMeta: Omit<Parameters<DshNativeMultipartUpload>[0], "url" | "method" | "headers" | "signal"> = { fieldName: "file", fileName: "upload.bin", mimeType: "application/octet-stream", parameters: {} }): Promise<T> {
    const token = accessToken.trim();
    if (!token) throw new Error("DSH_ACCESS_TOKEN_REQUIRED");
    try {
      const result = await requestWithTimeout(async (signal) => {
        const requestHeaders = { Accept: "application/json", Authorization: `Bearer ${token}`, ...headers };
        const nativeResult = nativeUpload ? await nativeUpload({ url: `${baseUrl}${path}`, method, headers: requestHeaders, ...uploadMeta, signal }) : undefined;
        const fetchInit: RequestInit = { method, headers: requestHeaders, signal };
        if (body !== undefined) fetchInit.body = body;
        const response = nativeResult ? undefined : await fetch(`${baseUrl}${path}`, fetchInit);
        const status = nativeResult?.status ?? response?.status ?? 0;
        const responseText = nativeResult?.body ?? await response?.text();
        if (status < 200 || status >= 300) {
          let raw: { error?: { code?: unknown; message?: unknown } } | null = null;
          try { raw = responseText ? JSON.parse(responseText) as { error?: { code?: unknown; message?: unknown } } : null; } catch { raw = null; }
          const nested = raw?.error;
          throw { kind: "http", status, code: typeof nested?.code === "string" ? nested.code : "DSH_ERROR", message: typeof nested?.message === "string" ? nested.message : "dsh request failed" } satisfies DshMobileClientError;
        }
        if (!responseText) throw new Error("DSH_EMPTY_MULTIPART_RESPONSE");
        return JSON.parse(responseText) as T;
      }, timeoutMs);
      return result;
    } catch (error) {
      if (isDshMobileClientError(error)) throw error;
      throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshMobileClientError;
    }
  }

  function mutationHeaders(idempotencyKey?: string, correlationID?: string): Record<string, string> {
    const randomUUID = options.cryptoRandomUUID;
    if (!randomUUID) throw new Error("DSH_IDEMPOTENCY_KEY_GENERATOR_REQUIRED");
    const normalizedKey = idempotencyKey?.trim() ?? "";
    const normalizedCorrelation = correlationID?.trim() ?? "";
    if (normalizedKey && (normalizedKey.length < 8 || normalizedKey.length > 128)) throw new Error("DSH_IDEMPOTENCY_KEY_INVALID");
    if (normalizedCorrelation && (normalizedCorrelation.length < 8 || normalizedCorrelation.length > 128)) throw new Error("DSH_CORRELATION_ID_INVALID");
    return { "X-Correlation-ID": normalizedCorrelation || randomUUID(), "Idempotency-Key": normalizedKey || randomUUID() };
  }

  function correlationHeaders(): Record<string, string> {
    const randomUUID = options.cryptoRandomUUID;
    if (!randomUUID) throw new Error("DSH_CORRELATION_ID_GENERATOR_REQUIRED");
    return { "X-Correlation-ID": randomUUID() };
  }

  function assertCoordinates(latitude: number, longitude: number): void {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error("DSH_LOCATION_COORDINATES_INVALID");
    }
  }

  async function uploadPrivateJoiningCaseProofImage(accessToken: string, rawPath: string, method: string, caseID: string, input: DshImageUploadInput, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
    const normalized = caseID.trim();
    const uri = input.uri.trim();
    if (!normalized || !uri || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_PROOF_IMAGE_INPUT_INVALID");
    const fileName = input.name?.trim() || "joining-case-proof.jpg";
    const mimeType = input.type?.trim() || "image/jpeg";
    const form = input.nativeMultipartUpload ? undefined : new FormData();
    if (form) form.append("file", input.blob ?? ({ uri, name: fileName, type: mimeType } as unknown as Blob));
    const path = rawPath.replace("{caseId}", encodeURIComponent(normalized));
    return userMultipartRequest(accessToken, path, method, form, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) }, input.nativeMultipartUpload, { fieldName: "file", fileName, mimeType, parameters: {} });
  }

  return {
    async listCatalogVerticals(): Promise<CommerceVerticalListResponse["verticals"]> {
      return (await publicRequest<CommerceVerticalListResponse>(dshOperationPaths.listCatalogVerticals.path)).verticals;
    },
    async listCommercialStoreTypes(verticalID: string): Promise<CommercialStoreTypeListResponse["storeTypes"]> {
      const normalized = verticalID.trim();
      if (!normalized || normalized.length > 128) throw new Error("DSH_COMMERCIAL_STORE_TYPE_LIST_INPUT_INVALID");
      const params = new URLSearchParams({ verticalId: normalized });
      return (await publicRequest<CommercialStoreTypeListResponse>(`${dshOperationPaths.listCommercialStoreTypes.path}?${params.toString()}`)).storeTypes;
    },
    async listCatalogCategories(verticalID: string, query = "", limit = 25, cursor = ""): Promise<CatalogCategoryListResponse> {
      const normalized = verticalID.trim();
      if (!normalized || normalized.length > 128 || query.trim().length > 160 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor.length > 2048) throw new Error("DSH_CATEGORY_LIST_INPUT_INVALID");
      const params = new URLSearchParams({ verticalId: normalized, limit: String(limit) });
      if (query.trim()) params.set("query", query.trim());
      if (cursor.trim()) params.set("cursor", cursor.trim());
      return publicRequest<CatalogCategoryListResponse>(`${dshOperationPaths.listCatalogCategories.path}?${params.toString()}`);
    },
    async listPublicCatalogCategoryAttributeRules(categoryID: string): Promise<CatalogAttributeRuleListResponse["rules"]> {
      const normalized = categoryID.trim();
      if (!normalized) throw new Error("DSH_CATEGORY_ID_REQUIRED");
      const path = dshOperationPaths.listPublicCatalogCategoryAttributeRules.path.replace("{categoryId}", encodeURIComponent(normalized));
      return (await publicRequest<CatalogAttributeRuleListResponse>(path)).rules;
    },
    async listPublicCatalogAttributeEnumOptions(attributeID: string): Promise<CatalogAttributeEnumOptionListResponse["options"]> {
      const normalized = attributeID.trim();
      if (!normalized) throw new Error("DSH_ATTRIBUTE_ID_REQUIRED");
      const path = dshOperationPaths.listPublicCatalogAttributeEnumOptions.path.replace("{attributeId}", encodeURIComponent(normalized));
      return (await publicRequest<CatalogAttributeEnumOptionListResponse>(path)).options;
    },
    async readOwnJoiningCase(accessToken: string): Promise<JoiningCaseResponse> {
      return userRequest<JoiningCaseResponse>(accessToken, dshOperationPaths.readOwnJoiningCase.path, dshOperationPaths.readOwnJoiningCase.method);
    },
    async listPartnerAccessibleStores(accessToken: string, limit = 25, cursor = ""): Promise<PartnerAccessibleStorePage> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.trim().length > 128) throw new Error("DSH_PARTNER_ACCESSIBLE_STORES_INPUT_INVALID");
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor.trim()) query.set("cursor", cursor.trim());
      return userRequest<PartnerAccessibleStorePage>(accessToken, `${dshOperationPaths.listPartnerAccessibleStores.path}?${query.toString()}`, dshOperationPaths.listPartnerAccessibleStores.method);
    },
    async listPartnerStoreAccessGrants(accessToken: string, storeID: string): Promise<StoreAccessGrantListResponse> {
      const normalizedStore = storeID.trim();
      if (!normalizedStore) throw new Error("DSH_STORE_ACCESS_STORE_REQUIRED");
      const path = dshOperationPaths.listPartnerStoreAccessGrants.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<StoreAccessGrantListResponse>(accessToken, path, dshOperationPaths.listPartnerStoreAccessGrants.method);
    },
    async createPartnerStoreAccessInvitation(accessToken: string, storeID: string, input: StoreAccessInvitationCreateRequest, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
      const normalizedStore = storeID.trim();
      const delegatePhoneE164 = input.delegatePhoneE164.trim();
      const allowedPermissions: ReadonlyArray<StoreAccessPermission> = ["orders", "catalog", "store_operations"];
      if (!normalizedStore || delegatePhoneE164.length < 8 || delegatePhoneE164.length > 24 || input.permissions.length < 1 || input.permissions.length > 3 || new Set(input.permissions).size !== input.permissions.length || input.permissions.some((permission) => !allowedPermissions.includes(permission))) throw new Error("DSH_STORE_ACCESS_INVITATION_INPUT_INVALID");
      const path = dshOperationPaths.createPartnerStoreAccessInvitation.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<StoreAccessGrantMutationResponse>(accessToken, path, dshOperationPaths.createPartnerStoreAccessInvitation.method, { delegatePhoneE164, permissions: Array.from(input.permissions) }, mutationHeaders(idempotencyKey, correlationID));
    },
    async transitionPartnerStoreAccessGrant(accessToken: string, storeID: string, grantID: string, input: StoreAccessGrantTransitionRequest, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
      const normalizedStore = storeID.trim();
      const normalizedGrant = grantID.trim();
      if (!normalizedStore || !normalizedGrant || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || !["active", "suspended", "revoked"].includes(input.state)) throw new Error("DSH_STORE_ACCESS_TRANSITION_INPUT_INVALID");
      const path = dshOperationPaths.transitionPartnerStoreAccessGrant.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{grantId}", encodeURIComponent(normalizedGrant));
      return userRequest<StoreAccessGrantMutationResponse>(accessToken, path, dshOperationPaths.transitionPartnerStoreAccessGrant.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async updatePartnerStoreAccessPermissions(accessToken: string, storeID: string, grantID: string, input: StoreAccessGrantPermissionsRequest, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
      const normalizedStore = storeID.trim();
      const normalizedGrant = grantID.trim();
      const allowedPermissions: ReadonlyArray<StoreAccessPermission> = ["orders", "catalog", "store_operations"];
      if (!normalizedStore || !normalizedGrant || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.permissions.length < 1 || input.permissions.length > 3 || new Set(input.permissions).size !== input.permissions.length || input.permissions.some((permission) => !allowedPermissions.includes(permission))) throw new Error("DSH_STORE_ACCESS_PERMISSIONS_INPUT_INVALID");
      const path = dshOperationPaths.updatePartnerStoreAccessPermissions.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{grantId}", encodeURIComponent(normalizedGrant));
      return userRequest<StoreAccessGrantMutationResponse>(accessToken, path, dshOperationPaths.updatePartnerStoreAccessPermissions.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async listActorStoreAccessInvitations(accessToken: string): Promise<StoreAccessGrantListResponse> {
      return userRequest<StoreAccessGrantListResponse>(accessToken, dshOperationPaths.listActorStoreAccessInvitations.path, dshOperationPaths.listActorStoreAccessInvitations.method);
    },
    async decideActorStoreAccessInvitation(accessToken: string, grantID: string, input: StoreAccessInvitationDecisionRequest, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
      const normalizedGrant = grantID.trim();
      if (!normalizedGrant || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || (input.decision !== "accept" && input.decision !== "decline")) throw new Error("DSH_STORE_ACCESS_DECISION_INPUT_INVALID");
      const path = dshOperationPaths.decideActorStoreAccessInvitation.path.replace("{grantId}", encodeURIComponent(normalizedGrant));
      return userRequest<StoreAccessGrantMutationResponse>(accessToken, path, dshOperationPaths.decideActorStoreAccessInvitation.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async activatePartnerStoreAccessInvitation(accessToken: string, grantID: string, input: StoreAccessGrantActivationRequest, idempotencyKey: string, correlationID: string): Promise<StoreAccessGrantMutationResponse> {
      const normalizedGrant = grantID.trim();
      if (!normalizedGrant || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error("DSH_STORE_ACCESS_ACTIVATION_INPUT_INVALID");
      const path = dshOperationPaths.activatePartnerStoreAccessInvitation.path.replace("{grantId}", encodeURIComponent(normalizedGrant));
      return userRequest<StoreAccessGrantMutationResponse>(accessToken, path, dshOperationPaths.activatePartnerStoreAccessInvitation.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async listPartnerStorePayoutRecipients(accessToken: string): Promise<StorePayoutRecipientListResponse> {
      return userRequest<StorePayoutRecipientListResponse>(accessToken, dshOperationPaths.listPartnerStorePayoutRecipients.path, dshOperationPaths.listPartnerStorePayoutRecipients.method);
    },
    async selectPartnerStorePayoutRecipient(accessToken: string, storeID: string, input: StorePayoutRecipientSelectRequest, idempotencyKey: string, correlationID: string): Promise<StorePayoutRecipientMutationResponse> {
      const normalizedStore = storeID.trim();
      const normalizedGrant = input.grantId.trim();
      const normalizedReason = input.reason.trim();
      if (!normalizedStore || !normalizedGrant || normalizedReason.length < 1 || normalizedReason.length > 500) throw new Error("DSH_STORE_PAYOUT_RECIPIENT_SELECT_INPUT_INVALID");
      const path = dshOperationPaths.selectPartnerStorePayoutRecipient.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<StorePayoutRecipientMutationResponse>(accessToken, path, dshOperationPaths.selectPartnerStorePayoutRecipient.method, { grantId: normalizedGrant, reason: normalizedReason }, mutationHeaders(idempotencyKey, correlationID));
    },
    async revertPartnerStorePayoutRecipient(accessToken: string, storeID: string, input: StorePayoutRecipientRevertRequest, idempotencyKey: string, correlationID: string): Promise<StorePayoutRecipientRevertResponse> {
      const normalizedStore = storeID.trim();
      const normalizedReason = input.reason.trim();
      if (!normalizedStore || normalizedReason.length < 1 || normalizedReason.length > 500) throw new Error("DSH_STORE_PAYOUT_RECIPIENT_REVERT_INPUT_INVALID");
      const path = dshOperationPaths.revertPartnerStorePayoutRecipient.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<StorePayoutRecipientRevertResponse>(accessToken, path, dshOperationPaths.revertPartnerStorePayoutRecipient.method, { reason: normalizedReason }, mutationHeaders(idempotencyKey, correlationID));
    },
    async listPartnerStorePromotions(accessToken: string, storeID: string): Promise<OperatorPromotionRegistryResponse> {
      const normalizedStore = storeID.trim();
      if (!normalizedStore) throw new Error("DSH_PARTNER_PROMOTIONS_STORE_REQUIRED");
      const path = dshOperationPaths.listPartnerStorePromotions.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<OperatorPromotionRegistryResponse>(accessToken, path, dshOperationPaths.listPartnerStorePromotions.method);
    },
    async createPartnerStorePromotion(accessToken: string, storeID: string, input: CreatePromotionRequest, idempotencyKey: string, correlationID: string): Promise<PromotionResponse> {
      const normalizedStore = storeID.trim();
      const normalizedCode = input.code.trim().toUpperCase();
      const normalizedName = input.nameAr.trim();
      if (!normalizedStore || normalizedCode.length < 3 || normalizedCode.length > 64 || normalizedName.length < 2 || !Number.isSafeInteger(input.valueMinor) || input.valueMinor <= 0 || (input.kind !== "PERCENTAGE" && input.kind !== "FIXED")) throw new Error("DSH_PARTNER_PROMOTION_CREATE_INPUT_INVALID");
      const path = dshOperationPaths.createPartnerStorePromotion.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<PromotionResponse>(accessToken, path, dshOperationPaths.createPartnerStorePromotion.method, { ...input, code: normalizedCode, nameAr: normalizedName, fundingSource: "PARTNER" }, mutationHeaders(idempotencyKey, correlationID));
    },
    async setPartnerStorePromotionState(accessToken: string, storeID: string, promotionID: string, input: MarketingPublicationRequest, expectedVersion: number, idempotencyKey: string, correlationID: string): Promise<PromotionResponse> {
      const normalizedStore = storeID.trim();
      const normalizedPromotion = promotionID.trim();
      if (!normalizedStore || !normalizedPromotion || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !["PUBLISHED", "PAUSED", "ENDED"].includes(input.state)) throw new Error("DSH_PARTNER_PROMOTION_STATE_INPUT_INVALID");
      const path = dshOperationPaths.setPartnerStorePromotionState.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{promotionId}", encodeURIComponent(normalizedPromotion));
      return userRequest<PromotionResponse>(accessToken, path, dshOperationPaths.setPartnerStorePromotionState.method, input, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
    },
    async readPartnerStoreOperationalAvailability(accessToken: string, storeID: string): Promise<PartnerStoreOperationalAvailabilityResponse> {
      const normalizedStore = storeID.trim();
      if (!normalizedStore) throw new Error("DSH_STORE_OPERATIONAL_AVAILABILITY_STORE_REQUIRED");
      const path = dshOperationPaths.readPartnerStoreOperationalAvailability.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<PartnerStoreOperationalAvailabilityResponse>(accessToken, path, dshOperationPaths.readPartnerStoreOperationalAvailability.method);
    },
    async updatePartnerStoreOperationalAvailability(accessToken: string, storeID: string, input: StoreOperationalAvailabilityRequest, idempotencyKey: string, correlationID: string): Promise<PartnerStoreOperationalAvailabilityMutationResponse> {
      const normalizedStore = storeID.trim();
      if (!normalizedStore || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || !idempotencyKey.trim() || !correlationID.trim()) throw new Error("DSH_STORE_OPERATIONAL_AVAILABILITY_INPUT_INVALID");
      const path = dshOperationPaths.updatePartnerStoreOperationalAvailability.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<PartnerStoreOperationalAvailabilityMutationResponse>(accessToken, path, dshOperationPaths.updatePartnerStoreOperationalAvailability.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async readOwnPartnerFinancialSummary(accessToken: string): Promise<PartnerFinancialSummaryResponse> {
      return userRequest<PartnerFinancialSummaryResponse>(accessToken, dshOperationPaths.readOwnPartnerFinancialSummary.path, dshOperationPaths.readOwnPartnerFinancialSummary.method);
    },
    async readOwnFieldFinancialSummary(accessToken: string): Promise<FieldFinancialSummaryResponse> {
      return userRequest<FieldFinancialSummaryResponse>(accessToken, dshOperationPaths.readOwnFieldFinancialSummary.path, dshOperationPaths.readOwnFieldFinancialSummary.method);
    },
    async listOwnFieldAcquisitionEntitlements(accessToken: string, limit = 50, cursor = ""): Promise<FieldAcquisitionEntitlementPage> {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor.trim()) query.set("cursor", cursor.trim());
      const path = `${dshOperationPaths.listOwnFieldAcquisitionEntitlements.path}?${query.toString()}`;
      return userRequest<FieldAcquisitionEntitlementPage>(accessToken, path, dshOperationPaths.listOwnFieldAcquisitionEntitlements.method);
    },
    async readOwnPayoutState(accessToken: string): Promise<BeneficiaryPayoutStateResponse> {
      return userRequest<BeneficiaryPayoutStateResponse>(accessToken, dshOperationPaths.readOwnPayoutState.path, dshOperationPaths.readOwnPayoutState.method);
    },
    async readOwnWallet(accessToken: string): Promise<BeneficiaryWalletResponse> {
      return userRequest<BeneficiaryWalletResponse>(accessToken, dshOperationPaths.readOwnWallet.path, dshOperationPaths.readOwnWallet.method);
    },
    async createOwnFundingIntent(accessToken: string, amountMinor: number, idempotencyKey?: string, correlationID?: string): Promise<BeneficiaryFundingIntentResponse> {
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("DSH_CASH_IN_AMOUNT_INVALID");
      return userRequest<BeneficiaryFundingIntentResponse>(accessToken, dshOperationPaths.createOwnFundingIntent.path, dshOperationPaths.createOwnFundingIntent.method, { amountMinor }, mutationHeaders(idempotencyKey, correlationID));
    },
    async readOwnFundingIntent(accessToken: string, fundingIntentID: string): Promise<Readonly<{ intent: CashInFundingIntent }>> {
      const normalized = fundingIntentID.trim();
      if (!normalized) throw new Error("DSH_FUNDING_INTENT_ID_REQUIRED");
      const path = dshOperationPaths.readOwnFundingIntent.path.replace("{fundingIntentId}", encodeURIComponent(normalized));
      return userRequest<Readonly<{ intent: CashInFundingIntent }>>(accessToken, path, dshOperationPaths.readOwnFundingIntent.method);
    },
    async simulateOwnFundingIntent(accessToken: string, fundingIntentID: string, outcome: "SUCCESS" | "FAILURE" | "UNKNOWN" | "DELAYED", idempotencyKey?: string, correlationID?: string): Promise<BeneficiaryFundingIntentResponse> {
      const normalized = fundingIntentID.trim();
      if (!normalized) throw new Error("DSH_FUNDING_INTENT_ID_REQUIRED");
      const path = dshOperationPaths.simulateOwnFundingIntent.path.replace("{fundingIntentId}", encodeURIComponent(normalized));
      return userRequest<BeneficiaryFundingIntentResponse>(accessToken, path, dshOperationPaths.simulateOwnFundingIntent.method, { outcome }, mutationHeaders(idempotencyKey, correlationID));
    },
    async createOwnPayoutIntent(accessToken: string, amountMode: "FULL_AVAILABLE" | "SPECIFIED", amountMinor?: number, idempotencyKey?: string, correlationID?: string): Promise<PayoutIntentResponse> {
      if (amountMode === "SPECIFIED" && (!Number.isSafeInteger(amountMinor) || (amountMinor ?? 0) <= 0)) throw new Error("DSH_PAYOUT_AMOUNT_INVALID");
      if (amountMode === "FULL_AVAILABLE" && amountMinor !== undefined) throw new Error("DSH_PAYOUT_AMOUNT_INVALID");
      return userRequest<PayoutIntentResponse>(accessToken, dshOperationPaths.createOwnPayoutIntent.path, dshOperationPaths.createOwnPayoutIntent.method, { amountMode, ...(amountMinor === undefined ? {} : { amountMinor }) }, mutationHeaders(idempotencyKey, correlationID));
    },
    async correctAndResubmitJoiningCase(accessToken: string, caseID: string, input: CorrectJoiningCaseRequest, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
      const normalized = caseID.trim();
      const businessName = input.businessName.trim();
      const firstStoreName = input.firstStoreName.trim();
      const serviceCityId = input.serviceCityId.trim();
      const firstStoreVerticalId = input.firstStoreVerticalId.trim();
      const firstStoreCommercialTypeId = input.firstStoreCommercialTypeId.trim();
      if (!normalized || businessName.length < 2 || businessName.length > 160 || firstStoreName.length < 2 || firstStoreName.length > 160 || !serviceCityId || !firstStoreVerticalId || !firstStoreCommercialTypeId || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude) || input.firstStoreLatitude < -90 || input.firstStoreLatitude > 90 || input.firstStoreLongitude < -180 || input.firstStoreLongitude > 180 || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
      const path = dshOperationPaths.correctAndResubmitJoiningCase.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<JoiningCaseResponse>(accessToken, path, dshOperationPaths.correctAndResubmitJoiningCase.method, { businessName, firstStoreName, serviceCityId, firstStoreVerticalId, firstStoreCommercialTypeId, firstStoreLatitude: input.firstStoreLatitude, firstStoreLongitude: input.firstStoreLongitude }, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
    },
    async listCatalogProducts(accessToken: string, query = "", verticalID = "", limit = 100, cursor = ""): Promise<CatalogProductListResponse> {
      if (limit < 1 || limit > 100) throw new Error("DSH_PRODUCT_LIMIT_INVALID");
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (verticalID.trim()) params.set("verticalId", verticalID.trim());
      if (cursor.trim()) params.set("cursor", cursor.trim());
      params.set("limit", String(limit));
      const suffix = params.toString();
      const path = `${dshOperationPaths.listCatalogProducts.path}${suffix ? `?${suffix}` : ""}`;
      return userRequest<CatalogProductListResponse>(accessToken, path, dshOperationPaths.listCatalogProducts.method);
    },
    async createStoreScopedProduct(accessToken: string, storeID: string, input: CreateCatalogProductRequest): Promise<{ product: CatalogProduct; idempotentReplay: boolean }> {
      const normalizedStore = storeID.trim();
        if (!normalizedStore || input.scope !== "STORE_SCOPED" || input.verticalId.trim() === "" || input.canonicalName.trim() === "") throw new Error("DSH_STORE_PRODUCT_INPUT_INVALID");
      const path = dshOperationPaths.createStoreScopedProduct.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest(accessToken, path, dshOperationPaths.createStoreScopedProduct.method, { ...input, scope: "STORE_SCOPED", storeId: normalizedStore }, mutationHeaders());
    },
    async uploadStoreProductMedia(accessToken: string, storeID: string, productID: string, input: DshImageUploadInput, role: "primary" | "gallery", provenance: MediaProvenanceInput, expectedVersion: number, idempotencyKey: string): Promise<{ product: CatalogProduct; idempotentReplay: boolean }> {
      const normalizedStore = storeID.trim();
      const normalizedProduct = productID.trim();
      const uri = input.uri.trim();
      if (!normalizedStore || !normalizedProduct || !uri || expectedVersion < 1 || !idempotencyKey.trim() || (role !== "primary" && role !== "gallery") || !isMediaProvenanceInputValid(provenance)) throw new Error("DSH_STORE_PRODUCT_MEDIA_INPUT_INVALID");
      const fileName = input.name?.trim() || "product-image.jpg";
      const mimeType = input.type?.trim() || "image/jpeg";
      const form = input.nativeMultipartUpload ? undefined : new FormData();
      if (form) {
        form.append("role", role);
        form.append("file", input.blob ?? ({ uri, name: fileName, type: mimeType } as unknown as Blob));
        appendMediaProvenance(form, provenance);
      }
      const path = dshOperationPaths.uploadStoreProductMedia.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{productId}", encodeURIComponent(normalizedProduct));
      return userMultipartRequest(accessToken, path, dshOperationPaths.uploadStoreProductMedia.method, form, { ...mutationHeaders(idempotencyKey), "X-Expected-Version": String(expectedVersion) }, input.nativeMultipartUpload, { fieldName: "file", fileName, mimeType, parameters: { role, ...mediaProvenanceParameters(provenance) } });
    },
    async replaceStoreProductMedia(accessToken: string, storeID: string, productID: string, input: ReplaceCatalogProductMediaRequest, expectedVersion: number): Promise<{ product: CatalogProduct; idempotentReplay: boolean }> {
      const normalizedStore = storeID.trim();
      const normalizedProduct = productID.trim();
      if (!normalizedStore || !normalizedProduct || expectedVersion < 1 || input.media.length > 21) throw new Error("DSH_STORE_PRODUCT_MEDIA_INPUT_INVALID");
      const path = dshOperationPaths.replaceStoreProductMedia.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{productId}", encodeURIComponent(normalizedProduct));
      return userRequest(accessToken, path, dshOperationPaths.replaceStoreProductMedia.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async updateStoreScopedProduct(accessToken: string, storeID: string, productID: string, input: UpdateCatalogProductRequest, expectedVersion: number): Promise<{ product: CatalogProduct; idempotentReplay: boolean }> {
      const normalizedStore = storeID.trim();
      const normalizedProduct = productID.trim();
      if (!normalizedStore || !normalizedProduct || input.scope !== "STORE_SCOPED" || !input.canonicalName.trim() || expectedVersion < 1) throw new Error("DSH_STORE_PRODUCT_INPUT_INVALID");
      const path = dshOperationPaths.updateStoreScopedProduct.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{productId}", encodeURIComponent(normalizedProduct));
      return userRequest(accessToken, path, dshOperationPaths.updateStoreScopedProduct.method, { ...input, scope: "STORE_SCOPED", storeId: normalizedStore }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async createStoreVariant(accessToken: string, storeID: string, productID: string, input: CreateCatalogVariantRequest): Promise<CatalogVariantResponse> {
      const normalizedStore = storeID.trim();
      const normalizedProduct = productID.trim();
      if (!normalizedStore || !normalizedProduct || !input.id.trim() || !input.title.trim()) throw new Error("DSH_STORE_VARIANT_INPUT_INVALID");
      const path = dshOperationPaths.createStoreVariant.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{productId}", encodeURIComponent(normalizedProduct));
      return userRequest<CatalogVariantResponse>(accessToken, path, dshOperationPaths.createStoreVariant.method, input, mutationHeaders());
    },
    async updateStoreVariant(accessToken: string, storeID: string, variantID: string, input: UpdateCatalogVariantRequest, expectedVersion: number): Promise<CatalogVariantResponse> {
      const normalizedStore = storeID.trim();
      const normalizedVariant = variantID.trim();
      if (!normalizedStore || !normalizedVariant || !input.title.trim() || expectedVersion < 1) throw new Error("DSH_STORE_VARIANT_INPUT_INVALID");
      const path = dshOperationPaths.updateStoreVariant.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{variantId}", encodeURIComponent(normalizedVariant));
      return userRequest<CatalogVariantResponse>(accessToken, path, dshOperationPaths.updateStoreVariant.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listOwnCatalogProductProposals(accessToken: string, state = "", limit = 50, cursor = ""): Promise<CatalogProductProposalListResponse> {
      if (limit < 1 || limit > 100) throw new Error("DSH_PROPOSAL_LIMIT_INVALID");
      const params = new URLSearchParams({ limit: String(limit) });
      if (state.trim()) params.set("state", state.trim());
      if (cursor.trim()) params.set("cursor", cursor.trim());
      return userRequest<CatalogProductProposalListResponse>(accessToken, `${dshOperationPaths.listOwnCatalogProductProposals.path}?${params.toString()}`, dshOperationPaths.listOwnCatalogProductProposals.method);
    },
    async createCatalogProductProposal(accessToken: string, input: CreateCatalogProductProposalRequest): Promise<CatalogProductProposalResponse> {
      if (!input.id.trim() || !input.verticalId.trim() || !input.categoryId.trim() || !input.proposedName.trim()) throw new Error("DSH_PROPOSAL_INPUT_INVALID");
      return userRequest<CatalogProductProposalResponse>(accessToken, dshOperationPaths.createCatalogProductProposal.path, dshOperationPaths.createCatalogProductProposal.method, input, mutationHeaders());
    },
    async updateCatalogProductProposal(accessToken: string, proposalID: string, input: UpdateCatalogProductProposalRequest, expectedVersion: number): Promise<CatalogProductProposalResponse> {
      const normalized = proposalID.trim();
      if (!normalized || !input.verticalId.trim() || !input.categoryId.trim() || !input.proposedName.trim() || expectedVersion < 1) throw new Error("DSH_PROPOSAL_INPUT_INVALID");
      const path = dshOperationPaths.updateCatalogProductProposal.path.replace("{proposalId}", encodeURIComponent(normalized));
      return userRequest<CatalogProductProposalResponse>(accessToken, path, dshOperationPaths.updateCatalogProductProposal.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async submitCatalogProductProposal(accessToken: string, proposalID: string, expectedVersion: number): Promise<CatalogProductProposalResponse> {
      const normalized = proposalID.trim();
      if (!normalized || expectedVersion < 1) throw new Error("DSH_PROPOSAL_INPUT_INVALID");
      const path = dshOperationPaths.submitCatalogProductProposal.path.replace("{proposalId}", encodeURIComponent(normalized));
      return userRequest<CatalogProductProposalResponse>(accessToken, path, dshOperationPaths.submitCatalogProductProposal.method, undefined, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async createCatalogModifierGroup(accessToken: string, storeID: string, input: CreateCatalogModifierGroupRequest): Promise<CatalogModifierGroupResponse> {
      const normalized = storeID.trim();
      if (!normalized || !input.nameAr.trim() || input.minSelections < 0 || input.maxSelections < input.minSelections) throw new Error("DSH_MODIFIER_INPUT_INVALID");
      const path = dshOperationPaths.createCatalogModifierGroup.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<CatalogModifierGroupResponse>(accessToken, path, dshOperationPaths.createCatalogModifierGroup.method, input, mutationHeaders());
    },
    async createCatalogModifierOption(accessToken: string, storeID: string, groupID: string, input: CreateCatalogModifierOptionRequest): Promise<CatalogModifierOptionResponse> {
      const normalized = storeID.trim();
      const normalizedGroup = groupID.trim();
      if (!normalized || !normalizedGroup || !input.nameAr.trim() || input.priceDeltaMinor < 0) throw new Error("DSH_MODIFIER_INPUT_INVALID");
      const path = dshOperationPaths.createCatalogModifierOption.path.replace("{storeId}", encodeURIComponent(normalized)).replace("{groupId}", encodeURIComponent(normalizedGroup));
      return userRequest<CatalogModifierOptionResponse>(accessToken, path, dshOperationPaths.createCatalogModifierOption.method, input, mutationHeaders());
    },
    async attachCatalogModifierGroup(accessToken: string, storeID: string, offerID: string, groupID: string, ordinal = 0): Promise<CatalogStoreOfferResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOffer = offerID.trim();
      const normalizedGroup = groupID.trim();
      if (!normalizedStore || !normalizedOffer || !normalizedGroup || ordinal < 0) throw new Error("DSH_MODIFIER_INPUT_INVALID");
      const path = dshOperationPaths.attachCatalogModifierGroup.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{offerId}", encodeURIComponent(normalizedOffer)).replace("{groupId}", encodeURIComponent(normalizedGroup));
      return userRequest<CatalogStoreOfferResponse>(accessToken, path, dshOperationPaths.attachCatalogModifierGroup.method, { ordinal }, mutationHeaders());
    },
    async createCatalogStorefrontSection(accessToken: string, storeID: string, input: CreateCatalogStorefrontSectionRequest): Promise<CatalogStorefrontSectionResponse> {
      const normalized = storeID.trim();
      if (!normalized || !input.nameAr.trim() || input.ordinal < 0) throw new Error("DSH_SECTION_INPUT_INVALID");
      const path = dshOperationPaths.createCatalogStorefrontSection.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<CatalogStorefrontSectionResponse>(accessToken, path, dshOperationPaths.createCatalogStorefrontSection.method, input, mutationHeaders());
    },
    async attachCatalogOfferToSection(accessToken: string, storeID: string, sectionID: string, offerID: string, ordinal = 0): Promise<CatalogStorefrontSectionResponse> {
      const normalizedStore = storeID.trim();
      const normalizedSection = sectionID.trim();
      const normalizedOffer = offerID.trim();
      if (!normalizedStore || !normalizedSection || !normalizedOffer || ordinal < 0) throw new Error("DSH_SECTION_INPUT_INVALID");
      const path = dshOperationPaths.attachCatalogOfferToSection.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{sectionId}", encodeURIComponent(normalizedSection)).replace("{offerId}", encodeURIComponent(normalizedOffer));
      return userRequest<CatalogStorefrontSectionResponse>(accessToken, path, dshOperationPaths.attachCatalogOfferToSection.method, { ordinal }, mutationHeaders());
    },
    async readOwnStoreOffers(accessToken: string, storeID: string, limit = 50, cursor = ""): Promise<CatalogStoreOfferListResponse> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor.length > 2048) throw new Error("DSH_STORE_OFFER_PAGE_INVALID");
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor.trim()) params.set("cursor", cursor.trim());
      const path = `${dshOperationPaths.readOwnStoreOffers.path.replace("{storeId}", encodeURIComponent(normalized))}?${params.toString()}`;
      return userRequest<CatalogStoreOfferListResponse>(accessToken, path, dshOperationPaths.readOwnStoreOffers.method);
    },
    async previewPartnerStoreCatalogImport(accessToken: string, storeID: string, input: DshCatalogImportFileInput, idempotencyKey?: string, correlationID?: string): Promise<CatalogImportPreviewResponse> {
      const normalizedStore = storeID.trim();
      if (!normalizedStore || !input.uri.trim() || !validStoreCatalogImportName(input.name)) throw new Error("DSH_STORE_CATALOG_IMPORT_FILE_INVALID");
      const path = dshOperationPaths.previewPartnerStoreCatalogImport.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      const type = input.type?.trim() || storeCatalogImportMimeType(input.name);
      const form = input.nativeMultipartUpload ? undefined : new FormData();
      if (form) form.append("file", input.blob ?? ({ uri: input.uri.trim(), name: input.name.trim(), type } as unknown as Blob));
      return userMultipartRequest(accessToken, path, dshOperationPaths.previewPartnerStoreCatalogImport.method, form, mutationHeaders(idempotencyKey, correlationID), input.nativeMultipartUpload, { fieldName: "file", fileName: input.name.trim(), mimeType: type, parameters: {} });
    },
    async readPartnerStoreCatalogImport(accessToken: string, storeID: string, runID: string): Promise<CatalogImportRunResponse> {
      const store = storeID.trim();
      const run = runID.trim();
      if (!store || !run) throw new Error("DSH_STORE_CATALOG_IMPORT_SCOPE_INVALID");
      const path = dshOperationPaths.readPartnerStoreCatalogImport.path.replace("{storeId}", encodeURIComponent(store)).replace("{runId}", encodeURIComponent(run));
      return userRequest<CatalogImportRunResponse>(accessToken, path, dshOperationPaths.readPartnerStoreCatalogImport.method);
    },
    async commitPartnerStoreCatalogImport(accessToken: string, storeID: string, runID: string, idempotencyKey?: string, correlationID?: string): Promise<CatalogImportCommitResponse> {
      const store = storeID.trim();
      const run = runID.trim();
      if (!store || !run) throw new Error("DSH_STORE_CATALOG_IMPORT_SCOPE_INVALID");
      const path = dshOperationPaths.commitPartnerStoreCatalogImport.path.replace("{storeId}", encodeURIComponent(store)).replace("{runId}", encodeURIComponent(run));
      return userRequest<CatalogImportCommitResponse>(accessToken, path, dshOperationPaths.commitPartnerStoreCatalogImport.method, undefined, mutationHeaders(idempotencyKey, correlationID));
    },
    async readFieldStoreCommercialAgreements(accessToken: string, caseID: string): Promise<StoreCommercialAgreementListResponse> {
      const normalized = caseID.trim();
      if (!normalized) throw new Error("DSH_JOINING_CASE_ID_REQUIRED");
      const path = dshOperationPaths.readFieldStoreCommercialAgreements.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<StoreCommercialAgreementListResponse>(accessToken, path, dshOperationPaths.readFieldStoreCommercialAgreements.method);
    },
    async readFieldStoreCommercialAgreementDefaults(accessToken: string, caseID: string): Promise<StoreTypeCommissionDefaultsResponse> {
      const normalized = caseID.trim();
      if (!normalized) throw new Error("DSH_JOINING_CASE_ID_REQUIRED");
      const path = dshOperationPaths.readFieldStoreCommercialAgreementDefaults.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<StoreTypeCommissionDefaultsResponse>(accessToken, path, dshOperationPaths.readFieldStoreCommercialAgreementDefaults.method);
    },
    async proposeFieldStoreCommercialAgreement(accessToken: string, caseID: string, input: StoreCommercialAgreementProposalRequest, idempotencyKey?: string, correlationID?: string): Promise<StoreCommercialAgreementMutationResponse> {
      const normalized = caseID.trim();
      const reasonLength = Array.from(input.reason.trim()).length;
      if (!normalized || input.expectedCurrentVersion < 0 || input.rates.length < 1 || input.rates.length > 3 || !Number.isSafeInteger(input.expectedCurrentVersion) || reasonLength < 8 || reasonLength > 500 || input.rates.some((rate) => !Number.isSafeInteger(rate.commissionRateBps) || rate.commissionRateBps < 0 || rate.commissionRateBps > 10000)) throw new Error("DSH_STORE_COMMERCIAL_AGREEMENT_PROPOSAL_INVALID");
      const path = dshOperationPaths.proposeFieldStoreCommercialAgreement.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<StoreCommercialAgreementMutationResponse>(accessToken, path, dshOperationPaths.proposeFieldStoreCommercialAgreement.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async listOwnStoreQuickPrices(accessToken: string, storeID: string, filters: Readonly<{ q?: string; categoryId?: string; availability?: "all" | "available" | "unavailable"; publicationState?: "all" | "draft" | "published" | "hidden"; limit?: number; cursor?: string }> = {}): Promise<CatalogStoreOfferListResponse> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const limit = filters.limit ?? 50;
      const cursor = filters.cursor?.trim() ?? "";
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor.length > 2048 || (filters.q?.trim().length ?? 0) > 160 || (filters.categoryId?.trim().length ?? 0) > 128) throw new Error("DSH_QUICK_PRICE_FILTER_INVALID");
      const params = new URLSearchParams({ limit: String(limit) });
      if (filters.q?.trim()) params.set("q", filters.q.trim());
      if (filters.categoryId?.trim()) params.set("categoryId", filters.categoryId.trim());
      if (filters.availability) params.set("availability", filters.availability);
      if (filters.publicationState) params.set("publicationState", filters.publicationState);
      if (cursor) params.set("cursor", cursor);
      const path = `${dshOperationPaths.listOwnStoreQuickPrices.path.replace("{storeId}", encodeURIComponent(normalized))}?${params.toString()}`;
      return userRequest<CatalogStoreOfferListResponse>(accessToken, path, dshOperationPaths.listOwnStoreQuickPrices.method);
    },
    async commitOwnStoreQuickPrices(accessToken: string, storeID: string, input: CatalogQuickPriceCommitRequest, idempotencyKey?: string, correlationID?: string): Promise<CatalogQuickPriceCommitResponse> {
      const normalized = storeID.trim();
      if (!normalized || input.items.length < 1 || input.items.length > 100 || input.items.some((item) => !item.offerId.trim() || !Number.isSafeInteger(item.expectedVersion) || item.expectedVersion < 1 || !Number.isSafeInteger(item.priceMinor) || item.priceMinor < 1)) throw new Error("DSH_QUICK_PRICE_UPDATE_INVALID");
      const path = dshOperationPaths.commitOwnStoreQuickPrices.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<CatalogQuickPriceCommitResponse>(accessToken, path, dshOperationPaths.commitOwnStoreQuickPrices.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async createStoreOffer(accessToken: string, storeID: string, variantID: string, priceMinor: number, quantityPolicy: "DISCRETE" | "MEASURED" | "VARIABLE_MEASURE", pricingBasis: "PER_UNIT" | "PER_MEASURE", quantityMinBaseUnits: number, quantityMaxBaseUnits: number, quantityStepBaseUnits: number, pricingUnitBaseUnits: number, inventoryPolicy: "AVAILABILITY_ONLY" | "QUANTITY_ON_HAND", inventoryOnHandBaseUnits: number): Promise<CatalogStoreOfferResponse> {
      const normalized = storeID.trim();
      const normalizedVariant = variantID.trim();
      if (!normalized || !normalizedVariant || !Number.isSafeInteger(priceMinor) || priceMinor < 1) throw new Error("DSH_OFFER_INPUT_INVALID");
      const path = dshOperationPaths.createStoreOffer.path.replace("{storeId}", encodeURIComponent(normalized));
      if (![quantityMinBaseUnits, quantityMaxBaseUnits, quantityStepBaseUnits, pricingUnitBaseUnits, inventoryOnHandBaseUnits].every(Number.isSafeInteger) || quantityMinBaseUnits < 1 || quantityMaxBaseUnits < quantityMinBaseUnits || quantityStepBaseUnits < 1 || pricingUnitBaseUnits < 1 || inventoryOnHandBaseUnits < 0) throw new Error("DSH_OFFER_QUANTITY_INVALID");
      return userRequest<CatalogStoreOfferResponse>(accessToken, path, dshOperationPaths.createStoreOffer.method, { variantId: normalizedVariant, priceMinor, quantityPolicy, quantityMinBaseUnits, quantityMaxBaseUnits, quantityStepBaseUnits, pricingBasis, pricingUnitBaseUnits, inventoryPolicy, inventoryOnHandBaseUnits }, mutationHeaders());
    },
    async updateStoreOffer(accessToken: string, storeID: string, offerID: string, priceMinor: number, publicationState: "draft" | "published" | "hidden", availability: boolean, expectedVersion: number, quantityPolicy: "DISCRETE" | "MEASURED" | "VARIABLE_MEASURE", pricingBasis: "PER_UNIT" | "PER_MEASURE", quantityMinBaseUnits: number, quantityMaxBaseUnits: number, quantityStepBaseUnits: number, pricingUnitBaseUnits: number, inventoryPolicy: "AVAILABILITY_ONLY" | "QUANTITY_ON_HAND", inventoryOnHandBaseUnits: number): Promise<CatalogStoreOfferResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOffer = offerID.trim();
      if (!normalizedStore || !normalizedOffer || !Number.isSafeInteger(priceMinor) || priceMinor < 1 || expectedVersion < 1) throw new Error("DSH_OFFER_INPUT_INVALID");
      const path = dshOperationPaths.updateStoreOffer.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{offerId}", encodeURIComponent(normalizedOffer));
      if (![quantityMinBaseUnits, quantityMaxBaseUnits, quantityStepBaseUnits, pricingUnitBaseUnits, inventoryOnHandBaseUnits].every(Number.isSafeInteger) || quantityMinBaseUnits < 1 || quantityMaxBaseUnits < quantityMinBaseUnits || quantityStepBaseUnits < 1 || pricingUnitBaseUnits < 1 || inventoryOnHandBaseUnits < 0) throw new Error("DSH_OFFER_QUANTITY_INVALID");
      return userRequest<CatalogStoreOfferResponse>(accessToken, path, dshOperationPaths.updateStoreOffer.method, { priceMinor, publicationState, availability, quantityPolicy, quantityMinBaseUnits, quantityMaxBaseUnits, quantityStepBaseUnits, pricingBasis, pricingUnitBaseUnits, inventoryPolicy, inventoryOnHandBaseUnits }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listClientOpenCarts(accessToken: string): Promise<ClientOpenCartListResponse> {
      return userRequest<ClientOpenCartListResponse>(accessToken, dshOperationPaths.listClientOpenCarts.path, dshOperationPaths.listClientOpenCarts.method);
    },
    async readOpenCart(accessToken: string, storeID: string): Promise<CartResponse> {
      const normalizedStore = storeID.trim();
      if (!normalizedStore) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = `${dshOperationPaths.readOpenCart.path}?${new URLSearchParams({ storeId: normalizedStore }).toString()}`;
      return userRequest<CartResponse>(accessToken, path, dshOperationPaths.readOpenCart.method);
    },
    async quoteCheckout(accessToken: string, input: CheckoutRequest, expectedCartVersion: number): Promise<CheckoutQuoteResponse> {
      const addressId = input.addressId?.trim() ?? "";
      if (!input.cartId.trim() || !input.storeId.trim() || (input.fulfillmentMode !== "CUSTOMER_PICKUP" && !addressId) || !input.fulfillmentMode || expectedCartVersion < 1) throw new Error("DSH_CHECKOUT_INPUT_INVALID");
      return userRequest<CheckoutQuoteResponse>(accessToken, dshOperationPaths.quoteCheckout.path, dshOperationPaths.quoteCheckout.method, { ...input, cartId: input.cartId.trim(), storeId: input.storeId.trim(), addressId }, { "X-Expected-Version": String(expectedCartVersion) });
    },
    async upsertCartLine(accessToken: string, input: UpsertCartLineRequest, expectedVersion: number): Promise<CartResponse> {
      if (!input.storeId.trim() || !input.storeOfferId.trim() || !Number.isSafeInteger(input.quantityBaseUnits) || input.quantityBaseUnits < 1 || expectedVersion < 0) throw new Error("DSH_CART_INPUT_INVALID");
      return userRequest<CartResponse>(accessToken, dshOperationPaths.upsertCartLine.path, dshOperationPaths.upsertCartLine.method, { ...input, storeId: input.storeId.trim(), storeOfferId: input.storeOfferId.trim() }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async updateCartLine(accessToken: string, lineID: string, input: UpdateCartLineRequest, expectedVersion: number): Promise<CartResponse> {
      const normalized = lineID.trim();
      if (!normalized || !Number.isSafeInteger(input.quantityBaseUnits) || input.quantityBaseUnits < 1 || expectedVersion < 1) throw new Error("DSH_CART_INPUT_INVALID");
      const path = dshOperationPaths.updateCartLine.path.replace("{lineId}", encodeURIComponent(normalized));
      return userRequest<CartResponse>(accessToken, path, dshOperationPaths.updateCartLine.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async removeCartLine(accessToken: string, lineID: string, expectedVersion: number): Promise<CartResponse> {
      const normalized = lineID.trim();
      if (!normalized || expectedVersion < 1) throw new Error("DSH_CART_INPUT_INVALID");
      const path = dshOperationPaths.removeCartLine.path.replace("{lineId}", encodeURIComponent(normalized));
      return userRequest<CartResponse>(accessToken, path, dshOperationPaths.removeCartLine.method, undefined, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async checkoutCart(accessToken: string, input: CheckoutRequest, expectedCartVersion: number, idempotencyKey?: string, correlationID?: string): Promise<OrderResponse> {
      const addressId = input.addressId?.trim() ?? "";
      if (!input.cartId.trim() || !input.storeId.trim() || (input.fulfillmentMode !== "CUSTOMER_PICKUP" && !addressId) || !input.fulfillmentMode || expectedCartVersion < 1) throw new Error("DSH_CHECKOUT_INPUT_INVALID");
      return userRequest<OrderResponse>(accessToken, dshOperationPaths.checkoutCart.path, dshOperationPaths.checkoutCart.method, { ...input, cartId: input.cartId.trim(), storeId: input.storeId.trim(), addressId }, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedCartVersion) });
    },
    async createMultiStoreCheckout(accessToken: string, input: MultiStoreCheckoutRequest, idempotencyKey?: string, correlationID?: string): Promise<MultiStoreCheckoutResponse> {
      if (!input.id.trim() || input.children.length < 2 || input.children.length > 10 || input.children.some((child) => !child.cartId.trim() || !child.storeId.trim() || (child.fulfillmentMode !== "CUSTOMER_PICKUP" && !child.addressId.trim()) || child.cartVersion < 1 || !child.fulfillmentMode)) throw new Error("DSH_MULTI_STORE_CHECKOUT_INPUT_INVALID");
      return userRequest<MultiStoreCheckoutResponse>(accessToken, dshOperationPaths.createMultiStoreCheckout.path, dshOperationPaths.createMultiStoreCheckout.method, { ...input, id: input.id.trim(), children: input.children.map((child) => ({ ...child, cartId: child.cartId.trim(), storeId: child.storeId.trim(), addressId: child.addressId.trim(), promotionCode: child.promotionCode?.trim().toUpperCase() })) }, mutationHeaders(idempotencyKey, correlationID));
    },
    async readMultiStoreCheckout(accessToken: string, checkoutID: string): Promise<MultiStoreCheckoutResponse> {
      const normalized = checkoutID.trim();
      if (!normalized) throw new Error("DSH_MULTI_STORE_CHECKOUT_ID_REQUIRED");
      const path = dshOperationPaths.readMultiStoreCheckout.path.replace("{checkoutId}", encodeURIComponent(normalized));
      return userRequest<MultiStoreCheckoutResponse>(accessToken, path, dshOperationPaths.readMultiStoreCheckout.method);
    },
    async cancelMultiStoreCheckout(accessToken: string, checkoutID: string, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<MultiStoreCheckoutResponse> {
      const normalized = checkoutID.trim();
      if (!normalized || expectedVersion < 1) throw new Error("DSH_MULTI_STORE_CHECKOUT_CANCEL_INPUT_INVALID");
      const path = dshOperationPaths.cancelMultiStoreCheckout.path.replace("{checkoutId}", encodeURIComponent(normalized));
      return userRequest<MultiStoreCheckoutResponse>(accessToken, path, dshOperationPaths.cancelMultiStoreCheckout.method, undefined, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
    },
    async listClientOrders(accessToken: string, limit = 50, cartID = ""): Promise<OrderListResponse> {
      const normalizedCartID = cartID.trim();
      if (limit < 1 || limit > 100 || normalizedCartID.length > 128) throw new Error("DSH_ORDER_LIST_INPUT_INVALID");
      const query = new URLSearchParams({ limit: String(limit) });
      if (normalizedCartID) query.set("cartId", normalizedCartID);
      return userRequest<OrderListResponse>(accessToken, `${dshOperationPaths.listClientOrders.path}?${query.toString()}`, dshOperationPaths.listClientOrders.method);
    },
    async listNotifications(accessToken: string, limit = 50): Promise<NotificationListResponse> {
      if (limit < 1 || limit > 100) throw new Error("DSH_NOTIFICATION_LIMIT_INVALID");
      return userRequest<NotificationListResponse>(accessToken, `${dshOperationPaths.listNotifications.path}?${new URLSearchParams({ limit: String(limit) }).toString()}`, dshOperationPaths.listNotifications.method);
    },
    async markNotificationRead(accessToken: string, notificationID: string): Promise<NotificationReadResponse> {
      const normalized = notificationID.trim();
      if (!normalized) throw new Error("DSH_NOTIFICATION_ID_REQUIRED");
      const path = dshOperationPaths.markNotificationRead.path.replace("{notificationId}", encodeURIComponent(normalized));
      return userRequest<NotificationReadResponse>(accessToken, path, dshOperationPaths.markNotificationRead.method);
    },
    async readOrder(accessToken: string, orderID: string): Promise<OrderResponse> {
      const normalized = orderID.trim();
      if (!normalized) throw new Error("DSH_ORDER_ID_REQUIRED");
      const path = dshOperationPaths.readOrder.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderResponse>(accessToken, path, dshOperationPaths.readOrder.method);
    },
    async decideClientOrderAdjustment(accessToken: string, orderID: string, adjustmentID: string, input: OrderAdjustmentDecisionRequest, expectedOrderVersion: number): Promise<OrderResponse> {
      const normalizedOrder = orderID.trim();
      const normalizedAdjustment = adjustmentID.trim();
      if (!normalizedOrder || !normalizedAdjustment || expectedOrderVersion < 1 || input.expectedAdjustmentVersion < 1 || (input.decision !== "ACCEPT" && input.decision !== "REJECT")) throw new Error("DSH_ORDER_ADJUSTMENT_DECISION_INVALID");
      const path = dshOperationPaths.decideClientOrderAdjustment.path.replace("{orderId}", encodeURIComponent(normalizedOrder)).replace("{adjustmentId}", encodeURIComponent(normalizedAdjustment));
      return userRequest<OrderResponse>(accessToken, path, dshOperationPaths.decideClientOrderAdjustment.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedOrderVersion) });
    },
    async readOrderConversation(accessToken: string, orderID: string, limit = 50): Promise<OrderConversationResponse> {
      const normalized = orderID.trim();
      if (!normalized || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_ORDER_CONVERSATION_INPUT_INVALID");
      const path = `${dshOperationPaths.readOrderConversation.path.replace("{orderId}", encodeURIComponent(normalized))}?${new URLSearchParams({ limit: String(limit) }).toString()}`;
      return userRequest<OrderConversationResponse>(accessToken, path, dshOperationPaths.readOrderConversation.method);
    },
    async sendOrderConversationMessage(accessToken: string, orderID: string, input: CreateOrderConversationMessageRequest, idempotencyKey: string, correlationID: string): Promise<OrderConversationMessageResponse> {
      const normalized = orderID.trim();
      const body = input.body.trim();
      if (!normalized || Array.from(body).length < 1 || Array.from(body).length > 2000) throw new Error("DSH_ORDER_CONVERSATION_BODY_INVALID");
      if (idempotencyKey.trim().length < 8 || idempotencyKey.trim().length > 128 || correlationID.trim().length < 8 || correlationID.trim().length > 128) throw new Error("DSH_ORDER_CONVERSATION_ATTEMPT_REQUIRED");
      const path = dshOperationPaths.sendOrderConversationMessage.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderConversationMessageResponse>(accessToken, path, dshOperationPaths.sendOrderConversationMessage.method, { body }, mutationHeaders(idempotencyKey, correlationID));
    },
    async markOrderConversationRead(accessToken: string, orderID: string, input: MarkOrderConversationReadRequest): Promise<OrderConversationReadResponse> {
      const normalized = orderID.trim();
      const messageID = input.messageId.trim();
      if (!normalized || !messageID) throw new Error("DSH_ORDER_CONVERSATION_READ_INPUT_INVALID");
      const path = dshOperationPaths.markOrderConversationRead.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderConversationReadResponse>(accessToken, path, dshOperationPaths.markOrderConversationRead.method, { messageId: messageID }, correlationHeaders());
    },
    async readClientDeliveryProof(accessToken: string, orderID: string): Promise<DeliveryProofResponse> {
      const normalized = orderID.trim();
      if (!normalized) throw new Error("DSH_ORDER_ID_REQUIRED");
      const path = dshOperationPaths.readClientDeliveryProof.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<DeliveryProofResponse>(accessToken, path, dshOperationPaths.readClientDeliveryProof.method);
    },
    async readClientOrderRating(accessToken: string, orderID: string): Promise<OrderRatingResponse> {
      const normalized = orderID.trim();
      if (!normalized) throw new Error("DSH_ORDER_ID_REQUIRED");
      const path = dshOperationPaths.readClientOrderRating.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderRatingResponse>(accessToken, path, dshOperationPaths.readClientOrderRating.method);
    },
    async createClientOrderRating(accessToken: string, orderID: string, input: CreateOrderRatingRequest, expectedVersion: number): Promise<OrderRatingResponse> {
      const normalized = orderID.trim();
      const review = input.review?.trim() ?? "";
      if (!normalized || !Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5 || review.length > 1000 || expectedVersion < 1) throw new Error("DSH_ORDER_RATING_INPUT_INVALID");
      const path = dshOperationPaths.createClientOrderRating.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderRatingResponse>(accessToken, path, dshOperationPaths.createClientOrderRating.method, { rating: input.rating, review }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async readClientOrderTracking(accessToken: string, orderID: string): Promise<OrderTrackingResponse> {
      const normalized = orderID.trim();
      if (!normalized) throw new Error("DSH_ORDER_ID_REQUIRED");
      const path = dshOperationPaths.readClientOrderTracking.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderTrackingResponse>(accessToken, path, dshOperationPaths.readClientOrderTracking.method);
    },
    async cancelClientOrder(accessToken: string, orderID: string, expectedVersion: number): Promise<OrderResponse> {
      const normalized = orderID.trim();
      if (!normalized || expectedVersion < 1) throw new Error("DSH_ORDER_CANCELLATION_INPUT_INVALID");
      const path = dshOperationPaths.cancelClientOrder.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderResponse>(accessToken, path, dshOperationPaths.cancelClientOrder.method, undefined, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listStoreOrders(accessToken: string, storeID: string, options: { limit?: number; state?: string; q?: string; cursor?: string } = {}): Promise<OrderListResponse> {
      const normalized = storeID.trim();
      const limit = options.limit ?? 50;
      if (!normalized || limit < 1 || limit > 100) throw new Error("DSH_ORDER_INPUT_INVALID");
      const query = new URLSearchParams({ limit: String(limit) });
      if (options.state) query.set("state", options.state);
      if (options.q) query.set("q", options.q);
      if (options.cursor) query.set("cursor", options.cursor);
      const path = `${dshOperationPaths.listStoreOrders.path.replace("{storeId}", encodeURIComponent(normalized))}?${query.toString()}`;
      return userRequest<OrderListResponse>(accessToken, path, dshOperationPaths.listStoreOrders.method);
    },
    async listPartnerOrders(accessToken: string, options: { storeIds?: ReadonlyArray<string>; limit?: number; state?: string; q?: string; cursor?: string } = {}): Promise<PartnerOrdersResponse> {
      const limit = options.limit ?? 50;
      if (limit < 1 || limit > 100) throw new Error("DSH_ORDER_INPUT_INVALID");
      const query = new URLSearchParams({ limit: String(limit) });
      if (options.storeIds && options.storeIds.length > 0) query.set("storeIds", options.storeIds.join(","));
      if (options.state) query.set("state", options.state);
      if (options.q) query.set("q", options.q);
      if (options.cursor) query.set("cursor", options.cursor);
      return userRequest<PartnerOrdersResponse>(accessToken, `${dshOperationPaths.listPartnerOrders.path}?${query.toString()}`, dshOperationPaths.listPartnerOrders.method);
    },
    async transitionStoreOrder(accessToken: string, storeID: string, orderID: string, input: OrderTransitionRequest, expectedVersion: number): Promise<OrderResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOrder = orderID.trim();
      if (!normalizedStore || !normalizedOrder || expectedVersion < 1) throw new Error("DSH_ORDER_INPUT_INVALID");
      const path = dshOperationPaths.transitionStoreOrder.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{orderId}", encodeURIComponent(normalizedOrder));
      return userRequest<OrderResponse>(accessToken, path, dshOperationPaths.transitionStoreOrder.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async proposePartnerOrderAdjustment(accessToken: string, storeID: string, orderID: string, input: OrderAdjustmentProposalRequest, expectedOrderVersion: number): Promise<OrderResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOrder = orderID.trim();
      const normalizedLine = input.orderLineId.trim();
      if (!normalizedStore || !normalizedOrder || !normalizedLine || expectedOrderVersion < 1 || (input.kind !== "REMOVE_ITEM" && input.kind !== "SET_ACTUAL_QUANTITY") || (input.kind === "REMOVE_ITEM" && input.actualQuantityBaseUnits !== undefined) || (input.kind === "SET_ACTUAL_QUANTITY" && (!Number.isSafeInteger(input.actualQuantityBaseUnits) || (input.actualQuantityBaseUnits ?? 0) < 1))) throw new Error("DSH_ORDER_ADJUSTMENT_PROPOSAL_INVALID");
      const path = dshOperationPaths.proposePartnerOrderAdjustment.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{orderId}", encodeURIComponent(normalizedOrder));
      return userRequest<OrderResponse>(accessToken, path, dshOperationPaths.proposePartnerOrderAdjustment.method, { ...input, orderLineId: normalizedLine }, { ...mutationHeaders(), "X-Expected-Version": String(expectedOrderVersion) });
    },
    async confirmPartnerCaptainCashHandoff(accessToken: string, storeID: string, orderID: string, expectedVersion: number): Promise<OrderResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOrder = orderID.trim();
      if (!normalizedStore || !normalizedOrder || !Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error("DSH_STORE_CAPTAIN_CASH_HANDOFF_INPUT_INVALID");
      const path = dshOperationPaths.confirmPartnerCaptainCashHandoff.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{orderId}", encodeURIComponent(normalizedOrder));
      return userRequest<OrderResponse>(accessToken, path, dshOperationPaths.confirmPartnerCaptainCashHandoff.method, undefined, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async readStoreCaptainAssignment(accessToken: string, storeID: string, orderID: string): Promise<CaptainAssignmentResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOrder = orderID.trim();
      if (!normalizedStore || !normalizedOrder) throw new Error("DSH_CAPTAIN_ASSIGNMENT_INPUT_INVALID");
      const path = dshOperationPaths.readStoreCaptainAssignment.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{orderId}", encodeURIComponent(normalizedOrder));
      return userRequest<CaptainAssignmentResponse>(accessToken, path, dshOperationPaths.readStoreCaptainAssignment.method);
    },
    async confirmCaptainStoreHandoff(accessToken: string, storeID: string, orderID: string, assignmentID: string, expectedVersion: number): Promise<CaptainAssignmentResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOrder = orderID.trim();
      const normalizedAssignment = assignmentID.trim();
      if (!normalizedStore || !normalizedOrder || !normalizedAssignment || expectedVersion < 1) throw new Error("DSH_CAPTAIN_HANDOFF_INPUT_INVALID");
      const path = dshOperationPaths.confirmCaptainStoreHandoff.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{orderId}", encodeURIComponent(normalizedOrder));
      return userRequest<CaptainAssignmentResponse>(accessToken, path, dshOperationPaths.confirmCaptainStoreHandoff.method, { assignmentId: normalizedAssignment }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listPartnerStoreCaptainMemberships(accessToken: string, storeID: string): Promise<StoreCaptainMembershipListResponse> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_CAPTAIN_MEMBERSHIP_STORE_REQUIRED");
      const path = dshOperationPaths.listPartnerStoreCaptainMemberships.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<StoreCaptainMembershipListResponse>(accessToken, path, dshOperationPaths.listPartnerStoreCaptainMemberships.method);
    },
    async createPartnerStoreCaptainInvitation(accessToken: string, storeID: string): Promise<StoreCaptainInvitationResponse> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_CAPTAIN_MEMBERSHIP_STORE_REQUIRED");
      const path = dshOperationPaths.createPartnerStoreCaptainInvitation.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<StoreCaptainInvitationResponse>(accessToken, path, dshOperationPaths.createPartnerStoreCaptainInvitation.method, undefined, mutationHeaders());
    },
    async transitionPartnerStoreCaptainMembership(accessToken: string, storeID: string, membershipID: string, input: StoreCaptainMembershipTransitionRequest, expectedVersion: number): Promise<StoreCaptainMembershipResponse> {
      const normalizedStore = storeID.trim();
      const normalizedMembership = membershipID.trim();
      if (!normalizedStore || !normalizedMembership || expectedVersion < 1 || !input.state) throw new Error("DSH_STORE_CAPTAIN_MEMBERSHIP_INPUT_INVALID");
      const path = dshOperationPaths.transitionPartnerStoreCaptainMembership.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{membershipId}", encodeURIComponent(normalizedMembership));
      return userRequest<StoreCaptainMembershipResponse>(accessToken, path, dshOperationPaths.transitionPartnerStoreCaptainMembership.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async readPartnerStoreCaptainDispatchOffer(accessToken: string, storeID: string, orderID: string): Promise<CaptainOfferResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOrder = orderID.trim();
      if (!normalizedStore || !normalizedOrder) throw new Error("DSH_STORE_CAPTAIN_DISPATCH_INPUT_INVALID");
      const path = dshOperationPaths.readPartnerStoreCaptainDispatchOffer.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{orderId}", encodeURIComponent(normalizedOrder));
      return userRequest<CaptainOfferResponse>(accessToken, path, dshOperationPaths.readPartnerStoreCaptainDispatchOffer.method);
    },
    async createPartnerStoreCaptainDispatchOffer(accessToken: string, storeID: string, orderID: string, input: StoreCaptainDispatchRequest, expectedOrderVersion: number): Promise<CaptainOfferResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOrder = orderID.trim();
      if (!normalizedStore || !normalizedOrder || !input.captainActorId.trim() || expectedOrderVersion < 1) throw new Error("DSH_STORE_CAPTAIN_DISPATCH_INPUT_INVALID");
      const path = dshOperationPaths.createPartnerStoreCaptainDispatchOffer.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{orderId}", encodeURIComponent(normalizedOrder));
      return userRequest<CaptainOfferResponse>(accessToken, path, dshOperationPaths.createPartnerStoreCaptainDispatchOffer.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedOrderVersion) });
    },
    async listOwnStoreCaptainMemberships(accessToken: string): Promise<StoreCaptainMembershipListResponse> {
      return userRequest<StoreCaptainMembershipListResponse>(accessToken, dshOperationPaths.listOwnStoreCaptainMemberships.path, dshOperationPaths.listOwnStoreCaptainMemberships.method);
    },
    async acceptOwnStoreCaptainInvitation(accessToken: string, invitationCode: string): Promise<StoreCaptainMembershipResponse> {
      const normalized = invitationCode.trim();
      if (!normalized) throw new Error("DSH_STORE_CAPTAIN_INVITATION_CODE_REQUIRED");
      const input: AcceptStoreCaptainInvitationRequest = { invitationCode: normalized };
      return userRequest<StoreCaptainMembershipResponse>(accessToken, dshOperationPaths.acceptOwnStoreCaptainInvitation.path, dshOperationPaths.acceptOwnStoreCaptainInvitation.method, input, mutationHeaders());
    },
    async readOwnCaptainAdmission(accessToken: string): Promise<CaptainAdmissionResponse> {
      return userRequest<CaptainAdmissionResponse>(accessToken, dshOperationPaths.readOwnCaptainAdmission.path, dshOperationPaths.readOwnCaptainAdmission.method);
    },
    async setCaptainAvailability(accessToken: string, available: boolean, expectedVersion: number): Promise<CaptainAdmissionResponse> {
      if (expectedVersion < 1) throw new Error("DSH_CAPTAIN_VERSION_INVALID");
      const input: CaptainAvailabilityRequest = { available };
      return userRequest<CaptainAdmissionResponse>(accessToken, dshOperationPaths.setCaptainAvailability.path, dshOperationPaths.setCaptainAvailability.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listOwnCaptainOffers(accessToken: string, limit = 50): Promise<CaptainOfferListResponse> {
      if (limit < 1 || limit > 100) throw new Error("DSH_CAPTAIN_LIMIT_INVALID");
      return userRequest<CaptainOfferListResponse>(accessToken, `${dshOperationPaths.listOwnCaptainOffers.path}?${new URLSearchParams({ limit: String(limit) }).toString()}`, dshOperationPaths.listOwnCaptainOffers.method);
    },
    async respondToCaptainOffer(accessToken: string, offerID: string, input: CaptainOfferDecisionRequest, expectedVersion: number): Promise<CaptainOfferResponse> {
      const normalized = offerID.trim();
      if (!normalized || expectedVersion < 1 || !input.decision) throw new Error("DSH_CAPTAIN_OFFER_INPUT_INVALID");
      const path = dshOperationPaths.respondToCaptainOffer.path.replace("{offerId}", encodeURIComponent(normalized));
      return userRequest<CaptainOfferResponse>(accessToken, path, dshOperationPaths.respondToCaptainOffer.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listOwnCaptainAssignments(accessToken: string, limit = 50): Promise<CaptainAssignmentListResponse> {
      if (limit < 1 || limit > 100) throw new Error("DSH_CAPTAIN_LIMIT_INVALID");
      return userRequest<CaptainAssignmentListResponse>(accessToken, `${dshOperationPaths.listOwnCaptainAssignments.path}?${new URLSearchParams({ limit: String(limit) }).toString()}`, dshOperationPaths.listOwnCaptainAssignments.method);
    },
    async readOwnCaptainCashLiability(accessToken: string): Promise<CashLiabilityResponse> {
      return userRequest<CashLiabilityResponse>(accessToken, dshOperationPaths.readOwnCaptainCashLiability.path, dshOperationPaths.readOwnCaptainCashLiability.method);
    },
    async remitOwnCaptainCash(accessToken: string, paymentIntentID: string, input: CaptainCashRemittanceRequest, expectedPaymentVersion: number): Promise<CaptainCashRemittanceResponse> {
      const normalized = paymentIntentID.trim();
      const remittanceReference = input.remittanceReference.trim();
      if (!normalized || expectedPaymentVersion < 1 || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || remittanceReference.length < 1 || remittanceReference.length > 128) throw new Error("DSH_CAPTAIN_CASH_REMITTANCE_INPUT_INVALID");
      const path = dshOperationPaths.remitOwnCaptainCash.path.replace("{paymentIntentId}", encodeURIComponent(normalized));
      return userRequest<CaptainCashRemittanceResponse>(accessToken, path, dshOperationPaths.remitOwnCaptainCash.method, { amountMinor: input.amountMinor, remittanceReference }, { ...mutationHeaders(), "X-Expected-Version": String(expectedPaymentVersion) });
    },
    async readOwnCaptainDeliveryTask(accessToken: string, assignmentID: string): Promise<CaptainDeliveryTaskResponse> {
      const normalized = assignmentID.trim();
      if (!normalized) throw new Error("DSH_CAPTAIN_ASSIGNMENT_INPUT_INVALID");
      const path = dshOperationPaths.readOwnCaptainDeliveryTask.path.replace("{assignmentId}", encodeURIComponent(normalized));
      return userRequest<CaptainDeliveryTaskResponse>(accessToken, path, dshOperationPaths.readOwnCaptainDeliveryTask.method);
    },
    async updateCaptainLocation(accessToken: string, assignmentID: string, latitude: number, longitude: number): Promise<CaptainLocationResponse> {
      const normalized = assignmentID.trim();
      if (!normalized) throw new Error("DSH_CAPTAIN_ASSIGNMENT_INPUT_INVALID");
      assertCoordinates(latitude, longitude);
      const path = dshOperationPaths.updateCaptainLocation.path.replace("{assignmentId}", encodeURIComponent(normalized));
      return userRequest<CaptainLocationResponse>(accessToken, path, dshOperationPaths.updateCaptainLocation.method, { latitude, longitude }, mutationHeaders());
    },
    async completeCaptainPickup(accessToken: string, assignmentID: string, expectedVersion: number): Promise<CaptainAssignmentResponse> {
      const normalized = assignmentID.trim();
      if (!normalized || expectedVersion < 1) throw new Error("DSH_CAPTAIN_ASSIGNMENT_INPUT_INVALID");
      const path = dshOperationPaths.completeCaptainPickup.path.replace("{assignmentId}", encodeURIComponent(normalized));
      return userRequest<CaptainAssignmentResponse>(accessToken, path, dshOperationPaths.completeCaptainPickup.method, undefined, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async completeCaptainAssignment(accessToken: string, assignmentID: string, input: CaptainCompletionRequest, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<CaptainAssignmentResponse> {
      const normalized = assignmentID.trim();
      if (!normalized || expectedVersion < 1 || !input.result) throw new Error("DSH_CAPTAIN_ASSIGNMENT_INPUT_INVALID");
      if (input.result === "delivered" && !/^[0-9]{6}$/.test(input.deliveryProofCode?.trim() ?? "")) throw new Error("DSH_DELIVERY_PROOF_REQUIRED");
      if (input.result === "delivery_failed" && input.deliveryProofCode?.trim()) throw new Error("DSH_DELIVERY_PROOF_NOT_ALLOWED");
      const path = dshOperationPaths.completeCaptainAssignment.path.replace("{assignmentId}", encodeURIComponent(normalized));
      return userRequest<CaptainAssignmentResponse>(accessToken, path, dshOperationPaths.completeCaptainAssignment.method, { ...input, ...(input.deliveryProofCode === undefined ? {} : { deliveryProofCode: input.deliveryProofCode.trim() }) }, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
    },
    async readOwnFieldAdmission(accessToken: string): Promise<FieldAdmissionResponse> {
      return userRequest<FieldAdmissionResponse>(accessToken, dshOperationPaths.readOwnFieldAdmission.path, dshOperationPaths.readOwnFieldAdmission.method);
    },
    async listOwnFieldJoiningCases(accessToken: string, limit = 25, queryText = "", cursor = ""): Promise<JoiningCaseListResponse> {
      const normalizedQuery = queryText.trim();
      const normalizedCursor = cursor.trim();
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || Array.from(normalizedQuery).length > 128 || normalizedCursor.length > 2048) throw new Error("DSH_FIELD_JOINING_CASE_PAGE_INVALID");
      const params = new URLSearchParams({ limit: String(limit) });
      if (normalizedQuery) params.set("q", normalizedQuery);
      if (normalizedCursor) params.set("cursor", normalizedCursor);
      const path = `${dshOperationPaths.listOwnFieldJoiningCases.path}?${params.toString()}`;
      return userRequest<JoiningCaseListResponse>(accessToken, path, dshOperationPaths.listOwnFieldJoiningCases.method);
    },
    async readFieldJoiningCaseCatalog(accessToken: string, caseID: string, limit = 50, query = "", cursor = ""): Promise<FieldCatalogReadResponse> {
      const normalized = caseID.trim();
      const normalizedQuery = query.trim();
      const normalizedCursor = cursor.trim();
      if (!normalized || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || Array.from(normalizedQuery).length > 160 || normalizedCursor.length > 2048) throw new Error("DSH_FIELD_CATALOG_PAGE_INVALID");
      const params = new URLSearchParams({ limit: String(limit) });
      if (normalizedQuery) params.set("q", normalizedQuery);
      if (normalizedCursor) params.set("cursor", normalizedCursor);
      const path = `${dshOperationPaths.readFieldJoiningCaseCatalog.path.replace("{caseId}", encodeURIComponent(normalized))}?${params.toString()}`;
      return userRequest<FieldCatalogReadResponse>(accessToken, path, dshOperationPaths.readFieldJoiningCaseCatalog.method);
    },
    async listFieldCatalogProductProposals(accessToken: string, caseID: string, state: "" | CatalogProductProposal["state"] = "", limit = 50, cursor = ""): Promise<CatalogProductProposalListResponse> {
      const joiningCase = caseID.trim();
      const normalizedCursor = cursor.trim();
      if (!joiningCase || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || normalizedCursor.length > 2048) throw new Error("DSH_FIELD_CATALOG_PROPOSAL_PAGE_INVALID");
      const params = new URLSearchParams({ limit: String(limit) });
      if (state) params.set("state", state);
      if (normalizedCursor) params.set("cursor", normalizedCursor);
      const path = `${dshOperationPaths.listFieldCatalogProductProposals.path.replace("{caseId}", encodeURIComponent(joiningCase))}?${params.toString()}`;
      return userRequest<CatalogProductProposalListResponse>(accessToken, path, dshOperationPaths.listFieldCatalogProductProposals.method);
    },
    async createFieldCatalogProductProposal(accessToken: string, caseID: string, input: CreateCatalogProductProposalRequest, idempotencyKey?: string, correlationID?: string): Promise<CatalogProductProposalResponse> {
      const joiningCase = caseID.trim();
      const identifierType = input.proposedIdentifierType ?? "";
      const identifierValue = input.proposedIdentifierValue?.trim() ?? "";
      if (!joiningCase || !input.id.trim() || !input.verticalId.trim() || !input.categoryId.trim() || !input.proposedName.trim() || !input.proposedVariantTitle.trim() || identifierType === "SKU" || (identifierValue !== "" && !identifierType)) throw new Error("DSH_FIELD_CATALOG_PROPOSAL_INPUT_INVALID");
      const path = dshOperationPaths.createFieldCatalogProductProposal.path.replace("{caseId}", encodeURIComponent(joiningCase));
      return userRequest<CatalogProductProposalResponse>(accessToken, path, dshOperationPaths.createFieldCatalogProductProposal.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async updateFieldCatalogProductProposal(accessToken: string, caseID: string, proposalID: string, input: UpdateCatalogProductProposalRequest, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<CatalogProductProposalResponse> {
      const joiningCase = caseID.trim();
      const proposal = proposalID.trim();
      const identifierType = input.proposedIdentifierType ?? "";
      const identifierValue = input.proposedIdentifierValue?.trim() ?? "";
      if (!joiningCase || !proposal || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !input.verticalId.trim() || !input.categoryId.trim() || !input.proposedName.trim() || !input.proposedVariantTitle.trim() || identifierType === "SKU" || (identifierValue !== "" && !identifierType)) throw new Error("DSH_FIELD_CATALOG_PROPOSAL_INPUT_INVALID");
      const path = dshOperationPaths.updateFieldCatalogProductProposal.path.replace("{caseId}", encodeURIComponent(joiningCase)).replace("{proposalId}", encodeURIComponent(proposal));
      return userRequest<CatalogProductProposalResponse>(accessToken, path, dshOperationPaths.updateFieldCatalogProductProposal.method, input, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
    },
    async submitFieldCatalogProductProposal(accessToken: string, caseID: string, proposalID: string, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<CatalogProductProposalResponse> {
      const joiningCase = caseID.trim();
      const proposal = proposalID.trim();
      if (!joiningCase || !proposal || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("DSH_FIELD_CATALOG_PROPOSAL_INPUT_INVALID");
      const path = dshOperationPaths.submitFieldCatalogProductProposal.path.replace("{caseId}", encodeURIComponent(joiningCase)).replace("{proposalId}", encodeURIComponent(proposal));
      return userRequest<CatalogProductProposalResponse>(accessToken, path, dshOperationPaths.submitFieldCatalogProductProposal.method, undefined, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
    },
    async previewFieldStoreCatalogImport(accessToken: string, caseID: string, input: DshCatalogImportFileInput, idempotencyKey?: string, correlationID?: string): Promise<CatalogImportPreviewResponse> {
      const normalizedCase = caseID.trim();
      if (!normalizedCase || !input.uri.trim() || !validStoreCatalogImportName(input.name)) throw new Error("DSH_FIELD_CATALOG_IMPORT_FILE_INVALID");
      const path = dshOperationPaths.previewFieldStoreCatalogImport.path.replace("{caseId}", encodeURIComponent(normalizedCase));
      const type = input.type?.trim() || storeCatalogImportMimeType(input.name);
      const form = input.nativeMultipartUpload ? undefined : new FormData();
      if (form) form.append("file", input.blob ?? ({ uri: input.uri.trim(), name: input.name.trim(), type } as unknown as Blob));
      return userMultipartRequest(accessToken, path, dshOperationPaths.previewFieldStoreCatalogImport.method, form, mutationHeaders(idempotencyKey, correlationID), input.nativeMultipartUpload, { fieldName: "file", fileName: input.name.trim(), mimeType: type, parameters: {} });
    },
    async readFieldStoreCatalogImport(accessToken: string, caseID: string, runID: string): Promise<CatalogImportRunResponse> {
      const joiningCase = caseID.trim();
      const run = runID.trim();
      if (!joiningCase || !run) throw new Error("DSH_FIELD_CATALOG_IMPORT_SCOPE_INVALID");
      const path = dshOperationPaths.readFieldStoreCatalogImport.path.replace("{caseId}", encodeURIComponent(joiningCase)).replace("{runId}", encodeURIComponent(run));
      return userRequest<CatalogImportRunResponse>(accessToken, path, dshOperationPaths.readFieldStoreCatalogImport.method);
    },
    async commitFieldStoreCatalogImport(accessToken: string, caseID: string, runID: string, idempotencyKey?: string, correlationID?: string): Promise<CatalogImportCommitResponse> {
      const joiningCase = caseID.trim();
      const run = runID.trim();
      if (!joiningCase || !run) throw new Error("DSH_FIELD_CATALOG_IMPORT_SCOPE_INVALID");
      const path = dshOperationPaths.commitFieldStoreCatalogImport.path.replace("{caseId}", encodeURIComponent(joiningCase)).replace("{runId}", encodeURIComponent(run));
      return userRequest<CatalogImportCommitResponse>(accessToken, path, dshOperationPaths.commitFieldStoreCatalogImport.method, undefined, mutationHeaders(idempotencyKey, correlationID));
    },
    async resolveFieldCatalogIdentifier(accessToken: string, caseID: string, identifierValue: string): Promise<CatalogIdentifierResolveResponse> {
      const normalizedCase = caseID.trim();
      const normalizedIdentifier = identifierValue.trim();
      if (!normalizedCase || !normalizedIdentifier || normalizedIdentifier.length > 128) throw new Error("DSH_FIELD_CATALOG_IDENTIFIER_INVALID");
      return userRequest<CatalogIdentifierResolveResponse>(accessToken, dshOperationPaths.resolveFieldCatalogIdentifier.path, dshOperationPaths.resolveFieldCatalogIdentifier.method, { joiningCaseId: normalizedCase, identifierValue: normalizedIdentifier });
    },
    async listFieldQuickPrices(accessToken: string, caseID: string, filters: Readonly<{ q?: string; categoryId?: string; availability?: "all" | "available" | "unavailable"; publicationState?: "all" | "draft" | "published" | "hidden"; limit?: number; cursor?: string }> = {}): Promise<CatalogStoreOfferListResponse> {
      const normalized = caseID.trim();
      if (!normalized) throw new Error("DSH_JOINING_CASE_ID_REQUIRED");
      const limit = filters.limit ?? 50;
      const cursor = filters.cursor?.trim() ?? "";
      if (Number.isSafeInteger(limit) === false || limit < 1 || limit > 100 || cursor.length > 2048 || (filters.q?.trim().length ?? 0) > 160 || (filters.categoryId?.trim().length ?? 0) > 128) throw new Error("DSH_QUICK_PRICE_FILTER_INVALID");
      const params = new URLSearchParams({ limit: String(limit) });
      if (filters.q?.trim()) params.set("q", filters.q.trim());
      if (filters.categoryId) params.set("categoryId", filters.categoryId.trim());
      if (filters.availability) params.set("availability", filters.availability);
      if (filters.publicationState) params.set("publicationState", filters.publicationState);
      if (cursor) params.set("cursor", cursor);
      const path = `${dshOperationPaths.listFieldQuickPrices.path.replace("{caseId}", encodeURIComponent(normalized))}?${params.toString()}`;
      return userRequest<CatalogStoreOfferListResponse>(accessToken, path, dshOperationPaths.listFieldQuickPrices.method);
    },
    async commitFieldQuickPrices(accessToken: string, caseID: string, input: CatalogQuickPriceCommitRequest, idempotencyKey?: string, correlationID?: string): Promise<CatalogQuickPriceCommitResponse> {
      const normalized = caseID.trim();
      if (!normalized || input.items.length < 1 || input.items.length > 100 || input.items.some((item) => !item.offerId.trim() || !Number.isSafeInteger(item.expectedVersion) || item.expectedVersion < 1 || !Number.isSafeInteger(item.priceMinor) || item.priceMinor < 1)) throw new Error("DSH_QUICK_PRICE_UPDATE_INVALID");
      const path = dshOperationPaths.commitFieldQuickPrices.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<CatalogQuickPriceCommitResponse>(accessToken, path, dshOperationPaths.commitFieldQuickPrices.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async resolveOwnStoreCatalogIdentifier(accessToken: string, storeID: string, identifierValue: string): Promise<CatalogIdentifierResolveResponse> {
      const normalizedStore = storeID.trim();
      const normalizedIdentifier = identifierValue.trim();
      if (!normalizedStore || !normalizedIdentifier || normalizedIdentifier.length > 128) throw new Error("DSH_STORE_CATALOG_IDENTIFIER_INVALID");
      return userRequest<CatalogIdentifierResolveResponse>(accessToken, dshOperationPaths.resolveCatalogIdentifier.path, dshOperationPaths.resolveCatalogIdentifier.method, { storeId: normalizedStore, identifierValue: normalizedIdentifier });
    },
    async createFieldCatalogProduct(accessToken: string, caseID: string, input: CreateFieldCatalogProductRequest, idempotencyKey?: string, correlationID?: string): Promise<CatalogProductResponse> {
      const normalizedCase = caseID.trim();
      const canonicalName = input.canonicalName.trim();
      const variantTitle = input.variantTitle.trim();
      const identifierValue = input.identifierValue?.trim() ?? "";
      if (!normalizedCase || !canonicalName || Array.from(canonicalName).length > 160 || !variantTitle || Array.from(variantTitle).length > 160 || (identifierValue.length > 0 && (!input.identifierType || identifierValue.length > 128))) throw new Error("DSH_FIELD_CATALOG_PRODUCT_INVALID");
      const path = dshOperationPaths.createFieldInitialCatalogProduct.path.replace("{caseId}", encodeURIComponent(normalizedCase));
      return userRequest<CatalogProductResponse>(accessToken, path, dshOperationPaths.createFieldInitialCatalogProduct.method, { ...input, canonicalName, variantTitle, ...(identifierValue ? { identifierValue } : {}) }, mutationHeaders(idempotencyKey, correlationID));
    },
    async createFieldCatalogOffer(accessToken: string, caseID: string, input: CreateStoreOfferRequest, idempotencyKey?: string, correlationID?: string): Promise<CatalogStoreOfferResponse> {
      const normalizedCase = caseID.trim();
      if (!normalizedCase || !input.variantId.trim() || !Number.isSafeInteger(input.priceMinor) || input.priceMinor < 1 || ![input.quantityMinBaseUnits, input.quantityMaxBaseUnits, input.quantityStepBaseUnits, input.pricingUnitBaseUnits, input.inventoryOnHandBaseUnits].every(Number.isSafeInteger) || input.quantityMinBaseUnits < 1 || input.quantityMaxBaseUnits < input.quantityMinBaseUnits || input.quantityStepBaseUnits < 1 || input.pricingUnitBaseUnits < 1 || input.inventoryOnHandBaseUnits < 0) throw new Error("DSH_FIELD_CATALOG_OFFER_INVALID");
      const path = dshOperationPaths.createFieldInitialCatalogOffer.path.replace("{caseId}", encodeURIComponent(normalizedCase));
      return userRequest<CatalogStoreOfferResponse>(accessToken, path, dshOperationPaths.createFieldInitialCatalogOffer.method, input, mutationHeaders(idempotencyKey, correlationID));
    },
    async updateFieldInitialCatalogOffer(accessToken: string, caseID: string, offerID: string, input: UpdateStoreOfferRequest, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<CatalogStoreOfferResponse> {
      const normalizedCase = caseID.trim();
      const normalizedOffer = offerID.trim();
      if (!normalizedCase || !normalizedOffer || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !Number.isSafeInteger(input.priceMinor) || input.priceMinor < 1 || ![input.quantityMinBaseUnits, input.quantityMaxBaseUnits, input.quantityStepBaseUnits, input.pricingUnitBaseUnits, input.inventoryOnHandBaseUnits].every(Number.isSafeInteger)) throw new Error("DSH_FIELD_CATALOG_OFFER_INVALID");
      const path = dshOperationPaths.updateFieldInitialCatalogOffer.path.replace("{caseId}", encodeURIComponent(normalizedCase)).replace("{offerId}", encodeURIComponent(normalizedOffer));
      return userRequest<CatalogStoreOfferResponse>(accessToken, path, dshOperationPaths.updateFieldInitialCatalogOffer.method, input, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
    },
    async createFieldJoiningCase(accessToken: string, input: CreateJoiningCaseRequest, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
      const contactPhoneE164 = input.contactPhoneE164.trim();
      const businessName = input.businessName.trim();
      const firstStoreName = input.firstStoreName.trim();
      const serviceCityId = input.serviceCityId.trim();
      const firstStoreVerticalId = input.firstStoreVerticalId.trim();
      const firstStoreCommercialTypeId = input.firstStoreCommercialTypeId.trim();
      if (!/^\+[1-9]\d{7,14}$/.test(contactPhoneE164) || businessName.length < 2 || businessName.length > 160 || firstStoreName.length < 2 || firstStoreName.length > 160 || !serviceCityId || !firstStoreVerticalId || !firstStoreCommercialTypeId || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude) || input.firstStoreLatitude < -90 || input.firstStoreLatitude > 90 || input.firstStoreLongitude < -180 || input.firstStoreLongitude > 180) throw new Error("DSH_FIELD_JOINING_CASE_INPUT_INVALID");
      return userRequest<JoiningCaseResponse>(accessToken, dshOperationPaths.createFieldJoiningCase.path, dshOperationPaths.createFieldJoiningCase.method, { ...input, contactPhoneE164, businessName, firstStoreName, serviceCityId, firstStoreVerticalId, firstStoreCommercialTypeId }, mutationHeaders(idempotencyKey, correlationID));
    },
    async readOwnFieldJoiningCase(accessToken: string, caseID: string): Promise<JoiningCaseResponse> {
      const normalized = caseID.trim();
      if (!normalized) throw new Error("DSH_FIELD_JOINING_CASE_ID_REQUIRED");
      const path = dshOperationPaths.readOwnFieldJoiningCase.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<JoiningCaseResponse>(accessToken, path, dshOperationPaths.readOwnFieldJoiningCase.method);
    },
    async submitFieldJoiningCase(accessToken: string, caseID: string, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
      const normalized = caseID.trim();
      if (!normalized || expectedVersion < 1) throw new Error("DSH_FIELD_JOINING_CASE_INPUT_INVALID");
      const path = dshOperationPaths.submitFieldJoiningCase.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<JoiningCaseResponse>(accessToken, path, dshOperationPaths.submitFieldJoiningCase.method, undefined, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
    },
    async uploadJoiningCaseStoreImage(accessToken: string, caseID: string, input: DshImageUploadInput, provenance: MediaProvenanceInput, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
      const normalized = caseID.trim();
      const uri = input.uri.trim();
      if (!normalized || !uri || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_STORE_IMAGE_INPUT_INVALID");
      if (!isMediaProvenanceInputValid(provenance)) throw new Error("DSH_MEDIA_PROVENANCE_INVALID");
      const fileName = input.name?.trim() || "store-image.jpg";
      const mimeType = input.type?.trim() || "image/jpeg";
      const form = input.nativeMultipartUpload ? undefined : new FormData();
      if (form) {
        form.append("file", input.blob ?? ({ uri, name: fileName, type: mimeType } as unknown as Blob));
        appendMediaProvenance(form, provenance);
      }
      const path = dshOperationPaths.uploadJoiningCaseStoreImage.path.replace("{caseId}", encodeURIComponent(normalized));
      return userMultipartRequest(accessToken, path, dshOperationPaths.uploadJoiningCaseStoreImage.method, form, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) }, input.nativeMultipartUpload, { fieldName: "file", fileName, mimeType, parameters: mediaProvenanceParameters(provenance) });
    },
    async uploadJoiningCaseProofImage(accessToken: string, caseID: string, input: DshImageUploadInput, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
      return uploadPrivateJoiningCaseProofImage(accessToken, dshOperationPaths.uploadJoiningCaseProofImage.path, dshOperationPaths.uploadJoiningCaseProofImage.method, caseID, input, expectedVersion, idempotencyKey, correlationID);
    },
    async uploadFieldJoiningCaseProofImage(accessToken: string, caseID: string, input: DshImageUploadInput, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
      return uploadPrivateJoiningCaseProofImage(accessToken, dshOperationPaths.uploadFieldJoiningCaseProofImage.path, dshOperationPaths.uploadFieldJoiningCaseProofImage.method, caseID, input, expectedVersion, idempotencyKey, correlationID);
    },
    async listOwnDeliveryAddresses(accessToken: string, limit = 50, cursor = ""): Promise<DeliveryAddressListResponse> {
      if (limit < 1 || limit > 50) throw new Error("DSH_ADDRESS_LIMIT_INVALID");
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor.trim()) params.set("cursor", cursor.trim());
      return userRequest<DeliveryAddressListResponse>(accessToken, `${dshOperationPaths.listOwnDeliveryAddresses.path}?${params.toString()}`, dshOperationPaths.listOwnDeliveryAddresses.method);
    },
    async readOwnDeliveryAddress(accessToken: string, addressID: string): Promise<DeliveryAddressResponse> {
      const normalized = addressID.trim();
      if (!normalized) throw new Error("DSH_ADDRESS_ID_REQUIRED");
      const path = dshOperationPaths.readOwnDeliveryAddress.path.replace("{addressId}", encodeURIComponent(normalized));
      return userRequest<DeliveryAddressResponse>(accessToken, path, dshOperationPaths.readOwnDeliveryAddress.method);
    },
    async createOwnDeliveryAddress(accessToken: string, input: CreateDeliveryAddressRequest): Promise<DeliveryAddressResponse> {
      const addressText = input.addressText.trim();
      assertCoordinates(input.latitude, input.longitude);
      if (addressText.length < 3 || addressText.length > 500) throw new Error("DSH_ADDRESS_INPUT_INVALID");
      const serviceCityId = input.serviceCityId.trim();
      if (!serviceCityId) throw new Error("DSH_ADDRESS_INPUT_INVALID");
      return userRequest<DeliveryAddressResponse>(accessToken, dshOperationPaths.createOwnDeliveryAddress.path, dshOperationPaths.createOwnDeliveryAddress.method, { addressText, latitude: input.latitude, longitude: input.longitude, serviceCityId }, mutationHeaders());
    },
    async updateOwnDeliveryAddress(accessToken: string, addressID: string, input: UpdateDeliveryAddressRequest, expectedVersion: number): Promise<DeliveryAddressResponse> {
      const normalized = addressID.trim();
      const addressText = input.addressText.trim();
      const serviceCityId = input.serviceCityId.trim();
      assertCoordinates(input.latitude, input.longitude);
      if (!normalized || addressText.length < 3 || addressText.length > 500 || !serviceCityId || expectedVersion < 1) throw new Error("DSH_ADDRESS_INPUT_INVALID");
      const path = dshOperationPaths.updateOwnDeliveryAddress.path.replace("{addressId}", encodeURIComponent(normalized));
      return userRequest<DeliveryAddressResponse>(accessToken, path, dshOperationPaths.updateOwnDeliveryAddress.method, { addressText, latitude: input.latitude, longitude: input.longitude, serviceCityId }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async readStoreDeliveryOrigin(accessToken: string, storeID: string): Promise<StoreDeliveryOriginResponse> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = dshOperationPaths.readStoreDeliveryOrigin.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<StoreDeliveryOriginResponse>(accessToken, path, dshOperationPaths.readStoreDeliveryOrigin.method);
    },
    async setStoreFulfillmentModes(accessToken: string, storeID: string, input: SetStoreFulfillmentModesRequest, expectedVersion: number): Promise<StoreFulfillmentModesResponse> {
      const normalizedStore = storeID.trim();
      const fulfillmentModes = Array.from(input.fulfillmentModes);
      if (!normalizedStore || expectedVersion < 1 || fulfillmentModes.length < 1 || fulfillmentModes.length > 2 || new Set(fulfillmentModes).size !== fulfillmentModes.length || fulfillmentModes.some((mode) => mode !== "BTHWANI_CAPTAIN" && mode !== "CUSTOMER_PICKUP")) throw new Error("DSH_STORE_FULFILLMENT_MODES_INVALID");
      const path = dshOperationPaths.setStoreFulfillmentModes.path.replace("{storeId}", encodeURIComponent(normalizedStore));
      return userRequest<StoreFulfillmentModesResponse>(accessToken, path, dshOperationPaths.setStoreFulfillmentModes.method, { fulfillmentModes }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listActiveServiceCities(): Promise<ReadonlyArray<ServiceCity>> {
      return (await publicRequest<ServiceCityListResponse>(dshOperationPaths.listActiveServiceCities.path)).cities;
    },
    async listClientFavoriteStores(accessToken: string): Promise<FavoriteStoreListResponse> {
      return userRequest<FavoriteStoreListResponse>(accessToken, dshOperationPaths.listClientFavoriteStores.path, dshOperationPaths.listClientFavoriteStores.method);
    },
    async listClientFavoriteStoreOffers(accessToken: string, storeID: string): Promise<FavoriteStoreOfferListResponse> {
      const normalizedStore = storeID.trim();
      if (!normalizedStore) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = `${dshOperationPaths.listClientFavoriteStoreOffers.path}?${new URLSearchParams({ storeId: normalizedStore }).toString()}`;
      return userRequest<FavoriteStoreOfferListResponse>(accessToken, path, dshOperationPaths.listClientFavoriteStoreOffers.method);
    },
    async addClientFavoriteStoreOffer(accessToken: string, storeOfferID: string): Promise<FavoriteStoreOfferResponse> {
      const normalizedOffer = storeOfferID.trim();
      if (!normalizedOffer) throw new Error("DSH_STORE_OFFER_ID_REQUIRED");
      const path = dshOperationPaths.addClientFavoriteStoreOffer.path.replace("{storeOfferId}", encodeURIComponent(normalizedOffer));
      return userRequest<FavoriteStoreOfferResponse>(accessToken, path, dshOperationPaths.addClientFavoriteStoreOffer.method, undefined, mutationHeaders());
    },
    async removeClientFavoriteStoreOffer(accessToken: string, storeOfferID: string): Promise<FavoriteStoreOfferResponse> {
      const normalizedOffer = storeOfferID.trim();
      if (!normalizedOffer) throw new Error("DSH_STORE_OFFER_ID_REQUIRED");
      const path = dshOperationPaths.removeClientFavoriteStoreOffer.path.replace("{storeOfferId}", encodeURIComponent(normalizedOffer));
      return userRequest<FavoriteStoreOfferResponse>(accessToken, path, dshOperationPaths.removeClientFavoriteStoreOffer.method, undefined, mutationHeaders());
    },
    async readClientFavoriteStoreCatalog(accessToken: string, storeID: string, serviceCityID: string, limit = 20, cursor = ""): Promise<PublicCatalogResponse> {
      const normalizedStore = storeID.trim();
      const normalizedCity = serviceCityID.trim();
      const normalizedCursor = cursor.trim();
      if (!normalizedStore || !normalizedCity || !Number.isInteger(limit) || limit < 1 || limit > 100 || normalizedCursor.length > 1024) throw new Error("DSH_FAVORITE_STORE_CATALOG_INPUT_INVALID");
      const params = new URLSearchParams({ storeId: normalizedStore, serviceCityId: normalizedCity, limit: String(limit) });
      if (normalizedCursor) params.set("cursor", normalizedCursor);
      const path = `${dshOperationPaths.readClientFavoriteStoreCatalog.path}?${params.toString()}`;
      return userRequest<PublicCatalogResponse>(accessToken, path, dshOperationPaths.readClientFavoriteStoreCatalog.method);
    },
    async addClientFavoriteStore(accessToken: string, storeID: string): Promise<FavoriteStoreResponse> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = dshOperationPaths.addClientFavoriteStore.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<FavoriteStoreResponse>(accessToken, path, dshOperationPaths.addClientFavoriteStore.method, undefined, mutationHeaders());
    },
    async removeClientFavoriteStore(accessToken: string, storeID: string): Promise<FavoriteStoreResponse> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = dshOperationPaths.removeClientFavoriteStore.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<FavoriteStoreResponse>(accessToken, path, dshOperationPaths.removeClientFavoriteStore.method, undefined, mutationHeaders());
    },
    async listPublishedStores(serviceCityID: string, options: Readonly<{
      q?: string;
      verticalId?: string;
      categoryId?: string;
      favoritesOnly?: boolean;
      accessToken?: string;
      sort?: "all" | "newest" | "nearest";
      limit?: number;
      cursor?: string;
      location?: Readonly<{ latitude: number; longitude: number }> | undefined;
    }> = {}): Promise<PublishedStoreListResponse> {
      const normalizedCity = serviceCityID.trim();
      if (!normalizedCity) throw new Error("DSH_SERVICE_CITY_REQUIRED");
      const limit = options.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("DSH_PUBLIC_STORE_LIMIT_INVALID");
      const params = new URLSearchParams({ serviceCityId: normalizedCity, sort: options.sort ?? "all", limit: String(limit) });
      const query = options.q?.trim() ?? "";
      const verticalID = options.verticalId?.trim() ?? "";
      const categoryID = options.categoryId?.trim() ?? "";
      const cursor = options.cursor?.trim() ?? "";
      const favoritesOnly = options.favoritesOnly === true;
      if (query) params.set("q", query);
      if (verticalID) params.set("verticalId", verticalID);
      if (categoryID) params.set("categoryId", categoryID);
      if (favoritesOnly) params.set("favoritesOnly", "true");
      if (cursor) params.set("cursor", cursor);
      if (options.location) {
        assertCoordinates(options.location.latitude, options.location.longitude);
        params.set("latitude", String(options.location.latitude));
        params.set("longitude", String(options.location.longitude));
      }
      const path = `${dshOperationPaths.listPublishedStores.path}?${params.toString()}`;
      if (favoritesOnly) return userRequest<PublishedStoreListResponse>(options.accessToken ?? "", path, "GET");
      return publicRequest<PublishedStoreListResponse>(path);
    },
    async listPublicPromotions(serviceCityID: string, storeID = ""): Promise<PromotionListResponse> {
      const normalizedCity = serviceCityID.trim();
      const normalizedStore = storeID.trim();
      if (!normalizedCity) throw new Error("DSH_SERVICE_CITY_REQUIRED");
      const params = new URLSearchParams({ serviceCityId: normalizedCity });
      if (normalizedStore) params.set("storeId", normalizedStore);
      return publicRequest<PromotionListResponse>(`${dshOperationPaths.listPublicPromotions.path}?${params.toString()}`);
    },
    async listPublicDiscoveryContent(serviceCityID: string): Promise<DiscoveryContentListResponse> {
      const normalizedCity = serviceCityID.trim();
      if (!normalizedCity) throw new Error("DSH_SERVICE_CITY_REQUIRED");
      return publicRequest<DiscoveryContentListResponse>(`${dshOperationPaths.listPublicDiscoveryContent.path}?${new URLSearchParams({ serviceCityId: normalizedCity }).toString()}`);
    },
    async resolvePublicDiscoveryContentTarget(contentID: string, serviceCityID: string): Promise<DiscoveryContentTargetResolution> {
      const normalizedContent = contentID.trim();
      const normalizedCity = serviceCityID.trim();
      if (!normalizedContent || !normalizedCity) throw new Error("DSH_DISCOVERY_TARGET_SCOPE_REQUIRED");
      const path = `${dshOperationPaths.resolvePublicDiscoveryContentTarget.path.replace("{contentId}", encodeURIComponent(normalizedContent))}?${new URLSearchParams({ serviceCityId: normalizedCity }).toString()}`;
      return publicRequest<DiscoveryContentTargetResolution>(path);
    },
    async recordPublicDiscoveryContentEvent(input: DiscoveryContentEventRequest, accessToken = ""): Promise<void> {
      if (!input.clientEventId.trim() || !input.contentId.trim() || !input.clientSessionId.trim()) throw new Error("DSH_DISCOVERY_EVENT_INPUT_INVALID");
      if (input.eventType === "CONVERSION") {
        if (!accessToken.trim() || !input.orderId?.trim()) throw new Error("DSH_DISCOVERY_CONVERSION_INPUT_INVALID");
        await userRequest<void>(accessToken, dshOperationPaths.recordPublicDiscoveryContentEvent.path, dshOperationPaths.recordPublicDiscoveryContentEvent.method, input);
        return;
      }
      await publicMutationRequest<void>(dshOperationPaths.recordPublicDiscoveryContentEvent.path, dshOperationPaths.recordPublicDiscoveryContentEvent.method, input);
    },
    async readPublishedStore(storeID: string, serviceCityID: string): Promise<PublicStoreView> {
      const normalized = storeID.trim();
      const normalizedCity = serviceCityID.trim();
      if (!normalized || !normalizedCity) throw new Error("DSH_STORE_SCOPE_REQUIRED");
      const path = `${dshOperationPaths.readPublishedStore.path.replace("{storeId}", encodeURIComponent(normalized))}?${new URLSearchParams({ serviceCityId: normalizedCity }).toString()}`;
      return publicRequest<PublicStoreView>(path);
    },
    async readPublicStoreOrderability(storeID: string, serviceCityID: string): Promise<PublicStoreOrderabilityResponse> {
      const normalizedStore = storeID.trim();
      const normalizedCity = serviceCityID.trim();
      if (!normalizedStore || !normalizedCity) throw new Error("DSH_STORE_ORDERABILITY_SCOPE_REQUIRED");
      const query = new URLSearchParams({ serviceCityId: normalizedCity });
      const path = `${dshOperationPaths.readPublicStoreOrderability.path.replace("{storeId}", encodeURIComponent(normalizedStore))}?${query.toString()}`;
      return publicRequest<PublicStoreOrderabilityResponse>(path);
    },
    async readPublicStoreCatalog(storeID: string, serviceCityID: string, categoryID = "", query = "", limit = 100, cursor = "", productID = ""): Promise<PublicCatalogResponse> {
      const normalizedStore = storeID.trim();
      const normalizedCity = serviceCityID.trim();
      const normalizedProduct = productID.trim();
      if (!normalizedStore || !normalizedCity) throw new Error("DSH_STORE_SCOPE_REQUIRED");
      if (normalizedProduct.length > 128) throw new Error("DSH_CATALOG_PRODUCT_ID_INVALID");
      const params = new URLSearchParams({ serviceCityId: normalizedCity });
      if (categoryID.trim()) params.set("categoryId", categoryID.trim());
      if (normalizedProduct) params.set("productId", normalizedProduct);
      if (query.trim()) params.set("q", query.trim());
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_CATALOG_LIMIT_INVALID");
      params.set("limit", String(limit));
      if (cursor.trim()) params.set("cursor", cursor.trim());
      const path = `${dshOperationPaths.readPublicStoreCatalog.path.replace("{storeId}", encodeURIComponent(normalizedStore))}?${params.toString()}`;
      return publicRequest<PublicCatalogResponse>(path);
    },
    async searchPublicCatalog(serviceCityID: string, query: string, categoryID = "", limit = 20, cursor = "", verticalID = ""): Promise<PublicCatalogSearchResponse> {
      const normalizedCity = serviceCityID.trim();
      const normalizedQuery = query.trim();
      if (!normalizedCity || !normalizedQuery) throw new Error("DSH_CATALOG_SEARCH_SCOPE_REQUIRED");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("DSH_CATALOG_SEARCH_LIMIT_INVALID");
      const params = new URLSearchParams({ serviceCityId: normalizedCity, q: normalizedQuery });
      if (categoryID.trim()) params.set("categoryId", categoryID.trim());
      if (verticalID.trim()) params.set("verticalId", verticalID.trim());
      params.set("limit", String(limit));
      if (cursor.trim()) params.set("cursor", cursor.trim());
      const path = `${dshOperationPaths.searchPublicCatalog.path}?${params.toString()}`;
      return publicRequest<PublicCatalogSearchResponse>(path);
    },
    async evaluateServiceability(accessToken: string, storeID: string, addressID: string): Promise<ServiceabilityResponse> {
      const normalizedStore = storeID.trim();
      const normalizedAddress = addressID.trim();
      if (!normalizedStore || !normalizedAddress) throw new Error("DSH_SERVICEABILITY_INPUT_INVALID");
      return userRequest<ServiceabilityResponse>(accessToken, dshOperationPaths.evaluateServiceability.path, dshOperationPaths.evaluateServiceability.method, { storeId: normalizedStore, addressId: normalizedAddress });
    },
  };
}

function validStoreCatalogImportName(filename: string): boolean {
  const normalized = filename.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 255 && (normalized.endsWith(".csv") || normalized.endsWith(".xlsx"));
}

function storeCatalogImportMimeType(filename: string): string {
  return filename.trim().toLowerCase().endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv";
}
