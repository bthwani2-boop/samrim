import { DshPublicError, isDateTime, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import { isStoreRegistrationPolicyActor, type StoreRegistrationRelation } from "./operator-store-registration-policy.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type OperatorStoreRegistrationPolicyHistoryEntry = {
  version: number;
  enabled: boolean;
  termsVersion: string;
  changedByActor: string;
  changeReason: string;
  updatedAt: string;
};

export type OperatorStoreRegistrationPolicyHistoryPage = {
  entries: OperatorStoreRegistrationPolicyHistoryEntry[];
  nextBeforeVersion?: string;
};

const entryKeys = ["version", "enabled", "termsVersion", "changedByActor", "changeReason", "updatedAt"];
const maxOwnerVersion = 9223372036854775807n;
const pageLimit = 50;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= pageLimit;
}

function validCursor(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= maxOwnerVersion;
}

// The immutable command stores the Go-trimmed reason, not the submitted text.
function validReason(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && [...value].length <= 300
    && !/^\p{White_Space}|\p{White_Space}$/u.test(value)
    && !/[\p{Cc}\p{Cs}]/u.test(value);
}

function validEntry(value: unknown): value is OperatorStoreRegistrationPolicyHistoryEntry {
  return record(value) && onlyKeys(value, entryKeys) && Object.keys(value).length === entryKeys.length
    && typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version >= 1
    && typeof value.enabled === "boolean"
    && typeof value.termsVersion === "string" && /^[a-z0-9._-]{3,80}$/u.test(value.termsVersion)
    && isStoreRegistrationPolicyActor(value.changedByActor) && validReason(value.changeReason)
    && isDateTime(value.updatedAt);
}

export function isStoreRegistrationPolicyHistoryPage(
  value: unknown, limit = 20, beforeVersion?: string,
): value is OperatorStoreRegistrationPolicyHistoryPage {
  if (!validLimit(limit) || (beforeVersion !== undefined && !validCursor(beforeVersion))
    || !record(value) || !onlyKeys(value, ["entries", "nextBeforeVersion"])
    || !Array.isArray(value.entries) || value.entries.length > limit) return false;

  let previous = beforeVersion === undefined ? maxOwnerVersion + 1n : BigInt(beforeVersion);
  for (const entry of value.entries) {
    if (!validEntry(entry) || BigInt(entry.version) >= previous) return false;
    previous = BigInt(entry.version);
  }
  return value.nextBeforeVersion === undefined
    || (value.entries.length === limit && previous > 1n && value.nextBeforeVersion === String(previous));
}

export async function listOperatorStoreRegistrationPolicyHistory(
  origin: string, cityId: string, relation: StoreRegistrationRelation, bearer: string,
  limit = 20, beforeVersion?: string, signal?: AbortSignal,
): Promise<OperatorStoreRegistrationPolicyHistoryPage> {
  if (typeof cityId !== "string" || !/^[a-z0-9-]{1,64}$/u.test(cityId)
    || (relation !== "DIRECT" && relation !== "MARKETPLACE")
    || !validLimit(limit) || (beforeVersion !== undefined && !validCursor(beforeVersion))) {
    throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  }
  if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(bearer)) {
    throw new DshPublicError(401, "UNAUTHENTICATED");
  }

  const path = dshOperations.listOperatorStoreRegistrationPolicyHistory.path
    .replace("{cityID}", cityId).replace("{relation}", relation);
  const query = new URLSearchParams({ limit: String(limit) });
  if (beforeVersion !== undefined) query.set("beforeVersion", beforeVersion);

  // Per row: 300 reason scalars and 128 actor bytes may each require six
  // JSON escape bytes; 80 terms-version bytes and metadata fit in 3 KiB.
  // Scale with the actual requested page, with room for its envelope.
  const replyBytes = 128 + 3072 * limit;
  const result = await privateOwnerRequest(origin, path + "?" + query.toString(),
    bearer, "GET", undefined, signal, [200], replyBytes);
  if (!isStoreRegistrationPolicyHistoryPage(result, limit, beforeVersion)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return result;
}
