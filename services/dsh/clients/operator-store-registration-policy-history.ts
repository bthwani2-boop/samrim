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

const cityRule = /^[a-z0-9-]{1,64}$/;
const positiveVersion = /^[1-9][0-9]{0,18}$/;
const termsRule = /^[a-z0-9._-]{3,80}$/;
const entryKeys = ["version", "enabled", "termsVersion", "changedByActor", "changeReason", "updatedAt"];

export function isStoreRegistrationPolicyHistoryPage(
  value: unknown, limit = 20,
): value is OperatorStoreRegistrationPolicyHistoryPage {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return false;
  const page = value as Record<string, unknown>;
  if (!onlyKeys(page, ["entries", "nextBeforeVersion"]) ||
    !Array.isArray(page.entries) || page.entries.length > limit) return false;
  let previous = Number.MAX_SAFE_INTEGER;
  for (const raw of page.entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const entry = raw as Record<string, unknown>;
    if (!onlyKeys(entry, entryKeys) || Object.keys(entry).length !== entryKeys.length ||
      !Number.isSafeInteger(entry.version) || Number(entry.version) < 1 ||
      Number(entry.version) >= previous || typeof entry.enabled !== "boolean" ||
      typeof entry.termsVersion !== "string" || !termsRule.test(entry.termsVersion) ||
      typeof entry.changedByActor !== "string" || !entry.changedByActor.trim() ||
      [...entry.changedByActor].length > 128 ||
      typeof entry.changeReason !== "string" || !entry.changeReason.trim() ||
      [...entry.changeReason].length > 300 || !isDateTime(entry.updatedAt)) {
      return false;
    }
    previous = Number(entry.version);
  }
  if (page.nextBeforeVersion === undefined) return true;
  return page.entries.length === limit && typeof page.nextBeforeVersion === "string" &&
    positiveVersion.test(page.nextBeforeVersion) &&
    String(page.entries[page.entries.length - 1]?.version) === page.nextBeforeVersion;
}

export async function listOperatorStoreRegistrationPolicyHistory(
  origin: string, cityId: string, relation: StoreRegistrationRelation, bearer: string,
  limit = 20, beforeVersion?: string, signal?: AbortSignal,
): Promise<OperatorStoreRegistrationPolicyHistoryPage> {
  if (!cityRule.test(cityId) || (relation !== "DIRECT" && relation !== "MARKETPLACE") ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    (beforeVersion !== undefined && !positiveVersion.test(beforeVersion))) {
    throw new DshPublicError(400, "INVALID_STORE_REGISTRATION");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) {
    throw new DshPublicError(401, "UNAUTHENTICATED");
  }
  const path = dshOperations.listOperatorStoreRegistrationPolicyHistory.path
    .replace("{cityID}", cityId).replace("{relation}", relation);
  const query = `?limit=${limit}${beforeVersion ? `&beforeVersion=${beforeVersion}` : ""}`;
  const result = await privateOwnerRequest(origin, path + query, bearer, "GET", undefined, signal);
  if (!isStoreRegistrationPolicyHistoryPage(result, limit)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return result;
}
