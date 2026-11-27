import {
  type CityStoreOperationalPolicy as CityPolicy, type CityStoreOperationalPolicyChange as CityPolicyChange,
  type CityStoreOperationalPolicyHistoryPage, isCityStoreOperationalPolicyHistoryPage, isStoreRegistrationPolicyActor,
} from "@bthwani/dsh";
import { policyRecord, requestPolicyOwner } from "./policy-owner-web.ts";

export type { CityStoreOperationalPolicy as CityPolicy, CityStoreOperationalPolicyChange as CityPolicyChange } from "@bthwani/dsh";

export function parseCityPolicy(value: unknown, cityId: string): CityPolicy | null {
  const page = { cityId, entries: [value] };
  return isCityStoreOperationalPolicyHistoryPage(page, cityId, 1) ? page.entries[0] ?? null : null;
}
type CommandResult =
  | { status: "confirmed"; current: CityPolicy; replay: boolean; superseded: boolean }
  | { status: "conflict" | "denied" | "rejected" | "unknown" };

function validScope(endpoint: string, city: string, actorId: string): boolean {
  return typeof city === "string" && /^[a-z0-9-]{1,64}$/u.test(city)
    && endpoint === "/api/policies/cities/" + city && isStoreRegistrationPolicyActor(actorId);
}
function validCursor(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));
}
function matches(policy: CityPolicy, actorId: string, change: CityPolicyChange): boolean {
  return policy.changedByActor === actorId && policy.version === change.expectedVersion + 1
    && policy.maxPauseSeconds === change.maxPauseSeconds && policy.maxPreparationMinutes === change.maxPreparationMinutes
    && policy.changeReason === change.reason.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}
export async function reconcileCityPolicy(
  endpoint: string, city: string, actorId: string, change: CityPolicyChange,
): Promise<CommandResult> {
  if (!validScope(endpoint, city, actorId)) return { status: "rejected" };
  const submitted = { ...change };
  try {
    const reply = await requestPolicyOwner(endpoint, actorId, "PATCH", submitted);
    if (reply.status === 409) return { status: "conflict" };
    if (reply.status === 401 || reply.status === 403) return { status: "denied" };
    if (reply.status === 400) return { status: "rejected" };
    const result = reply.document;
    if (!policyRecord(result) || Object.keys(result).length !== 2 || typeof result.replay !== "boolean") return { status: "unknown" };
    const committed = parseCityPolicy(result.policy, city);
    if (!committed || !matches(committed, actorId, submitted)) return { status: "unknown" };

    const verify = await requestPolicyOwner(endpoint, actorId);
    const current = verify.status === 200 ? parseCityPolicy(verify.document, city) : null;
    if (!current || current.version < committed.version ||
      (current.version === committed.version && (!matches(current, actorId, submitted) || current.updatedAt !== committed.updatedAt))) {
      return { status: "unknown" };
    }
    return { status: "confirmed", current, replay: result.replay, superseded: current.version > committed.version };
  } catch { return { status: "unknown" }; }
}
export async function readCityPolicyHistory(
  endpoint: string, city: string, actorId: string, beforeVersion?: string, signal?: AbortSignal,
): Promise<CityStoreOperationalPolicyHistoryPage> {
  if (!validScope(endpoint, city, actorId) || (beforeVersion !== undefined && !validCursor(beforeVersion))) {
    throw new Error("INVALID_HISTORY_SCOPE");
  }
  const query = new URLSearchParams({ history: "1", limit: "10" });
  if (beforeVersion !== undefined) query.set("beforeVersion", beforeVersion);
  const reply = await requestPolicyOwner(endpoint + "?" + query.toString(), actorId, "GET", undefined, signal);
  if (reply.status !== 200 || signal?.aborted) throw new Error("HISTORY_UNAVAILABLE");
  if (!isCityStoreOperationalPolicyHistoryPage(reply.document, city, 10, beforeVersion)) {
    throw new Error("INVALID_HISTORY_RESPONSE");
  }
  return reply.document;
}
