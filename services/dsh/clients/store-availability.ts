import { DshPublicError, isDateTime, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

/** DSH owns Store availability; the same wire contract serves native and browser projections. */
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function isStoreWeeklyWindow(value: unknown): value is StoreWeeklyWindow {
  const item = record(value);
  return item !== null && onlyKeys(item, ["weekday", "opens", "closes"]) &&
    Number.isSafeInteger(item.weekday) && Number(item.weekday) >= 0 && Number(item.weekday) <= 6 &&
    Number.isSafeInteger(item.opens) && Number(item.opens) >= 0 && Number(item.opens) < 1440 &&
    Number.isSafeInteger(item.closes) && Number(item.closes) >= 0 && Number(item.closes) <= 1440;
}
function isStoreAvailability(value: unknown, storeId: string): value is StoreOperationalAvailability {
  const item = record(value);
  return item !== null && onlyKeys(item, ["storeId", "timezone", "weekly", "pausedUntil", "preparationMinutes",
    "version", "actingActorId", "reason"]) && item.storeId === storeId && typeof item.timezone === "string" &&
    item.timezone.length >= 3 && item.timezone.length <= 64 && item.timezone !== "Local" &&
    (item.weekly === null || (Array.isArray(item.weekly) && item.weekly.every(isStoreWeeklyWindow))) &&
    (item.pausedUntil === undefined || isDateTime(item.pausedUntil)) &&
    Number.isSafeInteger(item.preparationMinutes) && Number(item.preparationMinutes) >= 0 &&
    Number.isSafeInteger(item.version) && Number(item.version) >= 1 &&
    typeof item.actingActorId === "string" && Array.from(item.actingActorId).length <= 128 &&
    typeof item.reason === "string" && Array.from(item.reason).length <= 300;
}
export function validStoreOperationalChange(value: unknown): value is StoreOperationalChange {
  const change = record(value);
  return change !== null && onlyKeys(change, ["operationId", "expectedVersion",
    "weekly", "pausedUntil", "preparationMinutes", "reason"]) &&
    typeof change.operationId === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(change.operationId) &&
    Number.isSafeInteger(change.expectedVersion) && Number(change.expectedVersion) >= 1 &&
    Number.isSafeInteger(change.preparationMinutes) && Number(change.preparationMinutes) >= 0 &&
    typeof change.reason === "string" && change.reason.trim().length >= 1 &&
    Array.from(change.reason).length <= 300 &&
    (change.pausedUntil === undefined || change.pausedUntil === null || isDateTime(change.pausedUntil)) &&
    Array.isArray(change.weekly) && change.weekly.every(isStoreWeeklyWindow);
}

export function parseStoreOperationalAvailability(value: unknown, storeId: string): StoreOperationalAvailability {
  if (!isStoreAvailability(value, storeId)) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return value;
}
export function confirmStoreOperationalResult(value: unknown, storeId: string, change: StoreOperationalChange): StoreOperationalResult {
  const result = record(value);
  if (!result || !onlyKeys(result, ["availability", "replay"]) || typeof result.replay !== "boolean" ||
    !isStoreAvailability(result.availability, storeId) ||
    result.availability.version !== change.expectedVersion + 1) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return { availability: result.availability, replay: result.replay };
}

function assertStoreId(storeId: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(storeId)) throw new DshPublicError(0, "STORE_ID_INVALID");
}

export async function getStoreOperationalAvailability(
  baseUrl: string, storeId: string, bearer: string, signal?: AbortSignal,
): Promise<StoreOperationalAvailability> {
  assertStoreId(storeId);
  const body = await privateOwnerRequest(baseUrl, dshOperations.getStoreOperationalAvailability.path.replace("{storeID}", encodeURIComponent(storeId)), bearer, "GET", undefined, signal);
  const availability = parseStoreOperationalAvailability(body, storeId);
  if (signal?.aborted) throw new DshPublicError(0, "OWNER_RESPONSE_STALE");
  return availability;
}

export async function updateStoreOperationalAvailability(
  baseUrl: string, storeId: string, bearer: string, change: StoreOperationalChange, signal?: AbortSignal,
): Promise<StoreOperationalResult> {
  if (!validStoreOperationalChange(change)) throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  assertStoreId(storeId);
  const body = await privateOwnerRequest(baseUrl, dshOperations.updateStoreOperationalAvailability.path.replace("{storeID}", encodeURIComponent(storeId)), bearer, "PATCH", change, signal);
  const result = confirmStoreOperationalResult(body, storeId, change);
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  return result;
}
