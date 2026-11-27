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

const cityRule = /^[a-z0-9-]{1,64}$/;
const maxReplyBytes = 65_536;
const historyLimit = 10;

function validLocation(city: unknown, relation: unknown): boolean {
  return typeof city === "string" && cityRule.test(city)
    && (relation === "MARKETPLACE" || relation === "DIRECT");
}

function actorBinding(actor: string): string {
  if (!isStoreRegistrationPolicyActor(actor)) {
    throw new Error("Invalid registration policy scope");
  }
  return encodeURIComponent(actor);
}

function endpointFor(cityId: string, relation: StoreRegistrationRelation): string {
  if (!validLocation(cityId, relation)) throw new Error("Invalid registration policy scope");
  return "/api/policies/cities/" + cityId + "/store-registration/" + relation;
}

function scopedHeaders(endpoint: string, cityId: string, relation: StoreRegistrationRelation, actorId: string) {
  if (endpoint !== endpointFor(cityId, relation)) throw new Error("Invalid registration policy scope");
  return { "X-BThwani-Operator": actorBinding(actorId) };
}

function validCursor(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value)
    && BigInt(value) <= 9223372036854775807n;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Cancellation is cleanup only; its failure cannot confirm a rejected command.
async function discard(acquire: () => { cancel(): Promise<void> } | null): Promise<void> {
  try {
    await acquire()?.cancel();
  } catch {
    // Preserve the original response classification.
  }
}

function discardResponse(response: Response): void {
  void discard(() => response.body?.locked ? null : response.body);
}

async function readReply(response: Response): Promise<unknown> {
  const length = response.headers.get("Content-Length");
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    || (length !== null && (!/^\d+$/.test(length) || Number(length) > maxReplyBytes))
    || !response.body || response.body.locked) {
    discardResponse(response);
    throw new Error("DSH policy owner response invalid");
  }

  const reader = response.body.getReader();
  let complete = false;
  try {
    const bytes = new Uint8Array(maxReplyBytes);
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > maxReplyBytes - size) throw new Error("Oversized response");
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
    complete = true;
    return result;
  } catch {
    throw new Error("DSH policy owner response invalid");
  } finally {
    if (!complete) void discard(() => reader);
    reader.releaseLock();
  }
}

async function request(
  endpoint: string, headers: Record<string, string>, change?: OperatorStoreRegistrationChange,
): Promise<Response> {
  return fetch(endpoint, {
    method: change === undefined ? "GET" : "PATCH",
    cache: "no-store", credentials: "same-origin", redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: change === undefined ? headers : { ...headers, "Content-Type": "application/json" },
    ...(change === undefined ? {} : { body: JSON.stringify(change) }),
  });
}

async function readPrivateReply(endpoint: string, headers: Record<string, string>, unavailable: string): Promise<unknown> {
  const response = await request(endpoint, headers);
  if (response.status !== 200) {
    discardResponse(response);
    throw new Error(response.status === 401 || response.status === 403
      ? "Identity rejected the current policy grant" : unavailable);
  }
  return readReply(response);
}

export function parseRegistrationPolicy(
  value: unknown, cityId: string, relation: StoreRegistrationRelation,
): OperatorStoreRegistrationPolicy | null {
  return validLocation(cityId, relation) && isOperatorStoreRegistrationPolicy(value, cityId, relation) ? value : null;
}

export async function readStoreRegistrationPolicy(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation, actorId: string,
): Promise<OperatorStoreRegistrationPolicy> {
  const headers = scopedHeaders(endpoint, cityId, relation, actorId);
  const policy = parseRegistrationPolicy(await readPrivateReply(endpoint, headers, "DSH policy unavailable"), cityId, relation);
  if (!policy) throw new Error("DSH policy owner response invalid");
  return policy;
}

export async function readRegistrationOverview(cityId: string, actorId: string): Promise<RegistrationOverview> {
  if (typeof cityId !== "string" || !cityRule.test(cityId)) throw new Error("Invalid DSH city");
  actorBinding(actorId);
  const read = async (relation: StoreRegistrationRelation): Promise<RegistrationOverviewEntry> => {
    try {
      return { status: "current", policy: await readStoreRegistrationPolicy(endpointFor(cityId, relation), cityId, relation, actorId) };
    } catch {
      return { status: "unavailable" };
    }
  };
  const [MARKETPLACE, DIRECT] = await Promise.all([read("MARKETPLACE"), read("DIRECT")]);
  return { MARKETPLACE, DIRECT };
}

export async function readRegistrationHistory(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation,
  actorId: string, beforeVersion?: string,
): Promise<OperatorStoreRegistrationPolicyHistoryPage> {
  if (beforeVersion !== undefined && !validCursor(beforeVersion)) throw new Error("Invalid DSH history scope");
  const headers = scopedHeaders(endpoint, cityId, relation, actorId);
  const query = new URLSearchParams({ history: "1", limit: String(historyLimit) });
  if (beforeVersion !== undefined) query.set("beforeVersion", beforeVersion);
  const result = await readPrivateReply(endpoint + "?" + query.toString(), headers, "DSH policy audit unavailable");
  if (!isStoreRegistrationPolicyHistoryPage(result, historyLimit)) throw new Error("DSH policy audit owner response invalid");
  const first = result.entries[0];
  if (beforeVersion !== undefined && first !== undefined && BigInt(first.version) >= BigInt(beforeVersion)) {
    throw new Error("DSH policy audit cursor mismatch");
  }
  return result;
}

export function matchesPendingPolicy(
  policy: OperatorStoreRegistrationPolicy, actorId: string, change: OperatorStoreRegistrationChange,
): boolean {
  return matchesOperatorStoreRegistrationChange(policy, change, actorId);
}

/** An uncertain write keeps its original operationId and full payload. */
export async function reconcileRegistrationPolicy(
  endpoint: string, cityId: string, relation: StoreRegistrationRelation,
  actorId: string, change: OperatorStoreRegistrationChange,
): Promise<RegistrationPolicyResult> {
  let headers: Record<string, string>;
  try {
    headers = scopedHeaders(endpoint, cityId, relation, actorId);
  } catch {
    return { status: "rejected" };
  }
  if (!validOperatorStoreRegistrationChange(change)) return { status: "rejected" };
  try {
    const response = await request(endpoint, headers, change);
    if (response.status !== 200) {
      discardResponse(response);
      if (response.status === 409) return { status: "conflict" };
      if (response.status === 401 || response.status === 403) return { status: "denied" };
      if (response.status === 400) return { status: "rejected" };
      return { status: "unknown" };
    }
    const envelope = await readReply(response);
    if (!record(envelope) || Object.keys(envelope).length !== 2 || typeof envelope.replay !== "boolean") return { status: "unknown" };
    const committed = parseRegistrationPolicy(envelope.policy, cityId, relation);
    if (!committed || !matchesPendingPolicy(committed, actorId, change)) return { status: "unknown" };

    const current = await readStoreRegistrationPolicy(endpoint, cityId, relation, actorId);
    if (current.version < committed.version
      || (current.version === committed.version && !matchesPendingPolicy(current, actorId, change))) {
      return { status: "unknown" };
    }
    return { status: "confirmed", current, replay: envelope.replay, superseded: current.version > committed.version };
  } catch {
    return { status: "unknown" };
  }
}

function recoveryKey(actorId: string): string {
  return "bthwani:store-registration-policy:pending:" + actorBinding(actorId);
}

function validPending(value: unknown): value is PendingRegistrationPolicy {
  return record(value) && Object.keys(value).length === 3 && validLocation(value.cityId, value.relation)
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
