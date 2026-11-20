/** Verified Merchant Store standing from DSH. No client-owned grants or Store writes. */
import { dshOperations } from "./generated/dsh-operations.ts";
export interface MerchantOwnedStore {
  id: string;
  name: string;
  relation: "MARKETPLACE" | "DIRECT";
  published: boolean;
}
export interface MerchantDSHStanding {
  actorId: string;
  stores: MerchantOwnedStore[];
}
export class MerchantStandingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "MerchantStandingError";
    this.status = status;
    this.code = code;
  }
}

const storeID = /^[a-z0-9-]{1,64}$/;
const opaqueBearer = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
function isStore(value: unknown): value is MerchantOwnedStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 4 &&
    Object.keys(v).every(k => ["id", "name", "relation", "published"].includes(k)) &&
    typeof v.id === "string" && storeID.test(v.id) &&
    typeof v.name === "string" && v.name.trim().length > 0 && Array.from(v.name).length <= 120 &&
    (v.relation === "MARKETPLACE" || v.relation === "DIRECT") &&
    typeof v.published === "boolean";
}
export function standingFrom(body: unknown): MerchantDSHStanding {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MerchantStandingError(502, "OWNER_RESPONSE_INVALID");
  }
  const v = body as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || !Object.hasOwn(v, "actorId") ||
    !Object.hasOwn(v, "stores") || typeof v.actorId !== "string" ||
    v.actorId.length < 1 || v.actorId.length > 128 || v.actorId.trim() !== v.actorId ||
    !Array.isArray(v.stores) || v.stores.length > 100 || !v.stores.every(isStore) ||
    new Set(v.stores.map((s: MerchantOwnedStore) => s.id)).size !== v.stores.length) {
    throw new MerchantStandingError(502, "OWNER_RESPONSE_INVALID");
  }
  return v as unknown as MerchantDSHStanding;
}
function ownerEndpoint(baseUrl: string): string {
  let url: URL;
  try { url = new URL(baseUrl); }
  catch { throw new MerchantStandingError(503, "OWNER_UNAVAILABLE"); }
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") ||
    url.search || url.hash || !(url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)))) {
    throw new MerchantStandingError(503, "OWNER_UNAVAILABLE");
  }
  return new URL(dshOperations.listCurrentMerchantStores.path, url).toString();
}
export async function readMerchantDSHStanding(origin: string, bearer: string, signal?: AbortSignal) {
  if (!opaqueBearer.test(bearer)) throw new MerchantStandingError(401, "UNAUTHENTICATED");
  const endpoint = ownerEndpoint(origin);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET", redirect: "error", cache: "no-store", credentials: "omit",
      signal: signal ?? null,
      headers: { Accept: "application/json", Authorization: "Bearer " + bearer },
    });
  } catch {
    throw new MerchantStandingError(503, "OWNER_UNAVAILABLE");
  }
  if (signal?.aborted) throw new MerchantStandingError(0, "OWNER_RESPONSE_STALE");
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MerchantStandingError(response.status, "STORE_ACCESS_DENIED");
    }
    throw new MerchantStandingError(503, "OWNER_UNAVAILABLE");
  }
  const directives = response.headers.get("Cache-Control")
    ?.toLowerCase().split(",").map(x => x.trim()) ?? [];
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    !directives.includes("no-store")) {
    throw new MerchantStandingError(502, "OWNER_RESPONSE_INVALID");
  }
  let body: unknown;
  try {
    const text = await response.text();
    // Up to 100 stores with 120-character Unicode names and JSON escapes.
    // Bound the serialized envelope without rejecting contract-valid data.
    if (text.length > 262144) throw new Error("oversized owner payload");
    body = JSON.parse(text);
  } catch {
    throw new MerchantStandingError(502, "OWNER_RESPONSE_INVALID");
  }
  if (signal?.aborted) throw new MerchantStandingError(0, "OWNER_RESPONSE_STALE");
  return standingFrom(body);
}
