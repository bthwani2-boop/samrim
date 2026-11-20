/**
 * Contract-bound DSH public discovery reads. No Store, price or financial writers.
 * Public wire format: paths/stores.yaml and paths/offers.yaml in the DSH OpenAPI owner.
 */
export interface PublicVertical {
  id: string;
  storeCount: number;
}
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
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "DshPublicError";
    this.status = status;
    this.code = code;
  }
}
export function endpoint(baseUrl: string, path: string): URL {
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
    response = await fetch(url.toString(), {
      method: "GET", signal: signal ?? null, redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json" },
    });
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
  // A successful public owner read must obey the DSH JSON wire contract.
  // Bound the decoded payload before interpreting it as a Store or Offer.
  const mediaType = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  const contentLength = response.headers.get("Content-Length");
  if (mediaType !== "application/json" ||
    (contentLength !== null && Number(contentLength) > 65536)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  let body: unknown;
  try {
    const raw = await response.text();
    if (raw.length > 65536) throw new Error("public response exceeds safe bound");
    body = JSON.parse(raw) as unknown;
  } catch {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return body;
}
// Enforce the actual public OpenAPI schema at the client trust boundary.
// A TypeScript interface does not remove extra JSON keys or validate wire data.
const publicId = /^[a-z0-9-]{1,64}$/;
function isPublicId(value: unknown): value is string {
  return typeof value === "string" && publicId.test(value);
}
function boundedName(value: unknown, maxCodePoints: number): value is string {
  return typeof value === "string" && Array.from(value).length >= 1 &&
    Array.from(value).length <= maxCodePoints;
}
export function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function isStore(value: unknown): value is PublicStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return onlyKeys(v, ["id", "name", "cityId", "verticalId", "orderabilityStatus", "orderingAvailable"]) &&
    isPublicId(v.id) && boundedName(v.name, 120) &&
    isPublicId(v.cityId) && isPublicId(v.verticalId) &&
    ["OPEN_FOR_ORDERS", "CLOSED_BY_SCHEDULE", "PAUSED", "OPERATIONALLY_UNAVAILABLE"].includes(String(v.orderabilityStatus)) &&
    v.orderingAvailable === false;
}
function isVertical(value: unknown): value is PublicVertical {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return onlyKeys(v, ["id", "storeCount"]) && isPublicId(v.id) &&
    Number.isSafeInteger(v.storeCount) && Number(v.storeCount) >= 1;
}
function isOffer(value: unknown): value is PublicOffer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return onlyKeys(v, ["id", "storeId", "name", "variantId", "priceYer", "available"]) &&
    isPublicId(v.id) && isPublicId(v.storeId) && boundedName(v.name, 160) &&
    isPublicId(v.variantId) &&
    Number.isSafeInteger(v.priceYer) && (v.priceYer as number) > 0 && v.available === true;
}
function readPage<T>(value: unknown, validate: (v: unknown) => v is T): PublicPage<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  const v = value as Record<string, unknown>;
  if (!onlyKeys(v, ["items", "revision", "nextCursor"]) ||
    !Array.isArray(v.items) || !v.items.every(validate) ||
    !Number.isSafeInteger(v.revision) || Number(v.revision) < 0 ||
    (v.nextCursor !== undefined &&
      (typeof v.nextCursor !== "string" || v.nextCursor.length > 512))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return { items: v.items, revision: v.revision as number, ...(typeof v.nextCursor === "string" ? { nextCursor: v.nextCursor } : {}) };
}
function validatePublicPaging(options: { cursor?: string; limit?: number }): void {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 50)) {
    throw new DshPublicError(400, "INVALID_LIMIT");
  }
  if (options.cursor !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(options.cursor)) {
    throw new DshPublicError(400, "INVALID_CURSOR");
  }
}

function validateStoreId(storeId: string): void {
  if (!isPublicId(storeId)) throw new DshPublicError(400, "INVALID_STORE");
}

export async function listPublicVerticals(
  baseUrl: string, cityId: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicVertical>> {
  if (!isPublicId(cityId)) throw new DshPublicError(400, "INVALID_CITY");
  validatePublicPaging(options);
  const url = endpoint(baseUrl, "/v1/public/verticals");
  url.searchParams.set("city_id", cityId);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isVertical);
  if (page.items.length > (options.limit ?? 20)) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return page;
}

export async function listPublicStores(
  baseUrl: string, cityId: string, options: { query?: string; verticalId?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicStore>> {
  if (!isPublicId(cityId)) throw new DshPublicError(400, "INVALID_CITY");
  validatePublicPaging(options);
  validatePublicSearch(options.query);
  if (options.verticalId !== undefined && !isPublicId(options.verticalId)) {
    throw new DshPublicError(400, "INVALID_VERTICAL");
  }
  const url = endpoint(baseUrl, "/v1/public/stores");
  url.searchParams.set("city_id", cityId);
  if (options.query !== undefined) url.searchParams.set("q", options.query);
  if (options.verticalId !== undefined) url.searchParams.set("vertical_id", options.verticalId);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isStore);
  if (page.items.length > (options.limit ?? 20) ||
    page.items.some((store) => store.cityId !== cityId ||
    (options.verticalId !== undefined && store.verticalId !== options.verticalId))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}
export async function getPublicStore(baseUrl: string, storeId: string, signal?: AbortSignal): Promise<PublicStore> {
  validateStoreId(storeId);
  const url = endpoint(baseUrl, "/v1/public/stores/" + encodeURIComponent(storeId));
  const value = await ownerRead(url, signal);
  if (!isStore(value) || value.id !== storeId) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return value;
}
export async function listPublicOffers(
  baseUrl: string, storeId: string, options: { query?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicOffer>> {
  validateStoreId(storeId);
  validatePublicPaging(options);
  validatePublicSearch(options.query);
  const url = endpoint(baseUrl, "/v1/public/stores/" + encodeURIComponent(storeId) + "/offers");
  if (options.query !== undefined) url.searchParams.set("q", options.query);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isOffer);
  if (page.items.length > (options.limit ?? 20) ||
    page.items.some((offer) => offer.storeId !== storeId)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}

function validatePublicSearch(query: string | undefined): void {
  // Check the wire value before URLSearchParams can replace lone surrogates.
  // OpenAPI maxLength counts Unicode code points, including surrounding space.
  if (query !== undefined && (Array.from(query).length > 80 ||
    query.includes("\u0000") || /[\uD800-\uDFFF]/u.test(query))) {
    throw new DshPublicError(400, "INVALID_SEARCH");
  }
}
