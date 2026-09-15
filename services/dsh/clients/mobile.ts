import { dshOperationPaths } from "./generated/dsh-operations";
import type { CartResponse, CatalogProduct, CatalogProductListResponse, CatalogStoreOffer, CatalogStoreOfferListResponse, CatalogStoreOfferResponse, CheckoutRequest, CorrectJoiningCaseRequest, CreateDeliveryAddressRequest, DeliveryAddressListResponse, DeliveryAddressResponse, JoiningCaseResponse, OrderListResponse, OrderResponse, OrderTransitionRequest, PublicCatalogResponse, PublicStoreView, PublishedStoreListResponse, ServiceabilityResponse, ServiceCity, ServiceCityListResponse, SetStoreDeliveryOriginRequest, StoreDeliveryOriginResponse, UpdateCartLineRequest, UpdateDeliveryAddressRequest, UpsertCartLineRequest } from "./generated/dsh-types";

export type DshMobileClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

export type DshMobileClientOptions = Readonly<{
  timeoutMs?: number;
  cryptoRandomUUID?: () => string;
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

  function mutationHeaders(): Record<string, string> {
    const randomUUID = options.cryptoRandomUUID;
    if (!randomUUID) throw new Error("DSH_IDEMPOTENCY_KEY_GENERATOR_REQUIRED");
    return { "X-Correlation-ID": randomUUID(), "Idempotency-Key": randomUUID() };
  }

  function assertCoordinates(latitude: number, longitude: number): void {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new Error("DSH_LOCATION_COORDINATES_INVALID");
    }
  }

  return {
    async readOwnJoiningCase(accessToken: string): Promise<JoiningCaseResponse> {
      return userRequest<JoiningCaseResponse>(accessToken, dshOperationPaths.readOwnJoiningCase.path, dshOperationPaths.readOwnJoiningCase.method);
    },
    async correctAndResubmitJoiningCase(accessToken: string, caseID: string, input: CorrectJoiningCaseRequest, expectedVersion: number): Promise<JoiningCaseResponse> {
      const normalized = caseID.trim();
      const businessName = input.businessName.trim();
      const firstStoreName = input.firstStoreName.trim();
      const serviceCityId = input.serviceCityId.trim();
      const firstStoreVerticalId = input.firstStoreVerticalId.trim();
      if (!normalized || businessName.length < 2 || businessName.length > 160 || firstStoreName.length < 2 || firstStoreName.length > 160 || !serviceCityId || !firstStoreVerticalId || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
      const path = dshOperationPaths.correctAndResubmitJoiningCase.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<JoiningCaseResponse>(accessToken, path, dshOperationPaths.correctAndResubmitJoiningCase.method, { businessName, firstStoreName, serviceCityId, firstStoreVerticalId }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listCatalogProducts(accessToken: string, query = "", verticalID = "", limit = 100): Promise<ReadonlyArray<CatalogProduct>> {
      if (limit < 1 || limit > 100) throw new Error("DSH_PRODUCT_LIMIT_INVALID");
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (verticalID.trim()) params.set("verticalId", verticalID.trim());
      params.set("limit", String(limit));
      const suffix = params.toString();
      const path = `${dshOperationPaths.listCatalogProducts.path}${suffix ? `?${suffix}` : ""}`;
      return (await userRequest<CatalogProductListResponse>(accessToken, path, dshOperationPaths.listCatalogProducts.method)).products;
    },
    async readOwnStoreOffers(accessToken: string, storeID: string): Promise<ReadonlyArray<CatalogStoreOffer>> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = dshOperationPaths.readOwnStoreOffers.path.replace("{storeId}", encodeURIComponent(normalized));
      return (await userRequest<CatalogStoreOfferListResponse>(accessToken, path, dshOperationPaths.readOwnStoreOffers.method)).offers;
    },
    async createStoreOffer(accessToken: string, storeID: string, variantID: string, priceMinor: number, quantityPolicy = "DISCRETE", pricingBasis = "PER_UNIT"): Promise<CatalogStoreOfferResponse> {
      const normalized = storeID.trim();
      const normalizedVariant = variantID.trim();
      if (!normalized || !normalizedVariant || !Number.isSafeInteger(priceMinor) || priceMinor < 1) throw new Error("DSH_OFFER_INPUT_INVALID");
      const path = dshOperationPaths.createStoreOffer.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<CatalogStoreOfferResponse>(accessToken, path, dshOperationPaths.createStoreOffer.method, { variantId: normalizedVariant, priceMinor, quantityPolicy, pricingBasis }, mutationHeaders());
    },
    async updateStoreOffer(accessToken: string, storeID: string, offerID: string, priceMinor: number, publicationState: "draft" | "published" | "hidden", availability: boolean, expectedVersion: number): Promise<CatalogStoreOfferResponse> {
      const normalizedStore = storeID.trim();
      const normalizedOffer = offerID.trim();
      if (!normalizedStore || !normalizedOffer || !Number.isSafeInteger(priceMinor) || priceMinor < 1 || expectedVersion < 1) throw new Error("DSH_OFFER_INPUT_INVALID");
      const path = dshOperationPaths.updateStoreOffer.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{offerId}", encodeURIComponent(normalizedOffer));
      return userRequest<CatalogStoreOfferResponse>(accessToken, path, dshOperationPaths.updateStoreOffer.method, { priceMinor, publicationState, availability }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async readOpenCart(accessToken: string, storeID: string): Promise<CartResponse> {
      const normalizedStore = storeID.trim();
      if (!normalizedStore) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = `${dshOperationPaths.readOpenCart.path}?${new URLSearchParams({ storeId: normalizedStore }).toString()}`;
      return userRequest<CartResponse>(accessToken, path, dshOperationPaths.readOpenCart.method);
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
    async checkoutCart(accessToken: string, input: CheckoutRequest, expectedCartVersion: number): Promise<OrderResponse> {
      if (!input.cartId.trim() || !input.storeId.trim() || !input.addressId.trim() || expectedCartVersion < 1) throw new Error("DSH_CHECKOUT_INPUT_INVALID");
      return userRequest<OrderResponse>(accessToken, dshOperationPaths.checkoutCart.path, dshOperationPaths.checkoutCart.method, { ...input, cartId: input.cartId.trim(), storeId: input.storeId.trim(), addressId: input.addressId.trim() }, { ...mutationHeaders(), "X-Expected-Version": String(expectedCartVersion) });
    },
    async listClientOrders(accessToken: string, limit = 50): Promise<OrderListResponse> {
      if (limit < 1 || limit > 100) throw new Error("DSH_ORDER_LIMIT_INVALID");
      return userRequest<OrderListResponse>(accessToken, `${dshOperationPaths.listClientOrders.path}?${new URLSearchParams({ limit: String(limit) }).toString()}`, dshOperationPaths.listClientOrders.method);
    },
    async readOrder(accessToken: string, orderID: string): Promise<OrderResponse> {
      const normalized = orderID.trim();
      if (!normalized) throw new Error("DSH_ORDER_ID_REQUIRED");
      const path = dshOperationPaths.readOrder.path.replace("{orderId}", encodeURIComponent(normalized));
      return userRequest<OrderResponse>(accessToken, path, dshOperationPaths.readOrder.method);
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
    async setStoreDeliveryOrigin(accessToken: string, storeID: string, input: SetStoreDeliveryOriginRequest, expectedVersion: number): Promise<StoreDeliveryOriginResponse> {
      const normalized = storeID.trim();
      assertCoordinates(input.latitude, input.longitude);
      if (!normalized || expectedVersion < 0) throw new Error("DSH_LOCATION_INPUT_INVALID");
      const path = dshOperationPaths.setStoreDeliveryOrigin.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<StoreDeliveryOriginResponse>(accessToken, path, dshOperationPaths.setStoreDeliveryOrigin.method, { latitude: input.latitude, longitude: input.longitude }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listActiveServiceCities(): Promise<ReadonlyArray<ServiceCity>> {
      return (await publicRequest<ServiceCityListResponse>(dshOperationPaths.listActiveServiceCities.path)).cities;
    },
    async listPublishedStores(serviceCityID: string): Promise<ReadonlyArray<PublicStoreView>> {
      const normalizedCity = serviceCityID.trim();
      if (!normalizedCity) throw new Error("DSH_SERVICE_CITY_REQUIRED");
      const path = `${dshOperationPaths.listPublishedStores.path}?${new URLSearchParams({ serviceCityId: normalizedCity }).toString()}`;
      const result = await publicRequest<PublishedStoreListResponse>(path);
      return result.stores;
    },
    async readPublishedStore(storeID: string, serviceCityID: string): Promise<PublicStoreView> {
      const normalized = storeID.trim();
      const normalizedCity = serviceCityID.trim();
      if (!normalized || !normalizedCity) throw new Error("DSH_STORE_SCOPE_REQUIRED");
      const path = `${dshOperationPaths.readPublishedStore.path.replace("{storeId}", encodeURIComponent(normalized))}?${new URLSearchParams({ serviceCityId: normalizedCity }).toString()}`;
      return publicRequest<PublicStoreView>(path);
    },
    async readPublicStoreCatalog(storeID: string, serviceCityID: string, categoryID = "", query = ""): Promise<PublicCatalogResponse> {
      const normalizedStore = storeID.trim();
      const normalizedCity = serviceCityID.trim();
      if (!normalizedStore || !normalizedCity) throw new Error("DSH_STORE_SCOPE_REQUIRED");
      const params = new URLSearchParams({ serviceCityId: normalizedCity });
      if (categoryID.trim()) params.set("categoryId", categoryID.trim());
      if (query.trim()) params.set("q", query.trim());
      const path = `${dshOperationPaths.readPublicStoreCatalog.path.replace("{storeId}", encodeURIComponent(normalizedStore))}?${params.toString()}`;
      return publicRequest<PublicCatalogResponse>(path);
    },
    async evaluateServiceability(accessToken: string, storeID: string, addressID: string): Promise<ServiceabilityResponse> {
      const normalizedStore = storeID.trim();
      const normalizedAddress = addressID.trim();
      if (!normalizedStore || !normalizedAddress) throw new Error("DSH_SERVICEABILITY_INPUT_INVALID");
      return userRequest<ServiceabilityResponse>(accessToken, dshOperationPaths.evaluateServiceability.path, dshOperationPaths.evaluateServiceability.method, { storeId: normalizedStore, addressId: normalizedAddress });
    },
  };
}
