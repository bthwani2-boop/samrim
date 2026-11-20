/** DSH SDK entrypoint: keep the existing package exports stable. */
import { DshPublicError, endpoint, onlyKeys } from "./public-discovery.ts";

export type { PublicOffer, PublicPage, PublicStore, PublicVertical } from "./public-discovery.ts";
export {
  DshPublicError, getPublicStore, listPublicOffers, listPublicStores, listPublicVerticals,
} from "./public-discovery.ts";

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
  baseUrl: string, path: string, bearer: string, method: "GET" | "PATCH", change?: StoreOperationalChange | CityStoreOperationalPolicyChange | OperatorCaptainStandingChange, signal?: AbortSignal,
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
      if (err && typeof err === "object") {
        if ("code" in err && typeof err.code === "string") code = err.code;
        else if ("error" in err && typeof err.error === "string") code = err.error;
      }
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

/** Private Operator review reads. DSH owns Captain standing; these do not admit
 * an Identity role, decide standing or expose candidate identity/contact data. */
export const captainStandingStatuses = ["PENDING", "APPROVED", "SUSPENDED", "REVOKED"] as const;
export type CaptainStandingStatus = typeof captainStandingStatuses[number];
export interface OperatorCaptainStanding {
  actorId: string;
  status: CaptainStandingStatus;
  version: number;
}
export interface OperatorCaptainStandingPage {
  items: OperatorCaptainStanding[];
  nextCursor?: string;
}
const captainCursor = /^[A-Za-z0-9_-]{1,512}$/;
export function isCaptainStandingActorId(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value !== "." && value !== ".." &&
    value.trim() === value && !/[\r\n\t/\\]/.test(value) && !value.includes(String.fromCharCode(0)) &&
    !/[\uD800-\uDFFF]/u.test(value) && new TextEncoder().encode(value).byteLength <= 128;
}
function isCaptainStanding(value: unknown): value is OperatorCaptainStanding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 3 && onlyKeys(v, ["actorId", "status", "version"]) &&
    isCaptainStandingActorId(v.actorId) && captainStandingStatuses.includes(v.status as CaptainStandingStatus) &&
    Number.isSafeInteger(v.version) && Number(v.version) >= 1;
}
export async function listOperatorCaptainStandings(
  baseUrl: string, bearer: string,
  options: { status?: CaptainStandingStatus; cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<OperatorCaptainStandingPage> {
  const status = options.status ?? "PENDING";
  const limit = options.limit ?? 20;
  if (!captainStandingStatuses.includes(status) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    (options.cursor !== undefined && !captainCursor.test(options.cursor))) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  if (options.signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  const params = new URLSearchParams({ status });
  if (options.limit !== undefined) params.set("limit", String(limit));
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  const body = await privateOwnerRequest(baseUrl, `/v1/operators/captains?${params}`, bearer, "GET", undefined, options.signal);
  const page = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!page || !onlyKeys(page, ["items", "nextCursor"]) || !Array.isArray(page.items) ||
    page.items.length > limit || !page.items.every(item => isCaptainStanding(item) && item.status === status) ||
    new Set(page.items.map(item => item.actorId)).size !== page.items.length ||
    (page.nextCursor !== undefined && (typeof page.nextCursor !== "string" || !captainCursor.test(page.nextCursor)))) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  if (options.signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return page as unknown as OperatorCaptainStandingPage;
}
export interface OperatorCaptainStandingChange {
  status: "APPROVED" | "SUSPENDED" | "REVOKED";
  expectedVersion: number;
  operationId: string;
  reason: string;
}

export async function changeOperatorCaptainStanding(
  baseUrl: string, actorId: string, bearer: string,
  change: OperatorCaptainStandingChange, signal?: AbortSignal,
): Promise<OperatorCaptainStanding> {
  if (!isCaptainStandingActorId(actorId) ||
    !["APPROVED", "SUSPENDED", "REVOKED"].includes(change.status) ||
    !Number.isSafeInteger(change.expectedVersion) || change.expectedVersion < 1 ||
    !/^[A-Za-z0-9._-]{8,128}$/.test(change.operationId) ||
    typeof change.reason !== "string" || change.reason.trim() !== change.reason ||
    Array.from(change.reason).length < 1 || Array.from(change.reason).length > 300) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  const result = await privateOwnerRequest(baseUrl,
    `/v1/operators/captains/${encodeURIComponent(actorId)}/standing`, bearer, "PATCH", change, signal);
  if (!isCaptainStanding(result) || result.actorId !== actorId ||
    result.status !== change.status || result.version < change.expectedVersion) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  return result;
}

export async function getOperatorCaptainStanding(
  baseUrl: string, actorId: string, bearer: string, signal?: AbortSignal,
): Promise<OperatorCaptainStanding> {
  if (!isCaptainStandingActorId(actorId)) throw new DshPublicError(400, "INVALID_REQUEST");
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  const body = await privateOwnerRequest(baseUrl,
    `/v1/operators/captains/${encodeURIComponent(actorId)}/standing`, bearer, "GET", undefined, signal);
  if (!isCaptainStanding(body) || body.actorId !== actorId) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return body;
}

export type { CaptainApplicationStatus, CaptainStanding } from "./captain-standing.ts";
// DSH-owned Captain eligibility and application transport. No client-side role grant.
export {
  CaptainStandingError, captainStandingFrom, readApprovedCaptainStanding,
  readCaptainApplication, requestCaptainApplication,
} from "./captain-standing.ts";

// DSH-owned Merchant standing contract and transport.
export type { MerchantDSHStanding, MerchantOwnedStore } from "./merchant-standing.ts";
export { MerchantStandingError, readMerchantDSHStanding, standingFrom } from "./merchant-standing.ts";
