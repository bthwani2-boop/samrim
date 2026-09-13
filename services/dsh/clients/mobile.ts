import { dshOperationPaths } from "./generated/dsh-operations";
import type { PartnerBootstrapResponse, PublicStoreView, PublishedStoreListResponse } from "./generated/dsh-types";

export type DshMobileClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

export function createDshMobileClient(rawBaseUrl: string, timeoutMs = 8_000) {
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

  return {
    async readOwnPartnerBootstrap(accessToken: string): Promise<PartnerBootstrapResponse> {
      const token = accessToken.trim();
      if (!token) throw new Error("DSH_ACCESS_TOKEN_REQUIRED");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetch(`${baseUrl}${dshOperationPaths.readOwnPartnerBootstrap.path}`, {
            method: dshOperationPaths.readOwnPartnerBootstrap.method,
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
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
        return await response.json() as PartnerBootstrapResponse;
      } finally {
        clearTimeout(timeout);
      }
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
