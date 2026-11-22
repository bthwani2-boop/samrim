import {isOperatorStoreRegistrationPolicy,
  type OperatorStoreRegistrationChange, type OperatorStoreRegistrationPolicy,
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
