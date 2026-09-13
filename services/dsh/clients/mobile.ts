import { dshOperationPaths } from "./generated/dsh-operations";
import type { AssortmentPublicationState, CentralProduct, CentralProductListResponse, CorrectJoiningCaseRequest, JoiningCaseResponse, PublicStoreView, PublishedStoreListResponse, StoreAssortment, StoreAssortmentListResponse, StoreAssortmentResponse } from "./generated/dsh-types";

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

  return {
    async readOwnJoiningCase(accessToken: string): Promise<JoiningCaseResponse> {
      return userRequest<JoiningCaseResponse>(accessToken, dshOperationPaths.readOwnJoiningCase.path, dshOperationPaths.readOwnJoiningCase.method);
    },
    async correctJoiningCase(accessToken: string, caseID: string, input: CorrectJoiningCaseRequest, expectedVersion: number): Promise<JoiningCaseResponse> {
      const normalized = caseID.trim();
      const businessName = input.businessName.trim();
      const firstStoreName = input.firstStoreName.trim();
      if (!normalized || businessName.length < 2 || businessName.length > 160 || firstStoreName.length < 2 || firstStoreName.length > 160 || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
      const path = dshOperationPaths.correctJoiningCase.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<JoiningCaseResponse>(accessToken, path, dshOperationPaths.correctJoiningCase.method, { businessName, firstStoreName }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
    },
    async resubmitJoiningCase(accessToken: string, caseID: string, expectedVersion: number): Promise<JoiningCaseResponse> {
      const normalized = caseID.trim();
      if (!normalized || expectedVersion < 1) throw new Error("DSH_JOINING_CASE_INPUT_INVALID");
      const path = dshOperationPaths.resubmitJoiningCase.path.replace("{caseId}", encodeURIComponent(normalized));
      return userRequest<JoiningCaseResponse>(accessToken, path, dshOperationPaths.resubmitJoiningCase.method, undefined, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
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
    async listPublishedStores(): Promise<ReadonlyArray<PublicStoreView>> {
      const result = await publicRequest<PublishedStoreListResponse>(dshOperationPaths.listPublishedStores.path);
      return result.stores;
    },
    async readPublishedStore(storeID: string): Promise<PublicStoreView> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = dshOperationPaths.readPublishedStore.path.replace("{storeId}", encodeURIComponent(normalized));
      return publicRequest<PublicStoreView>(path);
    },
  };
}
