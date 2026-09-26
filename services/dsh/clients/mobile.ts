import { dshOperationPaths } from "./generated/dsh-operations";
import type { AcceptStoreCaptainInvitationRequest, BeneficiaryPayoutStateResponse, BeneficiaryWalletResponse, BeneficiaryFundingIntentResponse, CashInFundingIntent, CaptainAdmissionResponse, CaptainAssignmentListResponse, CaptainAssignmentResponse, CaptainAvailabilityRequest, CaptainCashRemittanceRequest, CaptainCashRemittanceResponse, CaptainCompletionRequest, CaptainDeliveryTaskResponse, CaptainLocationResponse, CaptainOfferDecisionRequest, CaptainOfferListResponse, CaptainOfferResponse, CartResponse, CashLiabilityResponse, CatalogAttributeEnumOptionListResponse, CatalogAttributeRuleListResponse, CatalogCategoryListResponse, CatalogModifierGroupResponse, CatalogModifierOptionResponse, CatalogProduct, CatalogProductListResponse, CatalogProductProposalListResponse, CatalogProductProposalResponse, CatalogStorefrontSectionResponse, CatalogStoreOffer, CatalogStoreOfferListResponse, CatalogStoreOfferResponse, CatalogVariantResponse, CheckoutQuoteResponse, CheckoutRequest, ClientOpenCartListResponse, CommerceVerticalListResponse, CorrectJoiningCaseRequest, CreateCatalogModifierGroupRequest, CreateCatalogModifierOptionRequest, CreateCatalogProductProposalRequest, CreateCatalogProductRequest, CreateCatalogStorefrontSectionRequest, CreateCatalogVariantRequest, CreateDeliveryAddressRequest, CreateJoiningCaseRequest, CreateOrderConversationMessageRequest, CreateOrderRatingRequest, DeliveryAddressListResponse, DeliveryAddressResponse, DeliveryProofResponse, DiscoveryContentEventRequest, DiscoveryContentListResponse, DiscoveryContentTargetResolution, FavoriteStoreOfferListResponse, FavoriteStoreOfferResponse, FavoriteStoreListResponse, FavoriteStoreResponse, FieldAdmissionResponse, FieldFinancialSummaryResponse, JoiningCaseListResponse, JoiningCaseResponse, MarkOrderConversationReadRequest, MultiStoreCheckoutRequest, MultiStoreCheckoutResponse, NotificationListResponse, NotificationReadResponse, OrderConversationMessageResponse, OrderConversationReadResponse, OrderConversationResponse, OrderListResponse, OrderRatingResponse, OrderResponse, OrderTrackingResponse, OrderTransitionRequest, PartnerFinancialSummaryResponse, PayoutRequest, PromotionListResponse, PublicCatalogResponse, PublicCatalogSearchResponse, PublicStoreView, PublishedStoreListResponse, ReplaceCatalogProductMediaRequest, ServiceabilityResponse, ServiceCity, ServiceCityListResponse, SetStoreFulfillmentModesRequest, StoreCaptainDispatchRequest, StoreCaptainInvitationResponse, StoreCaptainMembershipListResponse, StoreCaptainMembershipResponse, StoreCaptainMembershipTransitionRequest, StoreDeliveryOriginResponse, StoreFulfillmentModesResponse, UpdateCartLineRequest, UpdateCatalogProductProposalRequest, UpdateCatalogProductRequest, UpdateCatalogVariantRequest, UpdateDeliveryAddressRequest, UpsertCartLineRequest } from "./generated/dsh-types";

export type DshMobileClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

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

  return {
    async listCatalogVerticals(): Promise<CommerceVerticalListResponse["verticals"]> {
      return (await publicRequest<CommerceVerticalListResponse>(dshOperationPaths.listCatalogVerticals.path)).verticals;
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
    async readOwnPartnerFinancialSummary(accessToken: string): Promise<PartnerFinancialSummaryResponse> {
      return userRequest<PartnerFinancialSummaryResponse>(accessToken, dshOperationPaths.readOwnPartnerFinancialSummary.path, dshOperationPaths.readOwnPartnerFinancialSummary.method);
    },
    async readOwnFieldFinancialSummary(accessToken: string): Promise<FieldFinancialSummaryResponse> {
      return userRequest<FieldFinancialSummaryResponse>(accessToken, dshOperationPaths.readOwnFieldFinancialSummary.path, dshOperationPaths.readOwnFieldFinancialSummary.method);
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
      if (!normalized || businessName.length < 2 || businessName.length > 160 || firstStoreName.length < 2 || firstStoreName.length > 160 || !serviceCityId || !firstStoreVerticalId || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude) || input.firstStoreLatitude < -90 || input.firstStoreLatitude > 90 || input.firstStoreLongitude < -180 || input.firstStoreLongitude > 180 || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
      const path = dshOperationPaths.correctAndResubmitJoiningCase.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<JoiningCaseResponse>(accessToken, path, dshOperationPaths.correctAndResubmitJoiningCase.method, { businessName, firstStoreName, serviceCityId, firstStoreVerticalId, firstStoreLatitude: input.firstStoreLatitude, firstStoreLongitude: input.firstStoreLongitude }, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) });
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
    async uploadStoreProductMedia(accessToken: string, storeID: string, productID: string, input: DshImageUploadInput, role: "primary" | "gallery", expectedVersion: number): Promise<{ product: CatalogProduct; idempotentReplay: boolean }> {
      const normalizedStore = storeID.trim();
      const normalizedProduct = productID.trim();
      const uri = input.uri.trim();
      if (!normalizedStore || !normalizedProduct || !uri || expectedVersion < 1 || (role !== "primary" && role !== "gallery")) throw new Error("DSH_STORE_PRODUCT_MEDIA_INPUT_INVALID");
      const fileName = input.name?.trim() || "product-image.jpg";
      const mimeType = input.type?.trim() || "image/jpeg";
      const form = input.nativeMultipartUpload ? undefined : new FormData();
      if (form) {
        form.append("role", role);
        form.append("file", input.blob ?? ({ uri, name: fileName, type: mimeType } as unknown as Blob));
      }
      const path = dshOperationPaths.uploadStoreProductMedia.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{productId}", encodeURIComponent(normalizedProduct));
      return userMultipartRequest(accessToken, path, dshOperationPaths.uploadStoreProductMedia.method, form, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) }, input.nativeMultipartUpload, { fieldName: "file", fileName, mimeType, parameters: { role } });
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
    async readOrderConversation(accessToken: string, orderID: string, limit = 50): Promise<OrderConversationResponse> {
      const normalized = orderID.trim();
      if (!normalized || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("DSH_ORDER_CONVERSATION_INPUT_INVALID");
      const path = `${dshOperationPaths.readOrderConversation.path.replace("{orderId}", encodeURIComponent(normalized))}?${new URLSearchParams({ limit: String(limit) }).toString()}`;
      return userRequest<OrderConversationResponse>(accessToken, path, dshOperationPaths.readOrderConversation.method);
    },
    async sendOrderConversationMessage(accessToken: string, orderID: string, input: CreateOrderConversationMessageRequest): Promise<OrderConversationMessageResponse> {
      const normalized = orderID.trim();
      const body = input.body.trim();
      if (!normalized || Array.from(body).length < 1 || Array.from(body).length > 2000) throw new Error("DSH_ORDER_CONVERSATION_BODY_INVALID");
      const path = dshOperationPaths.sendOrderConversationMessage.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderConversationMessageResponse>(accessToken, path, dshOperationPaths.sendOrderConversationMessage.method, { body }, mutationHeaders());
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
    async listStoreOrders(accessToken: string, storeID: string, limit = 50): Promise<OrderListResponse> {
      const normalized = storeID.trim();
      if (!normalized || limit < 1 || limit > 100) throw new Error("DSH_ORDER_INPUT_INVALID");
      const path = `${dshOperationPaths.listStoreOrders.path.replace("{storeId}", encodeURIComponent(normalized))}?${new URLSearchParams({ limit: String(limit) }).toString()}`;
      return userRequest<OrderListResponse>(accessToken, path, dshOperationPaths.listStoreOrders.method);
    },
    async transitionStoreOrder(accessToken: string, storeID: string, orderID: string, input: OrderTransitionRequest, expectedVersion: number): Promise<OrderResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOrder = orderID.trim();
      if (!normalizedStore || !normalizedOrder || expectedVersion < 1) throw new Error("DSH_ORDER_INPUT_INVALID");
      const path = dshOperationPaths.transitionStoreOrder.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{orderId}", encodeURIComponent(normalizedOrder));
      return userRequest<OrderResponse>(accessToken, path, dshOperationPaths.transitionStoreOrder.method, input, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
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
    async completeCaptainAssignment(accessToken: string, assignmentID: string, input: CaptainCompletionRequest, expectedVersion: number): Promise<CaptainAssignmentResponse> {
      const normalized = assignmentID.trim();
      if (!normalized || expectedVersion < 1 || !input.result) throw new Error("DSH_CAPTAIN_ASSIGNMENT_INPUT_INVALID");
      if (input.result === "delivered" && !/^[0-9]{6}$/.test(input.deliveryProofCode?.trim() ?? "")) throw new Error("DSH_DELIVERY_PROOF_REQUIRED");
      if (input.result === "delivery_failed" && input.deliveryProofCode?.trim()) throw new Error("DSH_DELIVERY_PROOF_NOT_ALLOWED");
      const path = dshOperationPaths.completeCaptainAssignment.path.replace("{assignmentId}", encodeURIComponent(normalized));
      return userRequest<CaptainAssignmentResponse>(accessToken, path, dshOperationPaths.completeCaptainAssignment.method, { ...input, ...(input.deliveryProofCode === undefined ? {} : { deliveryProofCode: input.deliveryProofCode.trim() }) }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async readOwnFieldAdmission(accessToken: string): Promise<FieldAdmissionResponse> {
      return userRequest<FieldAdmissionResponse>(accessToken, dshOperationPaths.readOwnFieldAdmission.path, dshOperationPaths.readOwnFieldAdmission.method);
    },
    async listOwnFieldJoiningCases(accessToken: string, limit = 25): Promise<JoiningCaseListResponse> {
      if (limit < 1 || limit > 50) throw new Error("DSH_FIELD_JOINING_CASE_LIMIT_INVALID");
      const path = `${dshOperationPaths.listOwnFieldJoiningCases.path}?${new URLSearchParams({ limit: String(limit) }).toString()}`;
      return userRequest<JoiningCaseListResponse>(accessToken, path, dshOperationPaths.listOwnFieldJoiningCases.method);
    },
    async createFieldJoiningCase(accessToken: string, input: CreateJoiningCaseRequest, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
      const contactPhoneE164 = input.contactPhoneE164.trim();
      const businessName = input.businessName.trim();
      const firstStoreName = input.firstStoreName.trim();
      const serviceCityId = input.serviceCityId.trim();
      const firstStoreVerticalId = input.firstStoreVerticalId.trim();
      if (!/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164) || businessName.length < 2 || businessName.length > 160 || firstStoreName.length < 2 || firstStoreName.length > 160 || !serviceCityId || !firstStoreVerticalId || !Number.isFinite(input.firstStoreLatitude) || !Number.isFinite(input.firstStoreLongitude) || input.firstStoreLatitude < -90 || input.firstStoreLatitude > 90 || input.firstStoreLongitude < -180 || input.firstStoreLongitude > 180) throw new Error("DSH_FIELD_JOINING_CASE_INPUT_INVALID");
      return userRequest<JoiningCaseResponse>(accessToken, dshOperationPaths.createFieldJoiningCase.path, dshOperationPaths.createFieldJoiningCase.method, { ...input, contactPhoneE164, businessName, firstStoreName, serviceCityId, firstStoreVerticalId }, mutationHeaders(idempotencyKey, correlationID));
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
    async uploadJoiningCaseStoreImage(accessToken: string, caseID: string, input: DshImageUploadInput, expectedVersion: number, idempotencyKey?: string, correlationID?: string): Promise<JoiningCaseResponse> {
      const normalized = caseID.trim();
      const uri = input.uri.trim();
      if (!normalized || !uri || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_STORE_IMAGE_INPUT_INVALID");
      const fileName = input.name?.trim() || "store-image.jpg";
      const mimeType = input.type?.trim() || "image/jpeg";
      const form = input.nativeMultipartUpload ? undefined : new FormData();
      if (form) form.append("file", input.blob ?? ({ uri, name: fileName, type: mimeType } as unknown as Blob));
      const path = dshOperationPaths.uploadJoiningCaseStoreImage.path.replace("{caseId}", encodeURIComponent(normalized));
      return userMultipartRequest(accessToken, path, dshOperationPaths.uploadJoiningCaseStoreImage.method, form, { ...mutationHeaders(idempotencyKey, correlationID), "X-Expected-Version": String(expectedVersion) }, input.nativeMultipartUpload, { fieldName: "file", fileName, mimeType, parameters: {} });
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
    async listPublishedStores(serviceCityID: string, location?: Readonly<{ latitude: number; longitude: number }>): Promise<PublishedStoreListResponse> {
      const normalizedCity = serviceCityID.trim();
      if (!normalizedCity) throw new Error("DSH_SERVICE_CITY_REQUIRED");
      const params = new URLSearchParams({ serviceCityId: normalizedCity });
      if (location) {
        assertCoordinates(location.latitude, location.longitude);
        params.set("latitude", String(location.latitude));
        params.set("longitude", String(location.longitude));
      }
      const path = `${dshOperationPaths.listPublishedStores.path}?${params.toString()}`;
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
    async searchPublicCatalog(serviceCityID: string, query: string, categoryID = "", limit = 20, cursor = ""): Promise<PublicCatalogSearchResponse> {
      const normalizedCity = serviceCityID.trim();
      const normalizedQuery = query.trim();
      if (!normalizedCity || !normalizedQuery) throw new Error("DSH_CATALOG_SEARCH_SCOPE_REQUIRED");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("DSH_CATALOG_SEARCH_LIMIT_INVALID");
      const params = new URLSearchParams({ serviceCityId: normalizedCity, q: normalizedQuery });
      if (categoryID.trim()) params.set("categoryId", categoryID.trim());
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
