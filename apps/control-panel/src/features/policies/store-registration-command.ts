import {isOperatorStoreRegistrationPolicy,
  isStoreRegistrationPolicyHistoryPage,
  type OperatorStoreRegistrationChange, type OperatorStoreRegistrationPolicy,
  type OperatorStoreRegistrationPolicyHistoryPage,
  type StoreRegistrationRelation,
  validOperatorStoreRegistrationChange,
} from "@bthwani/dsh";

export type RegistrationPolicyResult =
  | { status: "confirmed"; current: OperatorStoreRegistrationPolicy; replay: boolean; superseded: boolean }
  | { status: "conflict" | "denied" | "rejected" | "unknown" };

export function parseRegistrationPolicy(
  value: unknown, cityId: string, relation: StoreRegistrationRelation,
): OperatorStoreRegistrationPolicy | null {
  return isOperatorStoreRegistrationPolicy(value, cityId, relation) ? value : null;
}

function matchesCommittedPolicy(
  policy: OperatorStoreRegistrationPolicy, actorId: string, change: OperatorStoreRegistrationChange,
) {
  return policy.version === change.expectedVersion + 1 &&
    policy.changedByActor === actorId &&
    policy.enabled === change.enabled &&
    policy.termsVersion === change.termsVersion &&
    policy.termsText === change.termsText.trim() &&
    policy.changeReason === change.reason.trim();
}

export async function readStoreRegistrationPolicy(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation, actorId: string,
): Promise<OperatorStoreRegistrationPolicy> {
  const response = await fetch(endpoint, {
    method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error",
    headers: { "X-BThwani-Operator": encodeURIComponent(actorId) },
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "Identity rejected the current policy grant" : "DSH policy unavailable");
  const policy = parseRegistrationPolicy(await response.json(), cityId, relation);
  if (!policy) throw new Error("DSH policy owner response invalid");
  return policy;
}

export type RegistrationOverviewEntry =
  | { status: "current"; policy: OperatorStoreRegistrationPolicy }
  | { status: "unavailable" };
export type RegistrationOverview = Record<StoreRegistrationRelation, RegistrationOverviewEntry>;

// Two independent DSH GETs: a failed read is UNKNOWN, never interpreted as closed admission.
export async function readRegistrationOverview(cityId: string, actorId: string): Promise<RegistrationOverview> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityId)) throw new Error("Invalid DSH city");
  const relations = ["MARKETPLACE", "DIRECT"] as const;
  const settled = await Promise.allSettled(relations.map(relation =>
    readStoreRegistrationPolicy(
      `/api/policies/cities/${cityId}/store-registration/${relation}`, cityId, relation, actorId,
    ),
  ));
  const result = (index: number): RegistrationOverviewEntry => {
    const entry = settled[index];
    return entry?.status === "fulfilled"
      ? { status: "current", policy: entry.value }
      : { status: "unavailable" };
  };
  return { MARKETPLACE: result(0), DIRECT: result(1) };
}

export async function readRegistrationHistory(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation,
  actorId: string, beforeVersion?: string,
): Promise<OperatorStoreRegistrationPolicyHistoryPage> {
  if (!/^[a-z0-9-]{1,64}$/.test(cityId) ||
    !["DIRECT", "MARKETPLACE"].includes(relation) ||
    endpoint !== `/api/policies/cities/${cityId}/store-registration/${relation}` ||
    (beforeVersion !== undefined && !/^[1-9][0-9]{0,18}$/.test(beforeVersion))) {
    throw new Error("Invalid DSH history scope");
  }
  const query = `?history=1&limit=10${beforeVersion ? `&beforeVersion=${beforeVersion}` : ""}`;
  const response = await fetch(endpoint + query, {
    method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error",
    headers: { "X-BThwani-Operator": encodeURIComponent(actorId) },
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? "Identity rejected the current policy grant" : "DSH policy audit unavailable");
  const result: unknown = await response.json();
  if (!isStoreRegistrationPolicyHistoryPage(result, 10)) {
    throw new Error("DSH policy audit owner response invalid");
  }
  if (beforeVersion !== undefined && result.entries.some(entry =>
    entry.version >= Number(beforeVersion))) {
    throw new Error("DSH policy audit cursor mismatch");
  }
  return result;
}

/** An uncertain write keeps its original operationId and full payload. */
export async function reconcileRegistrationPolicy(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation,
  actorId: string, change: OperatorStoreRegistrationChange,
): Promise<RegistrationPolicyResult> {
  if (!validOperatorStoreRegistrationChange(change)) return { status: "rejected" };
  try {
    const response = await fetch(endpoint, {
      method: "PATCH", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "X-BThwani-Operator": encodeURIComponent(actorId),
        "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    if (response.status === 409) return { status: "conflict" };
    if (response.status === 401 || response.status === 403) return { status: "denied" };
    if (response.status === 400) return { status: "rejected" };
    if (!response.ok) return { status: "unknown" };
    const envelope = await response.json() as { policy?: unknown; replay?: unknown } | null;
    const committed = parseRegistrationPolicy(envelope?.policy, cityId, relation);
    if (!committed || typeof envelope?.replay !== "boolean" ||
      !matchesCommittedPolicy(committed, actorId, change)) {
      return { status: "unknown" };
    }
    const current = await readStoreRegistrationPolicy(endpoint, cityId, relation, actorId);
    if (current.version < committed.version ||
      (current.version === committed.version && !matchesCommittedPolicy(current, actorId, change))) {
      return { status: "unknown" };
    }
    return { status: "confirmed", current, replay: envelope.replay,
      superseded: current.version > committed.version };
  } catch {
    return { status: "unknown" };
  }
}

export function matchesPendingPolicy(
  policy: OperatorStoreRegistrationPolicy, actorId: string, change: OperatorStoreRegistrationChange,
) {
  return matchesCommittedPolicy(policy, actorId, change);
}

export type PendingRegistrationPolicy = {
  cityId: string;
  relation: StoreRegistrationRelation;
  change: OperatorStoreRegistrationChange;
};
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function recoveryKey(actorId: string) {
  return `bthwani:store-registration-policy:pending:${encodeURIComponent(actorId)}`;
}
function validPendingRegistrationPolicy(value: unknown): value is PendingRegistrationPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as Record<string, unknown>;
  return Object.keys(pending).length === 3 &&
    typeof pending.cityId === "string" && /^[a-z0-9-]{1,64}$/.test(pending.cityId) &&
    (pending.relation === "MARKETPLACE" || pending.relation === "DIRECT") &&
    validOperatorStoreRegistrationChange(pending.change);
}
export function readPendingRegistrationPolicy(storage: RecoveryStorage, actorId: string): PendingRegistrationPolicy | null {
  const raw = storage.getItem(recoveryKey(actorId));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!validPendingRegistrationPolicy(value)) throw new Error("Invalid pending registration policy");
  return value;
}
function samePending(a: PendingRegistrationPolicy, b: PendingRegistrationPolicy) {
  return a.cityId === b.cityId && a.relation === b.relation &&
    a.change.operationId === b.change.operationId && a.change.expectedVersion === b.change.expectedVersion &&
    a.change.enabled === b.change.enabled && a.change.termsVersion === b.change.termsVersion &&
    a.change.termsText === b.change.termsText && a.change.reason === b.change.reason;
}
export function savePendingRegistrationPolicy(storage: RecoveryStorage, actorId: string, pending: PendingRegistrationPolicy) {
  const existing = readPendingRegistrationPolicy(storage, actorId);
  if (!validPendingRegistrationPolicy(pending) || (existing && !samePending(existing, pending))) {
    throw new Error("Another registration policy command is pending");
  }
  storage.setItem(recoveryKey(actorId), JSON.stringify(pending));
}
export function clearPendingRegistrationPolicy(storage: RecoveryStorage, actorId: string, pending: PendingRegistrationPolicy) {
  const existing = readPendingRegistrationPolicy(storage, actorId);
  if (!existing || !samePending(existing, pending)) throw new Error("Pending registration policy mismatch");
  storage.removeItem(recoveryKey(actorId));
}
