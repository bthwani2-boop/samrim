import {
  isOperatorStoreRegistrationPolicy,
  isStoreRegistrationPolicyActor,
  isStoreRegistrationPolicyHistoryPage,
  matchesOperatorStoreRegistrationChange,
  type OperatorStoreRegistrationChange,
  type OperatorStoreRegistrationPolicy,
  type OperatorStoreRegistrationPolicyHistoryPage,
  type StoreRegistrationRelation,
  validOperatorStoreRegistrationChange,
} from "@bthwani/dsh";
import { policyRecord, requestPolicyOwner } from "./policy-owner-web.ts";

export type RegistrationPolicyResult =
  | { status: "confirmed"; current: OperatorStoreRegistrationPolicy; replay: boolean; superseded: boolean }
  | { status: "conflict" | "denied" | "rejected" | "unknown" };

type RegistrationOverviewEntry =
  | { status: "current"; policy: OperatorStoreRegistrationPolicy }
  | { status: "unavailable" };
export type RegistrationOverview = Record<StoreRegistrationRelation, RegistrationOverviewEntry>;

export type PendingRegistrationPolicy = {
  cityId: string;
  relation: StoreRegistrationRelation;
  change: OperatorStoreRegistrationChange;
};
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const cityRule = /^[a-z0-9-]{1,64}$/u;
const historyLimit = 10;

function validLocation(city: unknown, relation: unknown): boolean {
  return typeof city === "string" && cityRule.test(city)
    && (relation === "MARKETPLACE" || relation === "DIRECT");
}
function actorBinding(actor: string): string {
  if (!isStoreRegistrationPolicyActor(actor)) throw new Error("Invalid registration policy scope");
  return encodeURIComponent(actor);
}
function endpointFor(cityId: string, relation: StoreRegistrationRelation): string {
  if (!validLocation(cityId, relation)) throw new Error("Invalid registration policy scope");
  return "/api/policies/cities/" + cityId + "/store-registration/" + relation;
}
function assertScope(endpoint: string, cityId: string, relation: StoreRegistrationRelation, actorId: string): void {
  if (endpoint !== endpointFor(cityId, relation)) throw new Error("Invalid registration policy scope");
  actorBinding(actorId);
}
function validCursor(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/u.test(value)
    && BigInt(value) <= 9223372036854775807n;
}
async function readPrivateReply(endpoint: string, actorId: string, unavailable: string): Promise<unknown> {
  const reply = await requestPolicyOwner(endpoint, actorId);
  if (reply.status !== 200) {
    throw new Error(reply.status === 401 || reply.status === 403
      ? "Identity rejected the current policy grant" : unavailable);
  }
  return reply.document;
}
export function parseRegistrationPolicy(
  value: unknown, cityId: string, relation: StoreRegistrationRelation,
): OperatorStoreRegistrationPolicy | null {
  return validLocation(cityId, relation) && isOperatorStoreRegistrationPolicy(value, cityId, relation) ? value : null;
}
export async function readStoreRegistrationPolicy(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation, actorId: string,
): Promise<OperatorStoreRegistrationPolicy> {
  assertScope(endpoint, cityId, relation, actorId);
  const policy = parseRegistrationPolicy(await readPrivateReply(endpoint, actorId, "DSH policy unavailable"), cityId, relation);
  if (!policy) throw new Error("DSH policy owner response invalid");
  return policy;
}
export async function readRegistrationOverview(cityId: string, actorId: string): Promise<RegistrationOverview> {
  if (typeof cityId !== "string" || !cityRule.test(cityId)) throw new Error("Invalid DSH city");
  actorBinding(actorId);
  const read = async (relation: StoreRegistrationRelation): Promise<RegistrationOverviewEntry> => {
    try {
      return { status: "current", policy: await readStoreRegistrationPolicy(endpointFor(cityId, relation), cityId, relation, actorId) };
    } catch { return { status: "unavailable" }; }
  };
  const [MARKETPLACE, DIRECT] = await Promise.all([read("MARKETPLACE"), read("DIRECT")]);
  return { MARKETPLACE, DIRECT };
}
export async function readRegistrationHistory(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation, actorId: string, beforeVersion?: string,
): Promise<OperatorStoreRegistrationPolicyHistoryPage> {
  if (beforeVersion !== undefined && !validCursor(beforeVersion)) throw new Error("Invalid DSH history scope");
  assertScope(endpoint, cityId, relation, actorId);
  const query = new URLSearchParams({ history: "1", limit: String(historyLimit) });
  if (beforeVersion !== undefined) query.set("beforeVersion", beforeVersion);
  const result = await readPrivateReply(endpoint + "?" + query.toString(), actorId, "DSH policy audit unavailable");
  if (!isStoreRegistrationPolicyHistoryPage(result, historyLimit, beforeVersion)) {
    throw new Error("DSH policy audit owner response invalid or cursor mismatch");
  }
  return result;
}
export function matchesPendingPolicy(
  policy: OperatorStoreRegistrationPolicy, actorId: string, change: OperatorStoreRegistrationChange,
): boolean {
  return matchesOperatorStoreRegistrationChange(policy, change, actorId);
}

/** A detached command is reconciled only against admitted receipts and current owner evidence. */
export async function reconcileRegistrationPolicy(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation,
  actorId: string, change: OperatorStoreRegistrationChange,
): Promise<RegistrationPolicyResult> {
  try { assertScope(endpoint, cityId, relation, actorId); } catch { return { status: "rejected" }; }
  const submitted = { ...change };
  if (!validOperatorStoreRegistrationChange(submitted)) return { status: "rejected" };
  try {
    const reply = await requestPolicyOwner(endpoint, actorId, "PATCH", submitted);
    if (reply.status === 409) return { status: "conflict" };
    if (reply.status === 401 || reply.status === 403) return { status: "denied" };
    if (reply.status === 400) return { status: "rejected" };
    const envelope = reply.document;
    if (!policyRecord(envelope) || Object.keys(envelope).length !== 2 || typeof envelope.replay !== "boolean") return { status: "unknown" };
    const committed = parseRegistrationPolicy(envelope.policy, cityId, relation);
    if (!committed || !matchesPendingPolicy(committed, actorId, submitted)) return { status: "unknown" };
    const current = await readStoreRegistrationPolicy(endpoint, cityId, relation, actorId);
    if (current.version < committed.version
      || (current.version === committed.version && (!matchesPendingPolicy(current, actorId, submitted)
        || current.updatedAt !== committed.updatedAt))) return { status: "unknown" };
    return { status: "confirmed", current, replay: envelope.replay, superseded: current.version > committed.version };
  } catch { return { status: "unknown" }; }
}
function recoveryKey(actorId: string): string {
  return "bthwani:store-registration-policy:pending:" + actorBinding(actorId);
}
function validPending(value: unknown): value is PendingRegistrationPolicy {
  return policyRecord(value) && Object.keys(value).length === 3 && validLocation(value.cityId, value.relation)
    && validOperatorStoreRegistrationChange(value.change);
}
export function readPendingRegistrationPolicy(storage: RecoveryStorage, actorId: string): PendingRegistrationPolicy | null {
  const raw = storage.getItem(recoveryKey(actorId));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!validPending(value)) throw new Error("Invalid pending registration policy");
  return value;
}
function samePending(a: PendingRegistrationPolicy, b: PendingRegistrationPolicy): boolean {
  return a.cityId === b.cityId && a.relation === b.relation
    && a.change.operationId === b.change.operationId && a.change.expectedVersion === b.change.expectedVersion
    && a.change.enabled === b.change.enabled && a.change.termsVersion === b.change.termsVersion
    && a.change.termsText === b.change.termsText && a.change.reason === b.change.reason;
}
export function savePendingRegistrationPolicy(storage: RecoveryStorage, actorId: string, pending: PendingRegistrationPolicy): void {
  const existing = readPendingRegistrationPolicy(storage, actorId);
  if (!validPending(pending) || (existing && !samePending(existing, pending))) {
    throw new Error("Another registration policy command is pending");
  }
  storage.setItem(recoveryKey(actorId), JSON.stringify(pending));
}
export function clearPendingRegistrationPolicy(storage: RecoveryStorage, actorId: string, pending: PendingRegistrationPolicy): void {
  const existing = readPendingRegistrationPolicy(storage, actorId);
  if (!existing || !samePending(existing, pending)) throw new Error("Pending registration policy mismatch");
  storage.removeItem(recoveryKey(actorId));
}
