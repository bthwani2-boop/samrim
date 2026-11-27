import { DshPublicError, isDateTime, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import type { StoreRegistrationRelation } from "./operator-store-registration-policy.ts";
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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validLimit(limit: number): boolean {
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 50;
}

function validCursor(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= maxOwnerVersion;
}

function boundedText(value: unknown, max: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && [...value].length <= max;
}

function validEntry(value: unknown): value is OperatorStoreRegistrationPolicyHistoryEntry {
  return record(value) && onlyKeys(value, entryKeys) && Object.keys(value).length === entryKeys.length
    && typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version >= 1
    && typeof value.enabled === "boolean"
    && typeof value.termsVersion === "string" && /^[a-z0-9._-]{3,80}$/.test(value.termsVersion)
    && boundedText(value.changedByActor, 128) && boundedText(value.changeReason, 300)
    && isDateTime(value.updatedAt);
}

export function isStoreRegistrationPolicyHistoryPage(
  value: unknown,
  limit = 20,
): value is OperatorStoreRegistrationPolicyHistoryPage {
  if (!validLimit(limit) || !record(value) || !onlyKeys(value, ["entries", "nextBeforeVersion"])
    || !Array.isArray(value.entries) || value.entries.length > limit) return false;

  let previous = Infinity;
  for (const entry of value.entries) {
    if (!validEntry(entry) || entry.version >= previous) return false;
    previous = entry.version;
  }

  return value.nextBeforeVersion === undefined
    || (value.entries.length === limit && previous > 1 && value.nextBeforeVersion === String(previous));
}

export async function listOperatorStoreRegistrationPolicyHistory(
  origin: string,
  cityId: string,
  relation: StoreRegistrationRelation,
  bearer: string,
  limit = 20,
  beforeVersion?: string,
  signal?: AbortSignal,
): Promise<OperatorStoreRegistrationPolicyHistoryPage> {
  if (typeof cityId !== "string" || !/^[a-z0-9-]{1,64}$/.test(cityId)
    || (relation !== "DIRECT" && relation !== "MARKETPLACE")
    || !validLimit(limit) || (beforeVersion !== undefined && !validCursor(beforeVersion))) {
    throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  }
  if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(bearer)) {
    throw new DshPublicError(401, "UNAUTHENTICATED");
  }

  const path = dshOperations.listOperatorStoreRegistrationPolicyHistory.path
    .replace("{cityID}", cityId).replace("{relation}", relation);
  const query = new URLSearchParams({ limit: String(limit) });
  if (beforeVersion !== undefined) query.set("beforeVersion", beforeVersion);
  const result = await privateOwnerRequest(origin, path + "?" + query.toString(), bearer, "GET", undefined, signal);

  if (!isStoreRegistrationPolicyHistoryPage(result, limit)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  const first = result.entries[0];
  if (beforeVersion !== undefined && first !== undefined && BigInt(first.version) >= BigInt(beforeVersion)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return result;
}
