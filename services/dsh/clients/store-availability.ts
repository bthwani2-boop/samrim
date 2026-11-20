import { DshPublicError } from "./client-core.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

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
