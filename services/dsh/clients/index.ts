/**
 * Contract-bound DSH public discovery reads. No Store, price or financial writers.
 * Public wire format: paths/stores.yaml and paths/offers.yaml in the DSH OpenAPI owner.
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


/** Private Store availability from DSH's executable store-access contract.
 * An Identity bearer is passed per request and is never cached here.
 * This client never derives or edits public Customer orderability.
 */
export interface StoreWeeklyWindow {
  weekday: number;
  opens: number;
  closes: number;
}
export interface StoreOperationalAvailability {
  storeId: string;
  timezone: string;
  weekly: StoreWeeklyWindow[] | null;
  pausedUntil?: string;
  preparationMinutes: number;
  version: number;
  actingActorId: string;
  reason: string;
}
export interface StoreOperationalChange {
  operationId: string;
  expectedVersion: number;
  weekly: StoreWeeklyWindow[];
  pausedUntil?: string | null;
  preparationMinutes: number;
  reason: string;
}
export interface StoreOperationalResult {
  availability: StoreOperationalAvailability;
  replay: boolean;
}
function isStoreWeeklyWindow(value: unknown): value is StoreWeeklyWindow {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isSafeInteger(item.weekday) && Number(item.weekday) >= 0 && Number(item.weekday) <= 6 &&
    Number.isSafeInteger(item.opens) && Number(item.opens) >= 0 && Number(item.opens) < 1440 &&
    Number.isSafeInteger(item.closes) && Number(item.closes) >= 0 && Number(item.closes) <= 1440;
}
function isStoreAvailability(value: unknown, storeId: string): value is StoreOperationalAvailability {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.storeId === storeId && typeof item.timezone === "string" && item.timezone !== "" &&
    item.timezone !== "Local" && (item.weekly === null || (Array.isArray(item.weekly) && item.weekly.every(isStoreWeeklyWindow))) &&
    (item.pausedUntil === undefined || typeof item.pausedUntil === "string") &&
    Number.isSafeInteger(item.preparationMinutes) && Number(item.preparationMinutes) >= 0 &&
    Number.isSafeInteger(item.version) && Number(item.version) >= 1 &&
    typeof item.actingActorId === "string" && typeof item.reason === "string";
}
async function storeOwnerRequest(
  baseUrl: string, storeId: string, bearer: string, method: "GET" | "PATCH", change?: StoreOperationalChange, signal?: AbortSignal,
): Promise<unknown> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(0, "STORE_ID_INVALID");
  if (!bearer || bearer.trim() !== bearer || /\s/.test(bearer)) throw new DshPublicError(401, "UNAUTHENTICATED");
  const url = endpoint(baseUrl, "/v1/stores/" + encodeURIComponent(storeId) + "/availability");
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method, signal: signal ?? null, redirect: "error", credentials: "omit", cache: "no-store",
      headers: {
        Authorization: "Bearer " + bearer,
        Accept: "application/json",
        ...(method === "PATCH" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "PATCH" ? { body: JSON.stringify(change) } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DshPublicError(0, "OWNER_NETWORK_UNAVAILABLE");
  }
  if (!response.ok) {
    let code = "STORE_OPERATION_FAILED";
    try {
      const err: unknown = await response.json();
      if (err && typeof err === "object" && "code" in err && typeof err.code === "string") code = err.code;
    } catch { /* fail closed with a stable generic error */ }
    throw new DshPublicError(response.status, code);
  }
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > 32768) throw new Error("oversized");
    body = JSON.parse(text) as unknown;
  } catch {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return body;
}
export async function getStoreOperationalAvailability(
  baseUrl: string, storeId: string, bearer: string, signal?: AbortSignal,
): Promise<StoreOperationalAvailability> {
  const body = await storeOwnerRequest(baseUrl, storeId, bearer, "GET", undefined, signal);
  if (!isStoreAvailability(body, storeId)) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return body;
}
export async function updateStoreOperationalAvailability(
  baseUrl: string, storeId: string, bearer: string, change: StoreOperationalChange, signal?: AbortSignal,
): Promise<StoreOperationalResult> {
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(change.operationId) ||
    !Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 1 ||
    !Number.isSafeInteger(change.preparationMinutes) || change.preparationMinutes < 0 ||
    typeof change.reason !== "string" || change.reason.trim().length < 1 || change.reason.length > 300 ||
    (!Array.isArray(change.weekly) || !change.weekly.every(isStoreWeeklyWindow))) {
    throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  }
  const body = await storeOwnerRequest(baseUrl, storeId, bearer, "PATCH", change, signal);
  if (!body || typeof body !== "object") throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  const result = body as Record<string, unknown>;
  if (typeof result.replay !== "boolean" || !isStoreAvailability(result.availability, storeId)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return result as unknown as StoreOperationalResult;
}
