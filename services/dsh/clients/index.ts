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
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "DshPublicError";
    this.status = status;
    this.code = code;
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
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
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
export async function listPublicStores(
  baseUrl: string, cityId: string, options: { query?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicStore>> {
  validatePublicSearch(options.query);
  const url = endpoint(baseUrl, "/v1/public/stores");
  url.searchParams.set("city_id", cityId);
  if (options.query !== undefined) url.searchParams.set("q", options.query);
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
  baseUrl: string, storeId: string, options: { query?: string; cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PublicPage<PublicOffer>> {
  validatePublicSearch(options.query);
  const url = endpoint(baseUrl, "/v1/public/stores/" + encodeURIComponent(storeId) + "/offers");
  if (options.query !== undefined) url.searchParams.set("q", options.query);
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.limit) url.searchParams.set("limit", String(options.limit));
  const page = readPage(await ownerRead(url, options.signal), isOffer);
  if (page.items.some((offer) => offer.storeId !== storeId)) {
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
async function privateOwnerRequest(
  baseUrl: string, path: string, bearer: string, method: "GET" | "PATCH", change?: StoreOperationalChange | CityStoreOperationalPolicyChange, signal?: AbortSignal,
): Promise<unknown> {
  // Only fixed owner-authored paths assembled by the public functions below
  // reach this uncached transport. A user cannot supply an arbitrary URL.
  if (!bearer || bearer.trim() !== bearer || /\s/.test(bearer)) throw new DshPublicError(401, "UNAUTHENTICATED");
  const url = endpoint(baseUrl, path);
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
    // A PATCH may have committed before the transport failed. Never report
    // an ordinary read outage or imply that retrying with a NEW key is safe.
    if (method === "PATCH") throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
    if (signal?.aborted) throw error;
    throw new DshPublicError(0, "OWNER_NETWORK_UNAVAILABLE");
  }
  if (!response.ok) {
    let code = "STORE_OPERATION_FAILED";
    try {
      const err: unknown = await response.json();
      if (err && typeof err === "object" && "code" in err && typeof err.code === "string") code = err.code;
    } catch { /* fail closed with a stable generic error */ }
    // A server-side failure after a PATCH does not prove that the Store
    // transaction was rolled back. Reconcile using the original operationId.
    throw new DshPublicError(response.status,
      method === "PATCH" && response.status >= 500 ? "OPERATION_RESULT_UNKNOWN" : code);
  }
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new DshPublicError(502, method === "PATCH" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  let body: unknown;
  try {
    const text = await response.text();
    if (text.length > 32768) throw new Error("oversized");
    body = JSON.parse(text) as unknown;
  } catch {
    throw new DshPublicError(502, method === "PATCH" ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID");
  }
  return body;
}
export async function getStoreOperationalAvailability(
  baseUrl: string, storeId: string, bearer: string, signal?: AbortSignal,
): Promise<StoreOperationalAvailability> {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(0, "STORE_ID_INVALID");
  const body = await privateOwnerRequest(baseUrl, "/v1/stores/" + encodeURIComponent(storeId) + "/availability", bearer, "GET", undefined, signal);
  if (!isStoreAvailability(body, storeId)) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  // A completed HTTP response must not revive an earlier Store/account view
  // after the caller has invalidated that view's AbortSignal.
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
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
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(0, "STORE_ID_INVALID");
  const body = await privateOwnerRequest(baseUrl, "/v1/stores/" + encodeURIComponent(storeId) + "/availability", bearer, "PATCH", change, signal);
  if (!body || typeof body !== "object") throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  const result = body as Record<string, unknown>;
  if (typeof result.replay !== "boolean" || !isStoreAvailability(result.availability, storeId)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  // A caller switching Store/account must not display this in-flight write as
  // a current-context success. It may have committed, so keep its stable key.
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  return result as unknown as StoreOperationalResult;
}


/** DSH-owned read-only city Store availability policy; this is not an
 * Operator policy writer and never grants Store, Order or WLT actions.
 */
export interface CityStoreOperationalPolicy {
  cityId: string;
  version: number;
  maxPauseSeconds: number;
  maxPreparationMinutes: number;
  changedByActor: string;
  changeReason: string;
  updatedAt: string;
}
function isCityStoreOperationalPolicy(value: unknown, cityID: string): value is CityStoreOperationalPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const fields = ["cityId", "version", "maxPauseSeconds", "maxPreparationMinutes",
    "changedByActor", "changeReason", "updatedAt"];
  return Object.keys(v).length === fields.length &&
    Object.keys(v).every((key) => fields.includes(key)) &&
    v.cityId === cityID &&
    Number.isSafeInteger(v.version) && Number(v.version) >= 1 &&
    Number.isSafeInteger(v.maxPauseSeconds) && Number(v.maxPauseSeconds) >= 0 &&
    Number(v.maxPauseSeconds) <= 31536000 &&
    Number.isSafeInteger(v.maxPreparationMinutes) && Number(v.maxPreparationMinutes) >= 0 &&
    Number(v.maxPreparationMinutes) <= 1440 &&
    typeof v.changedByActor === "string" && v.changedByActor.trim().length > 0 &&
    v.changedByActor.length <= 128 &&
    typeof v.changeReason === "string" && v.changeReason.trim().length > 0 &&
    v.changeReason.length <= 300 &&
    typeof v.updatedAt === "string" && Number.isFinite(Date.parse(v.updatedAt));
}
export async function getCityStoreOperationalPolicy(
  baseUrl: string, cityID: string, bearer: string, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicy> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityID)) throw new DshPublicError(0, "CITY_ID_INVALID");
  const body = await privateOwnerRequest(baseUrl,
    "/v1/operators/cities/" + encodeURIComponent(cityID) + "/store-availability-policy",
    bearer, "GET", undefined, signal);
  if (!isCityStoreOperationalPolicy(body, cityID)) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return body;
}

export interface CityStoreOperationalPolicyChange {
  operationId: string;
  expectedVersion: number;
  maxPauseSeconds: number;
  maxPreparationMinutes: number;
  reason: string;
}
export interface CityStoreOperationalPolicyResult {
  policy: CityStoreOperationalPolicy;
  replay: boolean;
}
/** A write can commit even when its transport response is lost. Keep the SAME
 * operationId for canonical readback/replay, never blindly create a new key. */
export async function replaceCityStoreOperationalPolicy(
  baseUrl: string, cityID: string, bearer: string,
  change: CityStoreOperationalPolicyChange, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicyResult> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityID)) throw new DshPublicError(0, "CITY_ID_INVALID");
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(change.operationId) ||
    !Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 0 ||
    !Number.isSafeInteger(change.maxPauseSeconds) || change.maxPauseSeconds < 0 ||
    change.maxPauseSeconds > 31536000 ||
    !Number.isSafeInteger(change.maxPreparationMinutes) || change.maxPreparationMinutes < 0 ||
    change.maxPreparationMinutes > 1440 ||
    typeof change.reason !== "string" || change.reason.trim().length < 1 ||
    Array.from(change.reason).length > 300) {
    throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  }
  const body = await privateOwnerRequest(baseUrl,
    "/v1/operators/cities/" + encodeURIComponent(cityID) + "/store-availability-policy",
    bearer, "PATCH", change, signal);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  const result = body as Record<string, unknown>;
  if (Object.keys(result).length !== 2 || !Object.hasOwn(result, "policy") ||
    !Object.hasOwn(result, "replay") ||
    typeof result.replay !== "boolean" || !isCityStoreOperationalPolicy(result.policy, cityID)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  return result as unknown as CityStoreOperationalPolicyResult;
}
