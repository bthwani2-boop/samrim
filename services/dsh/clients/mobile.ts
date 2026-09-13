import { dshOperationPaths } from "./generated/dsh-operations";
import type { CatalogItem, CatalogItemListResponse, CatalogItemResponse, CatalogPublicationState, JoiningCaseResponse, PublicStoreView, PublishedStoreListResponse } from "./generated/dsh-types";

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
    async readOwnStoreCatalog(accessToken: string, storeID: string): Promise<ReadonlyArray<CatalogItem>> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = dshOperationPaths.readOwnStoreCatalog.path.replace("{storeId}", encodeURIComponent(normalized));
      return (await userRequest<CatalogItemListResponse>(accessToken, path, dshOperationPaths.readOwnStoreCatalog.method)).items;
    },
    async createCatalogItem(accessToken: string, storeID: string, name: string): Promise<CatalogItemResponse> {
      const normalized = storeID.trim();
      if (!normalized) throw new Error("DSH_STORE_ID_REQUIRED");
      const path = dshOperationPaths.createCatalogItem.path.replace("{storeId}", encodeURIComponent(normalized));
      return userRequest<CatalogItemResponse>(accessToken, path, dshOperationPaths.createCatalogItem.method, { name }, mutationHeaders());
    },
    async updateCatalogItem(accessToken: string, storeID: string, itemID: string, name: string, publicationState: CatalogPublicationState, availability: boolean, expectedVersion: number): Promise<CatalogItemResponse> {
      const normalizedStore = storeID.trim();
      const normalizedItem = itemID.trim();
      if (!normalizedStore || !normalizedItem || expectedVersion < 1) throw new Error("DSH_CATALOG_INPUT_INVALID");
      const path = dshOperationPaths.updateCatalogItem.path.replace("{storeId}", encodeURIComponent(normalizedStore)).replace("{itemId}", encodeURIComponent(normalizedItem));
      return userRequest<CatalogItemResponse>(accessToken, path, dshOperationPaths.updateCatalogItem.method, { name, publicationState, availability }, { ...mutationHeaders(), "X-Expected-Version": String(expectedVersion) });
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
