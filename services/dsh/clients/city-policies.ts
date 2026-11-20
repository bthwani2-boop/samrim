import { DshPublicError } from "./client-core.ts";
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
