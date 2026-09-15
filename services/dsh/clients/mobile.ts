import { dshOperationPaths } from "./generated/dsh-operations";
import type { AssortmentPublicationState, CentralProduct, CentralProductListResponse, CorrectJoiningCaseRequest, CreateDeliveryAddressRequest, DeliveryAddressListResponse, DeliveryAddressResponse, JoiningCaseResponse, PublicStoreView, PublishedStoreListResponse, ServiceabilityResponse, ServiceCity, ServiceCityListResponse, SetStoreDeliveryOriginRequest, StoreAssortment, StoreAssortmentListResponse, StoreAssortmentResponse, StoreDeliveryOriginResponse, UpdateDeliveryAddressRequest } from "./generated/dsh-types";

export type DshMobileClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

export type DshMobileClientOptions = Readonly<{
  timeoutMs?: number;
  cryptoRandomUUID?: () => string;
}>;

export function createDshMobileClient(rawBaseUrl: string, options: DshMobileClientOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  let baseUrl = rawBaseUrl.trim();
  let end = baseUrl.length;
  while (end > 0 && baseUrl[end - 1] === "/") end -= 1;
  baseUrl = baseUrl.slice(0, end);
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("DSH_BASE_URL_INVALID");

  async function publicRequest<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
      } catch (error) {
        throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshMobileClientError;
      }
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
    } finally {
      clearTimeout(timeout);
    }
  }

  async function userRequest<T>(accessToken: string, path: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = accessToken.trim();
    if (!token) throw new Error("DSH_ACCESS_TOKEN_REQUIRED");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, { method, headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      } catch (error) {
        throw { kind: "network", message: error instanceof Error ? error.message : "dsh network error" } satisfies DshMobileClientError;
      }
      if (!response.ok) {
        const raw = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
        const nested = raw?.error;
        throw { kind: "http", status: response.status, code: typeof nested?.code === "string" ? nested.code : "DSH_ERROR", message: typeof nested?.message === "string" ? nested.message : "dsh request failed" } satisfies DshMobileClientError;
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
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
      if (!normalized || businessName.length < 2 || businessName.length > 160 || firstStoreName.length < 2 || firstStoreName.length > 160 || !serviceCityId || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
      const path = dshOperationPaths.correctAndResubmitJoiningCase.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<JoiningCaseResponse>(accessToken, path, dshOperationPaths.correctAndResubmitJoiningCase.method, { businessName, firstStoreName, serviceCityId }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async listCentralProducts(accessToken: string, query = "", barcode = "", limit = 50): Promise<ReadonlyArray<CentralProduct>> {
	  if (limit < 1 || limit > 50) throw new Error("DSH_PRODUCT_LIMIT_INVALID");
	  const params = new URLSearchParams();
	  if (query.trim()) params.set("q", query.trim());
	  if (barcode.trim()) params.set("barcode", barcode.trim());
	  params.set("limit", String(limit));
	  const suffix = params.toString();
	  const path = `${dshOperationPaths.listCatalogProducts.path}${suffix ? `?${suffix}` : ""}`;
	  return (await userRequest<CentralProductListResponse>(accessToken, path, dshOperationPaths.listCatalogProducts.method)).products;
	},
    async readOwnStoreAssortment(accessToken: string, storeID: string): Promise<ReadonlyArray<StoreAssortment>> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = dshOperationPaths.readOwnStoreAssortment.path.replace("{storeId}", encodeURIComponent(normalized));
      return (await userRequest<StoreAssortmentListResponse>(accessToken, path, dshOperationPaths.readOwnStoreAssortment.method)).assortments;
    },
    async createStoreAssortment(accessToken: string, storeID: string, productID: string, priceMinor: number): Promise<StoreAssortmentResponse> {
      const normalized = storeID.trim();
      const normalizedProduct = productID.trim();
      if (!normalized || !normalizedProduct || !Number.isSafeInteger(priceMinor) || priceMinor < 1) throw new Error("DSH_ASSORTMENT_INPUT_INVALID");
      const path = dshOperationPaths.createStoreAssortment.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<StoreAssortmentResponse>(accessToken, path, dshOperationPaths.createStoreAssortment.method, { productId: normalizedProduct, priceMinor }, mutationHeaders());
    },
    async updateStoreAssortment(accessToken: string, storeID: string, productID: string, priceMinor: number, publicationState: AssortmentPublicationState, availability: boolean, expectedVersion: number): Promise<StoreAssortmentResponse> {
      const normalizedStore = storeID.trim();
      const normalizedProduct = productID.trim();
      if (!normalizedStore || !normalizedProduct || !Number.isSafeInteger(priceMinor) || priceMinor < 1 || expectedVersion < 1) throw new Error("DSH_ASSORTMENT_INPUT_INVALID");
      const path = dshOperationPaths.updateStoreAssortment.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{productId}", encodeURIComponent(normalizedProduct));
      return userRequest<StoreAssortmentResponse>(accessToken, path, dshOperationPaths.updateStoreAssortment.method, { priceMinor, publicationState, availability }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
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
    async evaluateServiceability(accessToken: string, storeID: string, addressID: string): Promise<ServiceabilityResponse> {
      const normalizedStore = storeID.trim();
      const normalizedAddress = addressID.trim();
      if (!normalizedStore || !normalizedAddress) throw new Error("DSH_SERVICEABILITY_INPUT_INVALID");
      return userRequest<ServiceabilityResponse>(accessToken, dshOperationPaths.evaluateServiceability.path, dshOperationPaths.evaluateServiceability.method, { storeId: normalizedStore, addressId: normalizedAddress });
    },
  };
}
