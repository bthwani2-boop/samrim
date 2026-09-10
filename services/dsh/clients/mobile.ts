import type { PartnerBootstrapResponse } from "./generated/dsh-types";
import { dshOperationPaths } from "./generated/dsh-operations";

export type DshMobileClientError =
  | Readonly<{ kind: "http"; status: number; code: string; message: string }>
  | Readonly<{ kind: "network"; message: string }>;

export function createDshMobileClient(rawBaseUrl: string, timeoutMs = 8_000) {
  const baseUrl = rawBaseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("DSH_BASE_URL_INVALID");

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
  };
}
