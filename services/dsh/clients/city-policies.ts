import { DshPublicError, isDateTime, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

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
    Array.from(v.changedByActor).length <= 128 &&
    typeof v.changeReason === "string" && v.changeReason.trim().length > 0 &&
    Array.from(v.changeReason).length <= 300 &&
    isDateTime(v.updatedAt);
}
export async function getCityStoreOperationalPolicy(
  baseUrl: string, cityID: string, bearer: string, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicy> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityID)) throw new DshPublicError(0, "CITY_ID_INVALID");
  const body = await privateOwnerRequest(baseUrl,
    dshOperations.getCityStoreOperationalPolicy.path.replace("{cityID}", encodeURIComponent(cityID)),
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
  if (!change || typeof change !== "object" || Array.isArray(change) ||
    !onlyKeys(change as unknown as Record<string, unknown>, [
      "operationId", "expectedVersion", "maxPauseSeconds", "maxPreparationMinutes", "reason",
    ]) || typeof change.operationId !== "string" || !/^[A-Za-z0-9._-]{8,128}$/.test(change.operationId) ||
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
    dshOperations.replaceCityStoreOperationalPolicy.path.replace("{cityID}", encodeURIComponent(cityID)),
    bearer, "PATCH", change, signal);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  const result = body as Record<string, unknown>;
  if (Object.keys(result).length !== 2 || !Object.hasOwn(result, "policy") ||
    !Object.hasOwn(result, "replay") ||
    typeof result.replay !== "boolean" || !isCityStoreOperationalPolicy(result.policy, cityID) ||
    result.policy.version !== change.expectedVersion + 1) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  if (signal?.aborted) throw new DshPublicError(0, "OPERATION_RESULT_UNKNOWN");
  return result as unknown as CityStoreOperationalPolicyResult;
}

export interface CityStoreOperationalPolicyHistoryPage {
  cityId: string;
  entries: CityStoreOperationalPolicy[];
  nextBeforeVersion?: string;
}

const validHistoryVersion = (value: string) =>
  /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value));

export function isCityStoreOperationalPolicyHistoryPage(
  value: unknown, cityId: string, limit: number, beforeVersion?: string,
): value is CityStoreOperationalPolicyHistoryPage {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      (beforeVersion !== undefined && !validHistoryVersion(beforeVersion))) return false;
  const page = value as Record<string, unknown>;
  if (!onlyKeys(page, ["cityId", "entries", "nextBeforeVersion"]) || page.cityId !== cityId ||
      !Array.isArray(page.entries) || page.entries.length > limit) return false;
  let previous = beforeVersion === undefined ? Number.POSITIVE_INFINITY : Number(beforeVersion);
  for (const item of page.entries) {
    if (!isCityStoreOperationalPolicy(item, cityId) || item.version >= previous) return false;
    previous = item.version;
  }
  return page.nextBeforeVersion === undefined ||
    (page.entries.length === limit && typeof page.nextBeforeVersion === "string" &&
      validHistoryVersion(page.nextBeforeVersion) && page.nextBeforeVersion === String(previous));
}

export async function listCityStoreOperationalPolicyHistory(
  baseUrl: string, cityId: string, bearer: string, limit = 20, beforeVersion?: string, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicyHistoryPage> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      (beforeVersion !== undefined && !validHistoryVersion(beforeVersion))) {
    throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  }
  const path = dshOperations.listCityStoreOperationalPolicyHistory.path.replace("{cityID}", cityId);
  const params = new URLSearchParams({ limit: String(limit) });
  if (beforeVersion) params.set("beforeVersion", beforeVersion);
  const page = await privateOwnerRequest(baseUrl, path + "?" + params.toString(), bearer, "GET", undefined, signal);
  if (!isCityStoreOperationalPolicyHistoryPage(page, cityId, limit, beforeVersion)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return page;
}

export interface CityDeliveryDistanceBand {
  upToMeters: number | null;
  ratePerKmMinor: number;
}
export interface CityDeliveryPolicy {
  cityId: string;
  version: number;
  radiusMetres: number;
  updatedAt: string;
  distanceBands?: CityDeliveryDistanceBand[];
}
export interface CityDeliveryPolicyPreviewInput {
  expectedVersion: number;
  radiusMetres: number;
  distanceMetres: number;
  distanceBands: CityDeliveryDistanceBand[];
}
export interface CityDeliveryPolicyPreview {
  cityId: string;
  version: number;
  radiusMetres: number;
  distanceMetres: number;
  feeYer: string;
  payable: false;
}
export function isCityDeliveryDistanceBands(value: unknown): value is CityDeliveryDistanceBand[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) return false;
  let previous = 0;
  return value.every((band, index) => {
    if (!band || typeof band !== "object" || Array.isArray(band) ||
        Object.keys(band).length !== 2 || !onlyKeys(band, ["upToMeters", "ratePerKmMinor"]) ||
        !Number.isSafeInteger(band.ratePerKmMinor) || band.ratePerKmMinor < 1 || band.ratePerKmMinor > 100000000) return false;
    if (index === value.length - 1) return band.upToMeters === null;
    if (!Number.isSafeInteger(band.upToMeters) || band.upToMeters <= previous || band.upToMeters > 500000) return false;
    previous = band.upToMeters;
    return true;
  });
}
export function isCityDeliveryPolicyPreviewInput(value: unknown): value is CityDeliveryPolicyPreviewInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 4 && onlyKeys(v, ["expectedVersion", "radiusMetres", "distanceMetres", "distanceBands"]) &&
    Number.isSafeInteger(v.expectedVersion) && Number(v.expectedVersion) >= 1 &&
    Number.isSafeInteger(v.radiusMetres) && Number(v.radiusMetres) >= 1 && Number(v.radiusMetres) <= 2147483647 &&
    Number.isSafeInteger(v.distanceMetres) && Number(v.distanceMetres) >= 0 && Number(v.distanceMetres) <= Number(v.radiusMetres) &&
    isCityDeliveryDistanceBands(v.distanceBands);
}
export function isCityDeliveryPolicyPreview(value: unknown, cityId: string, input: CityDeliveryPolicyPreviewInput): value is CityDeliveryPolicyPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 6 && onlyKeys(v, ["cityId", "version", "radiusMetres", "distanceMetres", "feeYer", "payable"]) &&
    v.cityId === cityId && v.version === input.expectedVersion && v.radiusMetres === input.radiusMetres &&
    v.distanceMetres === input.distanceMetres && v.payable === false &&
    typeof v.feeYer === "string" && /^(0|[1-9][0-9]{0,18})$/.test(v.feeYer) &&
    BigInt(v.feeYer) <= BigInt(input.distanceMetres) * 100000n &&
    (input.distanceMetres === 0 || v.feeYer !== "0");
}
export function isCityDeliveryPolicy(value: unknown, cityId: string): value is CityDeliveryPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === (Object.hasOwn(v, "distanceBands") ? 5 : 4) &&
    onlyKeys(v, ["cityId", "version", "radiusMetres", "updatedAt", "distanceBands"]) &&
    (!Object.hasOwn(v, "distanceBands") || isCityDeliveryDistanceBands(v.distanceBands)) &&
    v.cityId === cityId && Number.isSafeInteger(v.version) && Number(v.version) >= 1 &&
    Number.isSafeInteger(v.radiusMetres) && Number(v.radiusMetres) >= 1 &&
    Number(v.radiusMetres) <= 2147483647 && isDateTime(v.updatedAt);
}
export async function getCityDeliveryPolicy(
  baseUrl: string, cityId: string, bearer: string, signal?: AbortSignal,
): Promise<CityDeliveryPolicy> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityId)) throw new DshPublicError(400, "CITY_ID_INVALID");
  const body = await privateOwnerRequest(baseUrl,
    dshOperations.getCityDeliveryPolicy.path.replace("{cityID}", cityId), bearer, "GET", undefined, signal);
  if (!isCityDeliveryPolicy(body, cityId)) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return body;
}

export async function previewCityDeliveryPolicy(
  baseUrl: string, cityId: string, bearer: string, input: CityDeliveryPolicyPreviewInput, signal?: AbortSignal,
): Promise<CityDeliveryPolicyPreview> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityId) || !isCityDeliveryPolicyPreviewInput(input)) throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  const path = dshOperations.previewCityDeliveryPolicy.path.replace("{cityID}", cityId);
  const body = await privateOwnerRequest(baseUrl, path, bearer, "POST", input, signal);
  if (!isCityDeliveryPolicyPreview(body, cityId, input)) throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  return body;
}

export interface CityDeliveryPolicyChange {
  operationId: string;
  expectedVersion: number;
  radiusMetres: number;
  distanceBands: CityDeliveryDistanceBand[];
  reason: string;
}
export interface CityDeliveryPolicyResult {
  policy: CityDeliveryPolicy;
  replay: boolean;
}
export function isCityDeliveryPolicyChange(value: unknown): value is CityDeliveryPolicyChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 5 &&
    onlyKeys(v, ["operationId", "expectedVersion", "radiusMetres", "distanceBands", "reason"]) &&
    typeof v.operationId === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(v.operationId) &&
    Number.isSafeInteger(v.expectedVersion) && Number(v.expectedVersion) >= 1 && Number(v.expectedVersion) < Number.MAX_SAFE_INTEGER &&
    Number.isSafeInteger(v.radiusMetres) && Number(v.radiusMetres) >= 1 && Number(v.radiusMetres) <= 2147483647 &&
    isCityDeliveryDistanceBands(v.distanceBands) && typeof v.reason === "string" &&
    v.reason.trim().length > 0 && Array.from(v.reason).length <= 300;
}
export function matchesCityDeliveryPolicy(policy: CityDeliveryPolicy, change: CityDeliveryPolicyChange) {
  return policy.version === change.expectedVersion + 1 && policy.radiusMetres === change.radiusMetres &&
    !!policy.distanceBands && policy.distanceBands.length === change.distanceBands.length &&
    policy.distanceBands.every((band, index) => band.upToMeters === change.distanceBands[index]?.upToMeters &&
      band.ratePerKmMinor === change.distanceBands[index]?.ratePerKmMinor);
}
export function isCityDeliveryPolicyResult(value: unknown, cityId: string, change: CityDeliveryPolicyChange): value is CityDeliveryPolicyResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && onlyKeys(v, ["policy", "replay"]) &&
    typeof v.replay === "boolean" && isCityDeliveryPolicy(v.policy, cityId) && matchesCityDeliveryPolicy(v.policy, change);
}
export async function replaceCityDeliveryPolicy(
  baseUrl: string, cityId: string, bearer: string, change: CityDeliveryPolicyChange, signal?: AbortSignal,
): Promise<CityDeliveryPolicyResult> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityId) || !isCityDeliveryPolicyChange(change)) throw new DshPublicError(400, "INVALID_OPERATIONAL_CHANGE");
  const path = dshOperations.replaceCityDeliveryPolicy.path.replace("{cityID}", cityId);
  const value = await privateOwnerRequest(baseUrl, path, bearer, "PATCH", change, signal);
  if (!isCityDeliveryPolicyResult(value, cityId, change) || signal?.aborted) throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  return value;
}
