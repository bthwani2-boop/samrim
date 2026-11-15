/**
 * Contract-bound DSH public discovery reads. No Store, price or financial writers.
 * Wire format: services/dsh/contracts/openapi/paths/customer-discovery.yaml.
 */
export interface PublicStore {
  id: string;
  name: string;
  cityId: string;
  verticalId: string;
  orderabilityStatus: "OPEN_FOR_ORDERS" | "CLOSED_BY_SCHEDULE" | "PAUSED" | "OPERATIONALLY_UNAVAILABLE";
  orderingAvailable: false;
}
export interface PublicOffer {
  id: string;
  storeId: string;
  name: string;
  variantId: string;
  priceYer: number;
  available: true;
}
export interface PublicPage<T> {
  items: T[];
  nextCursor?: string;
  revision: number;
}
export class DshPublicError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = "DshPublicError";
  }
}
function endpoint(baseUrl: string, path: string): URL {
  if (!baseUrl) throw new DshPublicError(0, "DSH_ENDPOINT_NOT_CONFIGURED");
  let root: URL;
  try {
    root = new URL(baseUrl);
  } catch {
    throw new DshPublicError(0, "DSH_ENDPOINT_INVALID");
  }
  if (root.username || root.password || !(root.protocol === "https:" ||
    (root.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(root.hostname)))) {
    throw new DshPublicError(0, "DSH_ENDPOINT_UNSAFE");
  }
  return new URL(path, root);
}
async function ownerRead(url: URL, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url.toString(), { signal: signal ?? null, headers: { Accept: "application/json" } });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DshPublicError(0, "OWNER_NETWORK_UNAVAILABLE");
  }
  if (!response.ok) {
    let code = "OWNER_READ_FAILED";
    try {
      const data: unknown = await response.json();
      if (data && typeof data === "object" && "error" in data && typeof data.error === "string") code = data.error;
    } catch { /* keep the safe generic error */ }
    throw new DshPublicError(response.status, code);
  }
  try { return await response.json(); } catch {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
}
function isStore(value: unknown): value is PublicStore {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string" &&
    typeof v.cityId === "string" && typeof v.verticalId === "string" &&
    ["OPEN_FOR_ORDERS", "CLOSED_BY_SCHEDULE", "PAUSED", "OPERATIONALLY_UNAVAILABLE"].includes(String(v.orderabilityStatus)) &&
    v.orderingAvailable === false;
}
function isOffer(value: unknown): value is PublicOffer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.storeId === "string" &&
    typeof v.name === "string" && typeof v.variantId === "string" &&
    Number.isSafeInteger(v.priceYer) && (v.priceYer as number) > 0 && v.available === true;
}
function readPage<T>(value: unknown, validate: (v: unknown) => v is T): PublicPage<T> {
  if (!value || typeof value !== "object") throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.items) || !v.items.every(validate) ||
    !Number.isSafeInteger(v.revision) || (v.nextCursor != null && typeof v.nextCursor !== "string")) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return { items: v.items, revision: v.revision as number, ...(typeof v.nextCursor === "string" ? { nextCursor: v.nextCursor } : {}) };
}
export async function listPublicStores(
  baseUrl: string, cityId: string, options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicStore>> {
  const url = endpoint(baseUrl, "/v1/public/stores");
  url.searchParams.set("city_id", cityId);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isStore);
  if (page.items.some((store) => store.cityId !== cityId)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}
export async function getPublicStore(baseUrl: string, storeId: string, signal?: AbortSignal): Promise<PublicStore> {
  const url = endpoint(baseUrl, "/v1/public/stores/" + encodeURIComponent(storeId));
  const value = await ownerRead(url, signal);
  if (!isStore(value) || value.id !== storeId) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return value;
}
export async function listPublicOffers(
  baseUrl: string, storeId: string, options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicOffer>> {
  const url = endpoint(baseUrl, "/v1/public/stores/" + encodeURIComponent(storeId) + "/offers");
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isOffer);
  if (page.items.some((offer) => offer.storeId !== storeId)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}
