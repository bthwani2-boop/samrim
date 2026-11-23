import { DshPublicError, isDateTime, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type StoreRegistrationRelation = "MARKETPLACE" | "DIRECT";
export type OperatorStoreRegistrationPolicy = {
  cityId: string;
  relation: StoreRegistrationRelation;
  version: number;
  enabled: boolean;
  termsVersion?: string;
  termsText?: string;
  changedByActor?: string;
  changeReason?: string;
  updatedAt?: string;
};
export type OperatorStoreRegistrationChange = {
  operationId: string;
  expectedVersion: number;
  enabled: boolean;
  termsVersion: string;
  termsText: string;
  reason: string;
};
export type OperatorStoreRegistrationResult = {
  policy: OperatorStoreRegistrationPolicy;
  replay: boolean;
};

const publicId = /^[a-z0-9-]{1,64}$/;
const operationId = /^[A-Za-z0-9._-]{8,128}$/;
const termsVersionRule = /^[a-z0-9._-]{3,80}$/;
const basePolicyKeys = ["cityId", "relation", "version", "enabled"];
const fullPolicyKeys = [...basePolicyKeys, "termsVersion", "termsText", "changedByActor", "changeReason", "updatedAt"];

export function isOperatorStoreRegistrationPolicy(
  value: unknown, cityId: string, relation: StoreRegistrationRelation,
): value is OperatorStoreRegistrationPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  if (policy.cityId !== cityId || policy.relation !== relation ||
    !Number.isSafeInteger(policy.version) || Number(policy.version) < 0 ||
    typeof policy.enabled !== "boolean") return false;
  if (policy.version === 0) {
    return policy.enabled === false && onlyKeys(policy, basePolicyKeys);
  }
  return onlyKeys(policy, fullPolicyKeys) &&
    typeof policy.termsVersion === "string" && termsVersionRule.test(policy.termsVersion) &&
    typeof policy.termsText === "string" &&
    [...policy.termsText.trim()].length >= 1 && [...policy.termsText].length <= 4000 &&
    typeof policy.changedByActor === "string" && policy.changedByActor.trim().length > 0 &&
    [...policy.changedByActor].length <= 128 &&
    // Rows admitted before the additive audit migration have an empty reason.
    typeof policy.changeReason === "string" && [...policy.changeReason].length <= 300 &&
    isDateTime(policy.updatedAt);
}
function pathFor(cityId: string, relation: StoreRegistrationRelation, operationPath: string, bearer: string): string {
  if (!publicId.test(cityId) || (relation !== "MARKETPLACE" && relation !== "DIRECT")) {
    throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) throw new DshPublicError(401, "UNAUTHENTICATED");
  return operationPath.replace("{cityID}", cityId).replace("{relation}", relation);
}
export async function getOperatorStoreRegistrationPolicy(
  origin: string, cityId: string, relation: StoreRegistrationRelation, bearer: string,
  signal?: AbortSignal,
): Promise<OperatorStoreRegistrationPolicy> {
  const path = pathFor(cityId, relation, dshOperations.getOperatorStoreRegistrationPolicy.path, bearer);
  const body = await privateOwnerRequest(origin, path, bearer, "GET", undefined, signal);
  if (!isOperatorStoreRegistrationPolicy(body, cityId, relation)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return body;
}
export function validOperatorStoreRegistrationChange(value: unknown): value is OperatorStoreRegistrationChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return onlyKeys(v, ["operationId", "expectedVersion", "enabled", "termsVersion", "termsText", "reason"]) &&
    typeof v.operationId === "string" && operationId.test(v.operationId) &&
    Number.isSafeInteger(v.expectedVersion) && Number(v.expectedVersion) >= 0 &&
    typeof v.enabled === "boolean" &&
    typeof v.termsVersion === "string" && termsVersionRule.test(v.termsVersion) &&
    typeof v.termsText === "string" && [...v.termsText.trim()].length >= 1 &&
    [...v.termsText].length <= 4000 && !v.termsText.includes("\u0000") &&
    typeof v.reason === "string" && [...v.reason.trim()].length >= 1 &&
    [...v.reason].length <= 300 && ![...v.reason].some(char => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    });
}
/** An ambiguous PATCH outcome must retain its operationId and payload. */
export async function changeOperatorStoreRegistrationPolicy(
  origin: string, cityId: string, relation: StoreRegistrationRelation, bearer: string,
  change: OperatorStoreRegistrationChange, signal?: AbortSignal,
): Promise<OperatorStoreRegistrationResult> {
  const path = pathFor(cityId, relation, dshOperations.changeOperatorStoreRegistrationPolicy.path, bearer);
  if (!validOperatorStoreRegistrationChange(change)) {
    throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  }
  const body = await privateOwnerRequest(origin, path, bearer, "PATCH", change, signal);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  const result = body as Record<string, unknown>;
  if (typeof result.replay !== "boolean" || !onlyKeys(result, ["policy", "replay"]) ||
    !isOperatorStoreRegistrationPolicy(result.policy, cityId, relation)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  const policy = result.policy;
  if (policy.version !== change.expectedVersion + 1 ||
    policy.enabled !== change.enabled || policy.termsVersion !== change.termsVersion ||
    policy.termsText !== change.termsText.trim() ||
    policy.changeReason !== change.reason.trim()) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return { policy, replay: result.replay };
}
