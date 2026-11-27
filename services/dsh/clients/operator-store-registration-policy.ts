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
const changeKeys = ["operationId", "expectedVersion", "enabled", "termsVersion", "termsText", "reason"];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validScope(city: unknown, relation: unknown): boolean {
  return typeof city === "string" && publicId.test(city)
    && (relation === "MARKETPLACE" || relation === "DIRECT");
}
function version(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// DSH uses Go strings.TrimSpace, whose Unicode White_Space set differs
// from JavaScript trim (notably NEL and BOM). Match the owner fingerprint.
function ownerTrim(value: string): string {
  return value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}
function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && !/\p{Cs}/u.test(value)
    && ownerTrim(value).length > 0 && [...value].length <= limit;
}
function validTerms(value: unknown): value is string {
  return boundedText(value, 4000) && !value.includes("\u0000");
}
function validReason(value: unknown): value is string {
  return boundedText(value, 300) && !/\p{Cc}/u.test(ownerTrim(value));
}
export function isStoreRegistrationPolicyActor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && ownerTrim(value) === value
    && !/[\p{Cc}\p{Cs}]/u.test(value) && new TextEncoder().encode(value).length <= 128;
}

export function isOperatorStoreRegistrationPolicy(
  value: unknown, cityId: string, relation: StoreRegistrationRelation,
): value is OperatorStoreRegistrationPolicy {
  if (!validScope(cityId, relation) || !record(value) || value.cityId !== cityId || value.relation !== relation
    || !version(value.version) || typeof value.enabled !== "boolean") return false;
  if (value.version === 0) return value.enabled === false && onlyKeys(value, basePolicyKeys);

  // The owner omits an empty reason for retained policies without an audit
  // reason. Such a read is not a valid confirmation of a new command.
  return onlyKeys(value, fullPolicyKeys)
    && typeof value.termsVersion === "string" && termsVersionRule.test(value.termsVersion)
    && validTerms(value.termsText) && isStoreRegistrationPolicyActor(value.changedByActor)
    && (value.changeReason === undefined || validReason(value.changeReason))
    && isDateTime(value.updatedAt);
}

export function validOperatorStoreRegistrationChange(value: unknown): value is OperatorStoreRegistrationChange {
  return record(value) && onlyKeys(value, changeKeys)
    && typeof value.operationId === "string" && operationId.test(value.operationId)
    && version(value.expectedVersion) && value.expectedVersion < Number.MAX_SAFE_INTEGER
    && typeof value.enabled === "boolean"
    && typeof value.termsVersion === "string" && termsVersionRule.test(value.termsVersion)
    && validTerms(value.termsText) && validReason(value.reason);
}

/** The SDK and browser must reconcile the same normalized owner receipt. */
export function matchesOperatorStoreRegistrationChange(
  policy: OperatorStoreRegistrationPolicy, change: OperatorStoreRegistrationChange,
  actorId?: string,
): boolean {
  return validOperatorStoreRegistrationChange(change)
    && (actorId === undefined || policy.changedByActor === actorId)
    && policy.version === change.expectedVersion + 1 && policy.enabled === change.enabled
    && policy.termsVersion === change.termsVersion
    && policy.termsText === ownerTrim(change.termsText)
    && policy.changeReason === ownerTrim(change.reason);
}

function scopedPath(cityId: string, relation: StoreRegistrationRelation, path: string, bearer: string): string {
  if (!validScope(cityId, relation)) throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) {
    throw new DshPublicError(401, "UNAUTHENTICATED");
  }
  return path.replace("{cityID}", cityId).replace("{relation}", relation);
}

export async function getOperatorStoreRegistrationPolicy(
  origin: string, cityId: string, relation: StoreRegistrationRelation, bearer: string,
  signal?: AbortSignal,
): Promise<OperatorStoreRegistrationPolicy> {
  const path = scopedPath(cityId, relation, dshOperations.getOperatorStoreRegistrationPolicy.path, bearer);
  const body = await privateOwnerRequest(origin, path, bearer, "GET", undefined, signal);
  if (!isOperatorStoreRegistrationPolicy(body, cityId, relation)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return body;
}

/** An ambiguous PATCH outcome must retain its operationId and payload. */
export async function changeOperatorStoreRegistrationPolicy(
  origin: string, cityId: string, relation: StoreRegistrationRelation, bearer: string,
  change: OperatorStoreRegistrationChange, signal?: AbortSignal,
): Promise<OperatorStoreRegistrationResult> {
  const path = scopedPath(cityId, relation, dshOperations.changeOperatorStoreRegistrationPolicy.path, bearer);
  if (!validOperatorStoreRegistrationChange(change)) {
    throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  }
  const result = await privateOwnerRequest(origin, path, bearer, "PATCH", change, signal);
  if (!record(result) || !onlyKeys(result, ["policy", "replay"]) || typeof result.replay !== "boolean"
    || !isOperatorStoreRegistrationPolicy(result.policy, cityId, relation)
    || !matchesOperatorStoreRegistrationChange(result.policy, change)) {
    throw new DshPublicError(502, "OPERATION_RESULT_UNKNOWN");
  }
  return { policy: result.policy, replay: result.replay };
}
